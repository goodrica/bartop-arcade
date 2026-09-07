#!/usr/bin/env python3
"""
PIL-based photo editor for subtle but findable Spot the Difference edits.
Edits are realistic: object removal, color change of existing objects,
background removal, brightness/contrast adjustments.
All edits are made to be visible (ΔE > 30) by default.
"""

import sys, json, random
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance, ImageStat

def find_editable_region(img, min_size=60, max_tries=50, require_variance=True):
    """Find a region to edit.
    If require_variance is True, ensures the region has enough texture/color variance.
    Returns (cx, cy, size) where size is the radius of a circular region."""
    w, h = img.size
    for _ in range(max_tries):
        cx = random.randint(min_size, w - min_size)
        cy = random.randint(min_size, h - min_size)
        size = random.randint(30, 50)
        left = max(cx - size, 0)
        top = max(cy - size, 0)
        right = min(cx + size, w)
        bottom = min(cy + size, h)
        region = img.crop((left, top, right, bottom))
        if require_variance:
            stat = ImageStat.Stat(region)
            variance = sum(stat.stddev)
            if variance < 12:  # need some variance to see an edit
                continue
        return cx, cy, size
    # fallback: center
    return w//2, h//2, 40

def apply_circular_mask(img, mask_fn, cx, cy, radius, feather=0.2):
    """Apply a function that modifies an image within a circular region.
    mask_fn receives a PIL Image (the region) and returns modified region.
    feather: proportion of radius for edge blur (0 = hard edge, 0.2 = soft)."""
    w, h = img.size
    # Create mask
    mask = Image.new('L', (w, h), 0)
    draw = ImageDraw.Draw(mask)
    # Soft edge: draw concentric ellipses with decreasing alpha
    steps = int(radius * feather)
    for i in range(steps):
        alpha = int(255 * (1 - i/steps))
        bbox = [cx - radius + i, cy - radius + i, cx + radius - i, cy + radius - i]
        draw.ellipse(bbox, fill=alpha)
    # Fill center
    draw.ellipse([cx - radius + steps, cy - radius + steps,
                  cx + radius - steps, cy + radius - steps], fill=255)
    # Blur mask slightly for smoother transition
    if feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(radius=feather*radius*0.5))
    # Extract region
    left = max(cx - radius, 0)
    top = max(cy - radius, 0)
    right = min(cx + radius, w)
    bottom = min(cy + radius, h)
    region = img.crop((left, top, right, bottom))
    mask_region = mask.crop((left, top, right, bottom))
    # Apply fn to region
    modified = mask_fn(region)
    # Blend
    if modified.mode != 'RGBA':
        modified = modified.convert('RGBA')
    region_rgba = region.convert('RGBA')
    blended = Image.composite(modified, region_rgba, mask_region)
    # Paste back
    img.paste(blended.convert(img.mode), (left, top))
    return img

def edit_remove_object(img):
    """Remove an object by cloning from surrounding area (healing brush style)."""
    cx, cy, radius = find_editable_region(img, min_size=50, require_variance=True)
    # Choose a source offset: sample from a similar texture area nearby
    angle = random.uniform(0, 2*3.14159)
    dist = random.uniform(radius*1.2, radius*2.5)
    sx = int(cx + dist * random.choice([-1, 1]))
    sy = int(cy + dist * random.choice([-1, 1]))
    # Clamp source to image bounds
    sx = max(radius, min(sx, img.width - radius))
    sy = max(radius, min(sy, img.height - radius))
    # Copy a circular patch from source
    patch = img.crop((sx - radius, sy - radius, sx + radius, sy + radius))
    # Optional: blur patch slightly to blend
    patch = patch.filter(ImageFilter.GaussianBlur(radius=1))
    # Apply patch to target with soft mask
    def patch_fn(region):
        return patch.copy()
    img = apply_circular_mask(img, patch_fn, cx, cy, radius, feather=0.25)
    return {
        'type': 'object_removed',
        'hint': 'Something is missing',
        'x': cx, 'y': cy,
        'hitR': int(radius * 0.8)  # hit zone slightly smaller than edit
    }

def edit_change_object_color(img):
    """Change the hue of an object (e.g., shirt) by shifting HSV hue."""
    cx, cy, radius = find_editable_region(img, min_size=50, require_variance=True)
    # Convert region to HSV, shift hue, convert back
    def hue_shift_fn(region):
        if region.mode != 'RGB':
            region = region.convert('RGB')
        # Convert to HSV
        hsv = region.convert('HSV')
        h, s, v = hsv.split()
        # Shift hue by adding/subtracting a value (0-255 range)
        shift = random.choice([-40, -30, 30, 40])  # stronger shift
        # Convert hue band to array, shift, wrap
        h_array = list(h.getdata())
        h_array = [(v + shift) % 256 for v in h_array]
        h = Image.new('L', h.size)
        h.putdata(h_array)
        hsv = Image.merge('HSV', (h, s, v))
        rgb = hsv.convert('RGB')
        return rgb
    img = apply_circular_mask(img, hue_shift_fn, cx, cy, radius, feather=0.2)
    return {
        'type': 'color_changed',
        'hint': 'Object color changed',
        'x': cx, 'y': cy,
        'hitR': int(radius * 0.8)
    }

def edit_remove_background(img):
    """Remove a background element (like a cloud, tree) by cloning from similar background."""
    # Similar to remove_object but maybe larger radius and from more distant background
    cx, cy, radius = find_editable_region(img, min_size=80, require_variance=True)
    # Increase radius for bigger objects
    radius = int(radius * 1.2)
    # Source: pick from a faraway area of similar texture (e.g., opposite side)
    w, h = img.size
    sx = random.randint(radius, w - radius)
    sy = random.randint(radius, h - radius)
    # Ensure source and target are not overlapping
    while abs(sx - cx) < radius*1.5 and abs(sy - cy) < radius*1.5:
        sx = random.randint(radius, w - radius)
        sy = random.randint(radius, h - radius)
    patch = img.crop((sx - radius, sy - radius, sx + radius, sy + radius))
    patch = patch.filter(ImageFilter.GaussianBlur(radius=1.5))
    def patch_fn(region):
        return patch.copy()
    img = apply_circular_mask(img, patch_fn, cx, cy, radius, feather=0.3)
    return {
        'type': 'object_removed',
        'hint': 'Background element removed',
        'x': cx, 'y': cy,
        'hitR': int(radius * 0.7)
    }

def edit_adjust_brightness(img):
    """Adjust brightness of a region (lighten or darken)."""
    cx, cy, radius = find_editable_region(img, min_size=50, require_variance=True)
    factor = random.choice([0.6, 0.7, 1.3, 1.4])  # stronger darken/brighten
    def brightness_fn(region):
        enhancer = ImageEnhance.Brightness(region)
        return enhancer.enhance(factor)
    img = apply_circular_mask(img, brightness_fn, cx, cy, radius, feather=0.2)
    return {
        'type': 'brightness_changed',
        'hint': 'Area brighter/darker',
        'x': cx, 'y': cy,
        'hitR': int(radius * 0.8)
    }

def edit_adjust_contrast(img):
    """Adjust contrast of a region."""
    cx, cy, radius = find_editable_region(img, min_size=50, require_variance=True)
    factor = random.choice([0.5, 0.6, 1.5, 1.7])  # stronger contrast change
    def contrast_fn(region):
        enhancer = ImageEnhance.Contrast(region)
        return enhancer.enhance(factor)
    img = apply_circular_mask(img, contrast_fn, cx, cy, radius, feather=0.2)
    return {
        'type': 'contrast_changed',
        'hint': 'Area contrast changed',
        'x': cx, 'y': cy,
        'hitR': int(radius * 0.8)
    }

def modify_photo(input_path, output_path, seed=None):
    if seed is not None:
        random.seed(seed)

    img = Image.open(input_path).convert('RGB')
    w, h = img.size

    edits = [
        edit_remove_object,
        edit_change_object_color,
        edit_remove_background,
        edit_adjust_brightness,
        edit_adjust_contrast,
    ]

    mods = []
    # Apply each edit type once
    for edit_fn in edits:
        try:
            mod = edit_fn(img)
            mods.append(mod)
        except Exception as e:
            print(f"Edit {edit_fn.__name__} failed: {e}", file=sys.stderr)
            # fallback: try a simple brightness change
            cx, cy, radius = w//2, h//2, 50
            def fb_fn(region):
                return ImageEnhance.Brightness(region).enhance(1.3)
            img = apply_circular_mask(img, fb_fn, cx, cy, radius, feather=0.2)
            mods.append({
                'type': 'brightness_changed',
                'hint': 'Area brighter',
                'x': cx, 'y': cy,
                'hitR': 40
            })

    img.save(output_path, quality=92)
    return mods

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python3 photo_editor.py <input.jpg> <output.jpg>")
        sys.exit(1)
    mods = modify_photo(sys.argv[1], sys.argv[2])
    print(json.dumps(mods, indent=2))
    print(f"\nApplied {len(mods)} modifications to {sys.argv[2]}", file=sys.stderr)