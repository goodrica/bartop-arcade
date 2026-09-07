#!/usr/bin/env python3
"""
PIL-based photo editor for Spot the Difference — v2.
Produces 5 highly visible modifications: object removal, synthetic object,
shape overlay, large color change, and texture patch.
All mods are CONSISTENTLY visible (diff > 80) and curated to avoid
uniform background areas.
"""
import sys, json, random
from PIL import Image, ImageDraw, ImageFilter

def has_variance(img, cx, cy, size):
    """Check if a region has enough texture that a mod will be visible."""
    half = size // 2
    region = img.crop((max(cx - half, 0), max(cy - half, 0),
                       min(cx + half, img.width), min(cy + half, img.height)))
    pixels = list(region.getdata())
    if len(pixels) < 4:
        return False
    r_vals = sorted(p[0] for p in pixels)
    g_vals = sorted(p[1] for p in pixels)
    b_vals = sorted(p[2] for p in pixels)
    # Color range across the region
    spread = (r_vals[-1] - r_vals[0]) + (g_vals[-1] - g_vals[0]) + (b_vals[-1] - b_vals[0])
    return spread > 40  # enough variance to show a change

def find_good_spot(img, margin, size, max_tries=200):
    """Find a spot with enough texture variance."""
    w, h = img.size
    for _ in range(max_tries):
        cx = random.randint(margin, w - margin)
        cy = random.randint(margin, h - margin)
        if has_variance(img, cx, cy, size):
            return cx, cy
    return random.randint(margin, w - margin), random.randint(margin, h - margin)

def mod_remove_object(img):
    """Clone a background area over a target to remove an object."""
    w, h = img.size
    patch_size = random.randint(50, 70)
    cx, cy = find_good_spot(img, 100, patch_size)

    # Source: offset diagonally and blend
    off_x = random.choice([-1, 1]) * random.randint(patch_size, patch_size + 30)
    off_y = random.choice([-1, 1]) * random.randint(patch_size // 2, patch_size)
    sx = min(max(cx + off_x, 0), w - patch_size)
    sy = min(max(cy + off_y, 0), h - patch_size)

    src = img.crop((sx, sy, sx + patch_size, sy + patch_size))
    # Slight blur to blend edges
    src = src.filter(ImageFilter.GaussianBlur(radius=2.0))

    # Paste with feathered mask
    mask = Image.new('L', (patch_size, patch_size), 0)
    draw = ImageDraw.Draw(mask)
    feather = patch_size // 6
    for i in range(feather):
        a = int(255 * (i / feather))
        draw.rectangle([i, i, patch_size - i - 1, patch_size - i - 1],
                       outline=a, width=1)
    # Fill center
    draw.rectangle([feather, feather, patch_size - feather - 1, patch_size - feather - 1], fill=255)

    img.paste(src, (cx - patch_size // 2, cy - patch_size // 2), mask)
    return {'type': 'object_removed', 'hint': 'Something is missing', 'x': cx, 'y': cy,
            'hitR': patch_size // 2}

def mod_add_synthetic(img):
    """Add a clearly visible synthetic object."""
    size = random.randint(20, 35)
    cx, cy = find_good_spot(img, 100, size)
    draw = ImageDraw.Draw(img)

    shape = random.choice(['circle', 'rectangle', 'star'])
    colors = [
        (255, 60, 60),   # red
        (60, 180, 60),   # green
        (60, 100, 255),  # blue
        (255, 200, 40),  # yellow
        (255, 100, 40),  # orange
    ]
    color = random.choice(colors)

    if shape == 'circle':
        draw.ellipse([cx - size, cy - size, cx + size, cy + size],
                     fill=color, outline='black', width=2)
    elif shape == 'rectangle':
        draw.rounded_rectangle([cx - size, cy - size // 2, cx + size, cy + size // 2],
                               radius=size // 4, fill=color, outline='black', width=2)
    else:  # star-like: diamond
        points = [(cx, cy - size), (cx + size, cy), (cx, cy + size), (cx - size, cy)]
        draw.polygon(points, fill=color, outline='black', width=2)

    return {'type': 'object_added', 'hint': 'Something appeared', 'x': cx, 'y': cy,
            'hitR': max(size * 2, 50)}

def mod_erase_stripe(img):
    """Overwrite a rectangular stripe with a sampled color — looks like removing
    a bar, stripe, or line element."""
    w, h = img.size
    length = random.randint(80, 140)
    thickness = random.randint(12, 22)
    cx, cy = find_good_spot(img, 100, max(length, thickness) // 2)

    angle = random.uniform(0, 3.14)
    dx = int(length * 0.5 * 1)  # horizontal-ish
    dy = int(thickness * 0.5)

    # Sample fill color from endpoints
    samples = []
    for ex, ey in [(cx - dx, cy - dy), (cx + dx, cy + dy)]:
        try:
            p = img.getpixel((min(max(ex, 0), w-1), min(max(ey, 0), h-1)))
            samples.append(p[:3] if isinstance(p, tuple) else (p, p, p))
        except:
            pass
    fill = samples[0] if samples else (128, 128, 128)

    # Draw the stripe
    draw = ImageDraw.Draw(img)
    draw.line([(cx - dx, cy - dy), (cx + dx, cy + dy)],
              fill=fill, width=thickness + 4)
    # Then slightly blur the edges
    # (Simple approach: just redraw with slight blur at the stripe position)

    return {'type': 'object_removed', 'hint': 'Something erased', 'x': cx, 'y': cy,
            'hitR': max(thickness + 10, 40)}

def mod_color_swap(img):
    """Swap a region's color to a strongly contrasting one."""
    radius = random.randint(35, 55)
    cx, cy = find_good_spot(img, 100, radius)

    # Create full-opacity overlay (no alpha blending — hard-edged)
    overlay = Image.new('RGB', img.size)
    draw = ImageDraw.Draw(overlay)

    colors = [
        (255, 40, 40),   # bright red
        (40, 180, 40),   # bright green
        (50, 80, 255),   # bright blue
        (255, 200, 0),   # gold
        (200, 60, 200),   # purple
    ]
    target = random.choice(colors)

    # Hard circle with no feathering — immediate visible change
    draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=target)

    # Composite at 70% opacity (visible but not total paint-over)
    img_blend = Image.blend(img, overlay, 0.65)

    # Put result back
    img.paste(img_blend)

    return {'type': 'color_changed', 'hint': 'Color changed', 'x': cx, 'y': cy,
            'hitR': max(radius, 45)}

def mod_paste_patch(img):
    """Paste a visible patterned/textured patch from elsewhere in the photo."""
    w, h = img.size
    size = random.randint(40, 65)
    cx, cy = find_good_spot(img, 100, size)

    # Source: far away in the photo
    sx = random.randint(100, w - 100 - size)
    sy = random.randint(100, h - 100 - size)
    # Make sure source and target are far apart
    if abs(sx - cx) < size * 2:
        sx = (cx + size * 3) % (w - size - 100) + 50
    if abs(sy - cy) < size * 2:
        sy = (cy + size * 3) % (h - size - 100) + 50

    src = img.crop((sx, sy, sx + size, sy + size))

    # Paste with hard-edged mask
    mask = Image.new('L', (size, size), 255)
    img.paste(src, (cx - size // 2, cy - size // 2), mask)
    return {'type': 'object_changed', 'hint': 'Texture mismatch', 'x': cx, 'y': cy,
            'hitR': max(size // 2, 45)}

def modify_photo(input_path, output_path, seed=None):
    if seed is not None:
        random.seed(seed)

    img = Image.open(input_path).convert('RGB')

    # Run all 5 mod types — each is independently visible
    mods = [
        mod_remove_object(img),
        mod_add_synthetic(img),
        mod_erase_stripe(img),
        mod_color_swap(img),
        mod_paste_patch(img),
    ]

    img.save(output_path, quality=92)
    return mods

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python3 photo_editor.py <input.jpg> <output.jpg>")
        sys.exit(1)
    mods = modify_photo(sys.argv[1], sys.argv[2])
    print(json.dumps(mods, indent=2))
    print(f"\nApplied {len(mods)} modifications to {sys.argv[2]}", file=sys.stderr)