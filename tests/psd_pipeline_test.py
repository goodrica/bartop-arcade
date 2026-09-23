#!/usr/bin/env python3
"""Round-trip test for the manual PSD pipeline.

Simulates the user's workflow on one photo:

  1. build a PSD (photo layer + empty MARKS layer)
  2. "edit" the photo layer: 5 real changes to existing content
     (shift hue of two regions, clone-heal two objects away, resize one)
  3. "draw" 5 yellow circles on the MARKS layer at known positions
  4. run scripts/import_psd.py
  5. assert: the exported JPEG equals the edited photo layer and contains no
     circle pixels, the manifest holds 5 diffs at the circle centres within
     tolerance, and the pair became playable

Run:  .venv/bin/python tests/psd_pipeline_test.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import make_psd as mk          # noqa: E402
import prepare_manual_edits as prep  # noqa: E402

TEST_BASE = "animals__tiger"
SRC_W, SRC_H = 1360, 900
CIRCLES = [(300, 220, 62), (980, 300, 58), (180, 640, 70), (760, 700, 55), (1180, 800, 66)]

fails: list[str] = []


def check(label: str, ok: bool, detail: str = ""):
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        fails.append(label)


def make_edited(img: Image.Image) -> Image.Image:
    """Five changes to existing content, no synthetic shapes."""
    out = img.copy()
    for (cx, cy, r), kind in zip(CIRCLES, ["hue", "hue", "heal", "heal", "shrink"]):
        box = (cx - r, cy - r, cx + r, cy + r)
        region = out.crop(box)
        if kind == "hue":
            hsv = np.asarray(region.convert("HSV")).astype(np.int16)
            hsv[:, :, 0] = (hsv[:, :, 0] + 60) % 256
            patch = Image.fromarray(hsv.astype(np.uint8), "HSV").convert("RGB")
        elif kind == "heal":
            donor = out.crop((cx - r + 140, cy - r, cx + r + 140, cy + r))
            patch = donor.filter(ImageFilter.GaussianBlur(1.2))
        else:
            patch = region.resize((int(region.width * 0.7), int(region.height * 0.7)),
                                  Image.Resampling.LANCZOS)
            patch = patch.resize(region.size, Image.Resampling.LANCZOS)
        mask = Image.new("L", (2 * r, 2 * r), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, 2 * r - 1, 2 * r - 1), fill=255)
        out.paste(patch, (cx - r, cy - r), mask.filter(ImageFilter.GaussianBlur(4)))
    return out


def make_marks() -> Image.Image:
    """Yellow rings, as the user would draw them: crisp 5px stroke."""
    m = Image.new("RGBA", (SRC_W, SRC_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(m)
    for cx, cy, r in CIRCLES:
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(255, 232, 0, 255), width=5)
    return m


def main():
    print(f"PSD pipeline round-trip on {TEST_BASE}\n")
    psd_path = mk.PSD_DIR / f"{TEST_BASE}.psd"
    outputs = [prep.edited_path(TEST_BASE), prep.manifest_path(TEST_BASE)]
    backups = {p: (p.read_bytes() if p.exists() else None) for p in [psd_path, *outputs]}

    base_img = Image.open(mk.PHOTO_DIR / f"{TEST_BASE}.jpg").convert("RGB")
    edited = make_edited(base_img)
    mk.write_psd(psd_path, edited, marks=make_marks())
    check("PSD written", psd_path.exists(), f"{psd_path.stat().st_size/1e6:.1f} MB")

    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "import_psd.py"), TEST_BASE],
                       capture_output=True, text=True)
    print(r.stdout.rstrip() or r.stderr.rstrip())
    check("import_psd exits clean", r.returncode == 0, r.stderr.strip()[:120])

    exported = Image.open(prep.edited_path(TEST_BASE)).convert("RGB")
    # JPEG is lossy: allow small per-pixel error, but the structure must match.
    d = np.abs(np.asarray(exported, dtype=np.int16) - np.asarray(edited, dtype=np.int16))
    check("exported JPEG matches the edited photo layer", float(d.mean()) < 2.5,
          f"mean delta {d.mean():.2f}, max {int(d.max())}")

    src = np.asarray(base_img, dtype=np.int16)
    p = np.asarray(exported, dtype=np.int16)
    stroke = np.array([255, 232, 0], dtype=np.int16)

    def yellowness(a):
        return (a[:, :, 0] + a[:, :, 1]) / 2 - a[:, :, 2]

    # A leaked ring would show up as stroke-coloured pixels that are more yellow
    # than the source. Ordinary edits can shift colour, so require both.
    near_stroke = np.abs(p - stroke).max(axis=2) <= 20
    leaked = int((near_stroke & ((yellowness(p) - yellowness(src)) > 70)).sum())
    check("no yellow circle pixels leaked into the game image", leaked == 0, f"{leaked} px")

    mods = json.loads(prep.manifest_path(TEST_BASE).read_text())
    check("manifest has 5 diffs", len(mods) == 5, f"{len(mods)}")

    tol = 14
    for i, ((cx, cy, cr), m) in enumerate(zip(CIRCLES, mods), 1):
        dx, dy = abs(m["x"] - cx), abs(m["y"] - cy)
        check(f"diff {i} centre matches the circle ({cx},{cy})", dx <= tol and dy <= tol,
              f"got ({m['x']},{m['y']}) off by ({dx},{dy})")
        check(f"diff {i} hit radius sane for r={cr}", 45 <= m["hitR"] <= 170, f"hitR={m['hitR']}")

    rows = prep.scan()
    row = next(x for x in rows if x["base"] == TEST_BASE)
    check("pair is playable in the index", row["ready"], json.dumps(row))

    pairs_js = (ROOT / "js" / "photo-pairs.js").read_text()
    check("js/photo-pairs.js lists the new pair", TEST_BASE in pairs_js)

    # leave the repo exactly as we found it
    for p, data in backups.items():
        if data is None:
            p.unlink(missing_ok=True)
        else:
            p.write_bytes(data)
    subprocess.run([sys.executable, str(ROOT / "scripts" / "prepare_manual_edits.py"), "--status"],
                   capture_output=True)
    prep.write_pairs_js(prep.scan())

    print(f"\n{'ALL PASSING' if not fails else str(len(fails)) + ' FAILURE(S): ' + '; '.join(fails)}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())