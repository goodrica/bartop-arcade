#!/usr/bin/env python3
"""Scaffold + validate the manual Photo Hunt editing pipeline.

Photo Hunt needs, for every base photo, three files in assets/photos/:

  <base>.jpg              the untouched reference photo (never edited)
  <base>__edited.jpg      YOUR manually edited copy (seeded from the base once)
  <base>__mods.json       5 diff entries: {"type","hint","x","y","hitR"}

This script:

  1. scaffolds  <base>__edited.jpg  as a byte-copy of <base>.jpg when missing,
     so you never have to type the filename in your image editor;
  2. scaffolds  <base>__mods.json   with 5 empty slots when missing;
  3. validates  every pair and reports progress;
  4. regenerates js/photo-pairs.js with ONLY the pairs that are playable
     (edited image actually differs from the base AND the manifest has
     5 fully located diffs). Unfinished pairs never reach the game.

Safe to re-run: never overwrites an edited image or a filled-in manifest.

Usage:
    python3 scripts/prepare_manual_edits.py            # scaffold + report
    python3 scripts/prepare_manual_edits.py --status   # report only
    python3 scripts/prepare_manual_edits.py --only animals__dog
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PHOTO_DIR = ROOT / "assets" / "photos"
PAIRS_JS = ROOT / "js" / "photo-pairs.js"

BASE_RE = re.compile(r"^([a-z]+)__([a-z0-9-]+)\.jpg$")
TOTAL_DIFFS = 5
DEFAULT_HIT_R = 70

# Starting hint text per slot — edit these to describe what YOU changed.
SLOT_TEMPLATE = [
    ("object_removed", "An existing object is missing"),
    ("color_changed", "An existing object changed color"),
    ("object_resized", "An existing object is bigger or smaller"),
    ("object_moved", "An existing object moved or turned"),
    ("background_removed", "A background detail is missing"),
]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def base_names() -> list[str]:
    """Every pristine reference photo (excludes derived *_  _*.jpg artifacts)."""
    out = []
    for p in sorted(PHOTO_DIR.glob("*.jpg")):
        m = BASE_RE.match(p.name)
        if m:
            out.append(p.stem)
    return out


def manifest_path(base: str) -> Path:
    return PHOTO_DIR / f"{base}__mods.json"


def edited_path(base: str) -> Path:
    return PHOTO_DIR / f"{base}__edited.jpg"


def read_manifest(base: str):
    p = manifest_path(base)
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return "invalid"
    return data


def locate_diffs(manifest):
    """Return (located, total) counting entries with numeric x/y."""
    if not isinstance(manifest, list):
        return 0, 0
    ok = 0
    for m in manifest:
        if isinstance(m, dict) and isinstance(m.get("x"), (int, float)) and isinstance(m.get("y"), (int, float)):
            ok += 1
    return ok, len(manifest)


SEED_CANDIDATES = ["__riverflow25-normalized", "__modified", "__gemini31", "__riverflow25"]

def pil_size(path: Path):
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        with Image.open(path) as im:
            return im.size
    except Exception:
        return None


def seed_source(base: str) -> tuple[Path, str]:
    """Prefer an existing AI-modified variant (already at the right size) so an
    approved pair stays playable while you refine it by hand."""
    base_jpg = PHOTO_DIR / f"{base}.jpg"
    base_size = pil_size(base_jpg)
    for suffix in SEED_CANDIDATES:
        cand = PHOTO_DIR / f"{base}{suffix}.jpg"
        if cand.exists() and (base_size is None or pil_size(cand) == base_size):
            return cand, "ai-variant"
    return base_jpg, "copy"


def scaffold_edited(base: str) -> tuple[str, str]:
    dst = edited_path(base)
    if dst.exists():
        return "kept", "existing"
    src, kind = seed_source(base)
    shutil.copy2(src, dst)
    return "created", kind


def scaffold_manifest(base: str) -> str:
    p = manifest_path(base)
    if p.exists():
        return "kept"
    template = [
        {"type": t, "hint": h, "x": None, "y": None, "hitR": DEFAULT_HIT_R}
        for t, h in SLOT_TEMPLATE
    ]
    p.write_text(json.dumps(template, indent=2) + "\n", encoding="utf-8")
    return "created"


def scan(only: str | None = None):
    rows = []
    for base in base_names():
        if only and only not in base:
            continue
        base_jpg = PHOTO_DIR / f"{base}.jpg"
        ed = edited_path(base)
        man = read_manifest(base)
        row = {"base": base, "edited": ed.exists(), "manifest": man is not None}
        if ed.exists():
            row["touched"] = sha256(base_jpg) != sha256(ed)
        else:
            row["touched"] = False
        located, total = locate_diffs(man)
        row["located"], row["total"] = located, total
        row["ready"] = (
            row["edited"]
            and row["touched"]
            and located >= TOTAL_DIFFS
            and total >= TOTAL_DIFFS
        )
        rows.append(row)
    return rows


def write_pairs_js(rows):
    ready = [r["base"] for r in rows if r["ready"]]
    lines = [
        "/* ============================================",
        "   Bartop Arcade - Photo Hunt pair index",
        "   ============================================",
        "   GENERATED FILE - do not edit by hand.",
        "   Regenerate with:  python3 scripts/prepare_manual_edits.py",
        "",
        "   A pair is listed only when:",
        "     assets/photos/<base>__edited.jpg exists AND differs from <base>.jpg",
        "     assets/photos/<base>__mods.json has 5 diffs with x/y coordinates",
        "   ============================================ */",
        "",
        "export const PHOTO_PAIRS = [",
    ]
    for base in ready:
        lines.append(f"  {{ base: '{base}', modified: '{base}__edited' }},")
    lines.append("];")
    lines.append("")
    lines.append(f"/** {len(ready)} playable pair(s) out of {len(rows)} base photos. */")
    lines.append("export const PAIR_COUNT = PHOTO_PAIRS.length;")
    lines.append("")
    PAIRS_JS.write_text("\n".join(lines), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", action="store_true", help="report only, change nothing")
    ap.add_argument("--only", default=None, help="substring filter, e.g. animals__dog")
    args = ap.parse_args()

    rows = scan(args.only)
    if not rows:
        sys.exit("No base photos matched.")

    created_e = created_m = 0
    seeded = []
    if not args.status:
        for r in rows:
            st, kind = scaffold_edited(r["base"])
            if st == "created":
                created_e += 1
                if kind == "ai-variant":
                    seeded.append(r["base"])
            if scaffold_manifest(r["base"]) == "created":
                created_m += 1
        rows = scan(args.only)
        if not args.only:
            write_pairs_js(rows)

    ready = [r for r in rows if r["ready"]]
    started = [r for r in rows if not r["ready"] and (r["touched"] or r["located"])]

    print(f"base photos : {len(rows)}")
    if not args.status:
        print(f"new edit copies created : {created_e}")
        print(f"new manifest templates  : {created_m}")
        if seeded:
            print(f"seeded from existing AI edit ({len(seeded)}): {', '.join(seeded)}")
    print(f"playable pairs          : {len(ready)}")
    print(f"in progress             : {len(started)}")
    print()
    for r in rows:
        if r["ready"]:
            mark = "READY "
        elif r["touched"] or r["located"]:
            mark = "WIP   "
        else:
            mark = "todo  "
        print(f"  {mark} {r['base']:<32} edits:{r['located']}/{r['total']}"
              f"  image_edited:{str(r['touched']).lower()}")
    if not args.status and not args.only:
        print(f"\nwrote {PAIRS_JS.relative_to(ROOT)} ({len(ready)} pairs)")


if __name__ == "__main__":
    main()
