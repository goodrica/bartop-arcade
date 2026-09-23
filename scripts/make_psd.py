#!/usr/bin/env python3
"""Create layered PSD working files for hand-editing Photo Hunt photos.

Each PSD has exactly two layers, in Photopea/Photoshop:

    MARKS  - transparent layer on top. Draw a YELLOW circle around every
             area you changed. These circles are NEVER part of the game
             image; scripts/import_psd.py reads them as tap coordinates.
    photo  - the photo. Make your 5 changes here (remove / recolor / resize
             existing objects). Never draw circles on this layer.

Usage:
    python3 scripts/make_psd.py animals__dog        # one photo
    python3 scripts/make_psd.py --list              # what is missing
    python3 scripts/make_psd.py --all               # every base photo

Files land in assets/photos/psd/<base>.psd  (git-ignored, ~7 MB each).
Nothing is overwritten without --force.

Implementation note: this writes PSD v1 with zlib-compressed layer channels
and PackBits-compressed composite data, which Photopea and Photoshop both
read. Verified by parsing the result back with psd-tools.
"""

from __future__ import annotations

import argparse
import struct
import sys
import zlib
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PHOTO_DIR = ROOT / "assets" / "photos"
PSD_DIR = PHOTO_DIR / "psd"

sys.path.insert(0, str(ROOT / "scripts"))
import prepare_manual_edits as prep  # noqa: E402

MARKS_LAYER = "MARKS"
PHOTO_LAYER = "photo"
UNICODE_NAMES = False   # keep the layer extra-data minimal; see luni_block()


# ── PackBits (RLE) encoder, used for the flattened composite ─────────────────

def packbits(data: bytes) -> bytes:
    out = bytearray()
    n = len(data)
    i = 0
    while i < n:
        run = 1
        while i + run < n and data[i + run] == data[i] and run < 128:
            run += 1
        if run >= 3:
            out.append((-(run - 1)) & 0xFF)
            out.append(data[i])
            i += run
            continue
        # literal run: stop before a 3+ repeat
        start = i
        i += 1
        while i < n and (i - start) < 128:
            if i + 2 < n and data[i] == data[i + 1] == data[i + 2]:
                break
            i += 1
        lit = data[start:i]
        out.append(len(lit) - 1)
        out.extend(lit)
    return bytes(out)


def rle_channel(plane: np.ndarray) -> bytes:
    """Layer-channel RLE: 2-byte tag + 2-byte count per row, then the rows.

    Layer channel data interleaves counts+data per channel; the merged image
    at the end of the file does not — see rle_composite().
    """
    h, w = plane.shape
    rows = [packbits(plane[y].tobytes()) for y in range(h)]
    counts = b"".join(struct.pack(">H", len(r)) for r in rows)
    return struct.pack(">H", 1) + counts + b"".join(rows)


def rle_composite(planes: list[np.ndarray]) -> bytes:
    """Merged-image RLE, per the PSD spec: the 2-byte row counts for EVERY row
    of EVERY channel come first, then all the compressed row data."""
    counts = bytearray()
    rows = bytearray()
    for plane in planes:
        for y in range(plane.shape[0]):
            r = packbits(plane[y].tobytes())
            counts += struct.pack(">H", len(r))
            rows += r
    return struct.pack(">H", 1) + bytes(counts) + bytes(rows)


def deflate_channel(plane: np.ndarray) -> bytes:
    """Compression 2 = ZIP without prediction. Fine for layer channels."""
    return struct.pack(">H", 2) + zlib.compress(plane.tobytes(), 6)


# ── PSD writer ──────────────────────────────────────────────────────────────

def pascal_name(name: str) -> bytes:
    raw = name.encode("ascii", "replace")[:255]
    body = bytes([len(raw)]) + raw
    pad = (-len(body)) % 4
    return body + b"\x00" * pad


def luni_block(name: str) -> bytes:
    """'luni' unicode layer-name block.

    Not written by default: the ASCII Pascal name in the layer record is what
    Photopea, Photoshop and GIMP all read, and an extra tagged block only adds
    a way for a strict parser to trip over padding.
    """
    chars = name.encode("utf-16-be")
    payload = struct.pack(">I", len(name)) + chars
    return b"8BIMluni" + struct.pack(">I", len(payload)) + payload


def layer_record(name: str, rect, channels) -> bytes:
    top, left, bottom, right = rect
    rec = struct.pack(">iiii", top, left, bottom, right)
    rec += struct.pack(">H", len(channels))
    for cid, data in channels:
        rec += struct.pack(">hI", cid, len(data))
    rec += b"8BIM" + b"norm"                       # blend mode: normal
    rec += bytes([255, 0, 0, 0])                   # opacity, clipping, flags, filler
    extra = struct.pack(">I", 0)                   # no layer mask
    extra += struct.pack(">I", 0)                  # no blending ranges
    extra += pascal_name(name)
    if UNICODE_NAMES:
        extra += luni_block(name)
    rec += struct.pack(">I", len(extra)) + extra
    return rec


def write_psd(path: Path, photo: Image.Image, marks: Image.Image | None = None) -> Path:
    """Two-layer PSD: 'photo' below, 'MARKS' above (empty unless `marks` given).

    `marks` is an RGBA image on the same canvas, used when you need a PSD with
    something already on the MARKS layer (tests, or a worked example).
    """
    photo = photo.convert("RGB")
    w, h = photo.size
    A = np.asarray(photo, dtype=np.uint8)

    photo_channels = [(-1, np.full((h, w), 255, np.uint8)), (0, A[:, :, 0]), (1, A[:, :, 1]), (2, A[:, :, 2])]
    if marks is None:
        marks_channels = [(-1, np.zeros((h, w), np.uint8))] + [
            (c, np.zeros((h, w), np.uint8)) for c in (0, 1, 2)
        ]
    else:
        M = np.asarray(marks.convert("RGBA").resize((w, h)), dtype=np.uint8)
        alpha = M[:, :, 3].astype(np.uint16)
        # store straight (non-premultiplied) RGB with the alpha channel
        marks_channels = [(-1, M[:, :, 3])] + [
            (c, ((M[:, :, c].astype(np.uint16) * 255) // np.maximum(alpha, 1)).astype(np.uint8))
            for c in (0, 1, 2)
        ]

    def channels_blob(chans):
        return [(cid, deflate_channel(plane)) for cid, plane in chans]

    marks_blob = channels_blob(marks_channels)
    photo_blob = channels_blob(photo_channels)

    # Layer records store only lengths in the header area: build data first.
    marks_rec = layer_record(MARKS_LAYER, (0, 0, h, w), marks_blob)
    photo_rec = layer_record(PHOTO_LAYER, (0, 0, h, w), photo_blob)
    marks_data = b"".join(d for _, d in marks_blob)
    photo_data = b"".join(d for _, d in photo_blob)

    layer_info = struct.pack(">h", 2) + marks_rec + photo_rec + marks_data + photo_data
    layer_info += b"\x00" * (-len(layer_info) % 2)   # pad to even

    out = bytearray()
    out += b"8BPS" + struct.pack(">H", 1) + b"\x00" * 6
    out += struct.pack(">HIIHH", 3, h, w, 8, 3)      # RGB, 8-bit
    out += struct.pack(">I", 0)                      # color mode data
    out += struct.pack(">I", 0)                      # image resources
    lmi = struct.pack(">I", len(layer_info)) + layer_info + struct.pack(">I", 0)  # global layer mask: empty
    out += struct.pack(">I", len(lmi)) + lmi         # layer and mask info

    # Flattened composite image data, planar and RLE (universally readable).
    out += rle_composite([A[:, :, c] for c in range(3)])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes(out))
    return path


# ── CLI ─────────────────────────────────────────────────────────────────────

def seed_photo(base: str) -> Image.Image:
    """Start from an existing edit when there is one, otherwise the original."""
    ed = prep.edited_path(base)
    base_jpg = PHOTO_DIR / f"{base}.jpg"
    if ed.exists() and prep.sha256(ed) != prep.sha256(base_jpg):
        return Image.open(ed)
    return Image.open(base_jpg)


def make(base: str, force: bool = False) -> str:
    dst = PSD_DIR / f"{base}.psd"
    if dst.exists() and not force:
        return "exists"
    write_psd(dst, seed_photo(base))
    return "created"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base", nargs="?", help="photo stem, e.g. animals__dog")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--list", action="store_true", help="show which PSDs exist")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    bases = prep.base_names()
    if args.list:
        for b in bases:
            p = PSD_DIR / f"{b}.psd"
            size = f"{p.stat().st_size / 1e6:.1f} MB" if p.exists() else "-"
            print(f"  {'PSD  ' if p.exists() else 'todo '} {b:<32} {size}")
        have = sum(1 for b in bases if (PSD_DIR / f"{b}.psd").exists())
        print(f"\n{have} / {len(bases)} PSDs exist in {PSD_DIR.relative_to(ROOT)}")
        return

    targets = bases if args.all else ([args.base] if args.base else [])
    if not targets:
        ap.error("give a photo name, or --all")
    made = 0
    for b in targets:
        if args.base and b != args.base:
            continue
        st = make(b, args.force)
        made += st == "created"
        print(f"  {st:<8} {PSD_DIR.relative_to(ROOT)}/{b}.psd")
    print(f"\n{made} created")


if __name__ == "__main__":
    main()