#!/usr/bin/env python3
"""Create subtle, Photo-Hunt-style modifications.

This editor deliberately does NOT add bright synthetic shapes. It only makes
changes that could plausibly be differences between two photos:
- recolor an existing local object/region
- remove an existing object by cloning nearby background
- remove a background element by cloning nearby background
- slightly resize an existing local region

The generated JSON manifest stores source-image coordinates for hit testing.
"""

import json
import random
import sys
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageStat


def find_region(img, radius_min=30, radius_max=55, min_variance=18, tries=300):
    """Find a textured region; avoid flat sky/wall areas where edits vanish."""
    w, h = img.size
    for _ in range(tries):
        r = random.randint(radius_min, radius_max)
        cx = random.randint(r + 5, w - r - 5)
        cy = random.randint(r + 5, h - r - 5)
        box = (cx - r, cy - r, cx + r, cy + r)
        stat = ImageStat.Stat(img.crop(box))
        if sum(stat.stddev) >= min_variance:
            return cx, cy, r
    return w // 2, h // 2, (radius_min + radius_max) // 2


def soft_circle_mask(size, feather):
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size - 1, size - 1), fill=255)
    if feather:
        mask = mask.filter(ImageFilter.GaussianBlur(feather))
    return mask


def paste_patch(img, source_box, target_xy, radius, feather=5):
    patch = img.crop(source_box).filter(ImageFilter.GaussianBlur(1.0))
    mask = soft_circle_mask(patch.width, feather)
    img.paste(patch, target_xy, mask)


def remove_with_nearby_clone(img, cx, cy, radius, offset_x, offset_y):
    w, h = img.size
    sx = max(radius, min(w - radius, cx + offset_x))
    sy = max(radius, min(h - radius, cy + offset_y))
    source = (sx - radius, sy - radius, sx + radius, sy + radius)
    paste_patch(img, source, (cx - radius, cy - radius), radius, max(3, radius // 8))


def recolor_existing_region(img, cx, cy, radius):
    """Shift the existing region's hue strongly enough to be findable,
    without painting an artificial solid shape over the image."""
    box = (cx - radius, cy - radius, cx + radius, cy + radius)
    region = img.crop(box).convert("RGB")
    hsv = region.convert("HSV")
    h, s, v = hsv.split()
    shift = random.choice((-48, 48, 64, -64))
    values = [((value + shift) % 256) for value in h.getdata()]
    shifted_h = Image.new("L", h.size)
    shifted_h.putdata(values)
    shifted = Image.merge("HSV", (shifted_h, s, v)).convert("RGB")
    # Preserve texture and shading; do not replace it with a flat color.
    shifted = Image.blend(region, shifted, 0.78)
    mask = soft_circle_mask(shifted.width, max(4, radius // 8))
    img.paste(shifted, (cx - radius, cy - radius), mask)


def resize_existing_region(img, cx, cy, radius):
    """Subtly change the apparent size of existing visual content by scaling
    its crop, while keeping the edit bounded and photo-like."""
    box = (cx - radius, cy - radius, cx + radius, cy + radius)
    region = img.crop(box)
    enlarged = region.resize((region.width + 12, region.height + 12), Image.Resampling.LANCZOS)
    crop = enlarged.crop((6, 6, 6 + region.width, 6 + region.height))
    mask = soft_circle_mask(region.width, max(4, radius // 8))
    img.paste(crop, (cx - radius, cy - radius), mask)


def create_pair(input_path, output_path, manifest_path, seed=17):
    random.seed(seed)
    img = Image.open(input_path).convert("RGB")
    mods = []

    # 1) Existing-object color change. No solid fill or synthetic object.
    cx, cy, r = find_region(img, 35, 52, min_variance=22)
    recolor_existing_region(img, cx, cy, r)
    mods.append({"type": "color_changed", "hint": "An existing object changed color",
                 "x": cx, "y": cy, "hitR": max(34, int(r * 0.82))})

    # 2) Remove a small foreground object by cloning nearby texture.
    cx, cy, r = find_region(img, 32, 48, min_variance=24)
    remove_with_nearby_clone(img, cx, cy, r, random.choice((-2, 2)) * r, -r)
    mods.append({"type": "object_removed", "hint": "A small object is missing",
                 "x": cx, "y": cy, "hitR": max(34, int(r * 0.82))})

    # 3) Remove another scene element with a larger, softly healed patch.
    cx, cy, r = find_region(img, 42, 62, min_variance=26)
    remove_with_nearby_clone(img, cx, cy, r, -2 * r, random.choice((-2, 2)) * r)
    mods.append({"type": "background_removed", "hint": "A background element is missing",
                 "x": cx, "y": cy, "hitR": max(38, int(r * 0.78))})

    # 4) Existing region is slightly larger/smaller — no new pixels added.
    cx, cy, r = find_region(img, 34, 50, min_variance=24)
    resize_existing_region(img, cx, cy, r)
    mods.append({"type": "size_changed", "hint": "An existing object changed size",
                 "x": cx, "y": cy, "hitR": max(35, int(r * 0.82))})

    # 5) A second existing-object color change, with a different hue direction.
    cx, cy, r = find_region(img, 30, 48, min_variance=28)
    recolor_existing_region(img, cx, cy, r)
    mods.append({"type": "color_changed", "hint": "Another object changed color",
                 "x": cx, "y": cy, "hitR": max(34, int(r * 0.82))})

    img.save(output_path, quality=94, subsampling=0)
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(mods, f, indent=2)
    return mods


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("Usage: photo_editor.py INPUT.jpg OUTPUT.jpg MANIFEST.json")
    result = create_pair(sys.argv[1], sys.argv[2], sys.argv[3])
    print(json.dumps(result, indent=2))
    print(f"Applied {len(result)} non-synthetic edits", file=sys.stderr)
