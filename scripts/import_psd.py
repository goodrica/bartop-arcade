#!/usr/bin/env python3
"""Turn an edited layered PSD back into game assets.

Reads assets/photos/psd/<base>.psd and writes:

  assets/photos/<base>__edited.jpg   every layer except MARKS, flattened
                                     (the yellow circles are NOT included)
  assets/photos/<base>__mods.json    one diff per yellow circle, in reading
                                     order, with x/y/hitR in 1360x900 space
  js/photo-pairs.js                  regenerated, so the pair goes live

Circle detection is colour based: strongly yellow, saturated pixels on a
layer whose name starts with MARKS. Draw crisp yellow rings (2px+ stroke).
Everything else on that layer is ignored.

Usage:
    python3 scripts/import_psd.py animals__dog
    python3 scripts/import_psd.py --all
    python3 scripts/import_psd.py --status
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image
from psd_tools import PSDImage

ROOT = Path(__file__).resolve().parent.parent
PHOTO_DIR = ROOT / "assets" / "photos"
PSD_DIR = PHOTO_DIR / "psd"

sys.path.insert(0, str(ROOT / "scripts"))
import prepare_manual_edits as prep  # noqa: E402
import make_psd as mk  # noqa: E402

SRC_W, SRC_H = 1360, 900
MIN_BLOB = 200          # pixels; ignores stray dots and text scribbles
TOTAL_DIFFS = 5
JPEG_QUALITY = 95
PHOTO_LAYER = mk.PHOTO_LAYER   # 'photo' — the bottom layer that holds the edit


# ── helpers ─────────────────────────────────────────────────────────────────

def layer_index_of_photo(psd: PSDImage):
    """The bottom layer named 'photo' (layer records are stored bottom first)."""
    names = [l.name.lower().strip() for l in psd]
    if PHOTO_LAYER in names:
        return names.index(PHOTO_LAYER)
    return 0


def raster_of(layer, canvas) -> np.ndarray | None:
    """Full-canvas RGBA float array for a layer, vector shape layers included.

    Pixel layers expose pixels directly; shape/text layers have to be rendered,
    and their raster comes back layer-sized, so it is pasted at the bbox origin.
    """
    arr = layer.numpy()
    if arr is None:
        try:
            img = layer.composite()
        except Exception:
            img = None
        if img is None:
            return None
        arr = np.asarray(img.convert("RGBA"), dtype=np.float32) / 255.0
        box = layer.bbox
        if box is None:
            return None
        full = np.zeros((canvas[1], canvas[0], 4), dtype=np.float32)
        x0, y0, x1, y1 = box
        h, w = min(y1 - y0, arr.shape[0]), min(x1 - x0, arr.shape[1])
        if h > 0 and w > 0:
            full[y0:y0 + h, x0:x0 + w] = arr[:h, :w]
        return full
    return arr


def flatten_photo(psd: PSDImage) -> tuple[Image.Image, int]:
    """Everything from the bottom up to and including the layer named 'photo'.

    Any layer above it — the yellow circle layers, whatever they are named —
    is left out, so markers can never reach the game image.
    """
    idx = layer_index_of_photo(psd)
    stack = list(psd)[:idx + 1]
    canvas = np.zeros((psd.height, psd.width, 3), dtype=np.float32)
    for layer in stack:
        if not layer.is_visible():
            continue
        arr = raster_of(layer, (psd.width, psd.height))
        if arr is None:
            continue
        a = arr[:, :, 3:4]
        canvas = arr[:, :, :3] * a + canvas * (1 - a)
    return Image.fromarray((canvas * 255).round().astype(np.uint8), "RGB"), idx


def marks_mask(psd: PSDImage, photo_idx: int) -> np.ndarray:
    """Marker-coloured pixels on every layer above the photo layer."""
    mask = np.zeros((psd.height, psd.width), dtype=bool)
    for layer in list(psd)[photo_idx + 1:]:
        if not layer.is_visible():
            continue
        arr = raster_of(layer, (psd.width, psd.height))
        if arr is None:
            continue
        a = arr[:, :, 3]
        live = a > 0.03
        safe = np.where(a > 0.03, a, 1.0)[:, :, None]
        rgb = arr[:, :, :3] / safe            # undo premultiplication if any
        r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
        yellow = live & (r > 0.45) & (g > 0.35) & (b < 0.60) & ((r - b) > 0.20) & ((g - b) > 0.15)
        mask |= yellow
    return mask


def find_blobs(mask: np.ndarray) -> list[dict]:
    """Connected regions of marked pixels, largest first."""
    h, w = mask.shape
    seen = np.zeros_like(mask)
    blobs = []
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        q = deque([(y0, x0)])
        seen[y0, x0] = True
        pts = []
        while q:
            cy, cx = q.popleft()
            pts.append((cy, cx))
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        if len(pts) < MIN_BLOB:
            continue
        pa = np.array(pts, dtype=np.float32)
        cy, cx = pa.mean(axis=0)
        radius = float(np.hypot(pa[:, 0] - cy, pa[:, 1] - cx).max())
        blobs.append({
            "x": int(round(cx)),
            "y": int(round(cy)),
            "r": radius,
            "area": len(pts),
            "y0": float(pa[:, 0].min()),
        })
    blobs.sort(key=lambda b: b["area"], reverse=True)
    return blobs


def reading_order(blobs: list[dict]) -> list[dict]:
    """Top-to-bottom, then left-to-right, so diff numbering is predictable."""
    return sorted(blobs, key=lambda b: (round(b["y"] / 120), b["x"]))


def classify(base: Image.Image, edited: Image.Image, x: int, y: int, r: int) -> tuple[str, str]:
    """Cheap heuristic label from what actually changed inside the circle."""
    pad = max(12, int(r * 0.8))
    box = (max(0, x - pad), max(0, y - pad), min(SRC_W, x + pad), min(SRC_H, y + pad))
    a = np.asarray(base.crop(box).convert("HSV"), dtype=np.float32)
    b = np.asarray(edited.crop(box).convert("HSV"), dtype=np.float32)
    dh = float(np.abs(a[:, :, 0] - b[:, :, 0]).mean())
    if dh > 26:
        return "color_changed", "An existing object changed color"
    if float(b[:, :, 1].mean()) < float(a[:, :, 1].mean()) * 0.6:
        return "object_removed", "An existing object is missing"
    return "object_changed", "An existing object changed"


def subtlety(base: Image.Image, edited: Image.Image, x: int, y: int, r: int) -> dict:
    """How findable the change is, measured inside the marked circle.

    A ring is usually much larger than the edit it surrounds, so the mean delta
    (which averages the whole circle) understates a small change. `strong` — the
    number of pixels differing by more than 40/255 — is what tracks visibility.
    """
    pad = max(12, int(r * 0.8))
    box = (max(0, x - pad), max(0, y - pad), min(SRC_W, x + pad), min(SRC_H, y + pad))
    a = np.asarray(base.crop(box), dtype=np.int16)
    b = np.asarray(edited.crop(box), dtype=np.int16)
    d = np.abs(a - b).mean(axis=2)
    mean = float(d.mean())
    peak = int(d.max())
    strong = int((d > 40).sum())
    if strong < 60 and peak < 55:
        verdict = "too subtle"
    elif strong > 6000 or peak > 210:
        verdict = "obvious"
    else:
        verdict = "ok"
    return {"mean": round(mean, 1), "peak": peak, "strong": strong, "verdict": verdict}


# ── main import ─────────────────────────────────────────────────────────────

def import_one(base: str, quiet: bool = False) -> dict:
    psd_path = PSD_DIR / f"{base}.psd"
    if not psd_path.exists():
        return {"base": base, "error": "no PSD — run scripts/make_psd.py first"}

    psd = PSDImage.open(psd_path)
    notes: list[str] = []

    photo, photo_idx = flatten_photo(psd)
    mask = marks_mask(psd, photo_idx)

    # Report exactly what was used as the photo and what was dropped.
    used = [l.name for l in list(psd)[:photo_idx + 1]]
    dropped = [l.name for l in list(psd)[photo_idx + 1:]]
    if PHOTO_LAYER not in [n.lower().strip() for n in used]:
        notes.append(f"no layer named '{PHOTO_LAYER}' found; used the bottom layer "
                     f"({used[0]!r}) as the photo")
    if not dropped:
        notes.append("no layers above the photo layer — nothing carried any circles")

    sx, sy = SRC_W / psd.width, SRC_H / psd.height
    resized = (psd.width, psd.height) != (SRC_W, SRC_H)
    if resized:
        notes.append(f"PSD canvas was {psd.width}x{psd.height}; rescaled to {SRC_W}x{SRC_H} "
                     "— better to keep the canvas as it was created")
        photo = photo.resize((SRC_W, SRC_H), Image.Resampling.LANCZOS)

    blobs = reading_order(find_blobs(mask)[:TOTAL_DIFFS * 3])
    if len(blobs) > TOTAL_DIFFS:
        notes.append(f"{len(blobs)} circles found; using the 5 largest and ignoring the rest")
        blobs = sorted(blobs, key=lambda b: b["area"], reverse=True)[:TOTAL_DIFFS]
        blobs = reading_order(blobs)
    if not blobs:
        notes.append("no yellow circles found above the photo layer — draw one ring "
                     "(or filled circle) around each of your 5 changes")

    # Always export the edited photo: their pixel work should never be lost.
    out_jpg = prep.edited_path(base)
    photo.save(out_jpg, quality=JPEG_QUALITY, subsampling=0)

    # A circle drawn on the photo layer would be baked into the game image.
    base_img = Image.open(PHOTO_DIR / f"{base}.jpg").convert("RGB")
    p = np.asarray(photo, dtype=np.int16)
    q = np.asarray(base_img, dtype=np.int16)

    def yellowness(a):
        return (a[:, :, 0] + a[:, :, 1]) / 2 - a[:, :, 2]

    added_yellow = (yellowness(p) - yellowness(q)) > 70
    if int(added_yellow.sum()) > 1500:
        notes.append(f"{int(added_yellow.sum())} pixels of new strong yellow are IN the photo "
                     "layer — if you drew your circles there, they will show up in the game. "
                     "Circles belong on the MARKS layer only")

    diffs = []
    rows = []
    for b in blobs:
        x = int(round(b["x"] * sx))
        y = int(round(b["y"] * sy))
        r = b["r"] * sx
        hit = int(min(170, max(45, round(r * 1.15))))
        typ, hint = classify(base_img, photo, x, y, r)
        stat = subtlety(base_img, photo, x, y, r)
        diffs.append({"type": typ, "hint": hint, "x": x, "y": y, "hitR": hit})
        rows.append((x, y, hit, r, stat))

    prep.manifest_path(base).write_text(json.dumps(diffs, indent=2) + "\n", encoding="utf-8")
    if len(diffs) != TOTAL_DIFFS:
        notes.append(f"only {len(diffs)} of {TOTAL_DIFFS} circles — the pair stays OUT of the "
                     "game until there are 5")

    unchanged = False
    if prep.sha256(out_jpg) == prep.sha256(PHOTO_DIR / f"{base}.jpg"):
        unchanged = True
        notes.append("the flattened photo is identical to the original file — no visible change "
                     "was made, so this pair stays out of the game")

    result = {"base": base, "diffs": len(diffs), "rows": rows, "notes": notes,
              "unchanged": unchanged, "resized": resized}

    if not quiet:
        print(f"\n{base}")
        print(f"  layers kept as the photo : {', '.join(used)}")
        if dropped:
            print(f"  layers ignored (markers) : {', '.join(dropped)}")
        print(f"  wrote {out_jpg.relative_to(ROOT)}  ({out_jpg.stat().st_size/1e6:.2f} MB)")
        print(f"  wrote {prep.manifest_path(base).relative_to(ROOT)}  ({len(diffs)} diffs)")
        for i, (x, y, hit, r, stat) in enumerate(rows, 1):
            print(f"    diff {i}: x{x:>4} y{y:>4}  circle r={r:5.1f}  hitR={hit:>3}  "
                  f"changed px>40: {stat['strong']:>5}  peak={stat['peak']:>3}  ({stat['verdict']})")
        for n in notes:
            print(f"  ! {n}")
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base", nargs="?")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--status", action="store_true")
    args = ap.parse_args()

    if args.status:
        bases = prep.base_names()
        have = [b for b in bases if (PSD_DIR / f"{b}.psd").exists()]
        print(f"{len(have)} PSD(s) in {PSD_DIR.relative_to(ROOT)}:")
        for b in have:
            print(f"  {b}")
        return

    targets = [b for b in prep.base_names() if (PSD_DIR / f"{b}.psd").exists()] if args.all \
        else ([args.base] if args.base else [])
    if not targets:
        ap.error("give a photo name, or --all")

    done = 0
    for b in targets:
        res = import_one(b, quiet=args.all)
        if "error" not in res:
            done += 1
    if args.all:
        print(f"imported {done} PSD(s)")
    prep.write_pairs_js(prep.scan())
    pairs = prep.scan()
    ready = [r for r in pairs if r["ready"]]
    print(f"\n{len(ready)} playable pair(s) of {len(pairs)} base photos")


if __name__ == "__main__":
    main()