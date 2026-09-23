#!/usr/bin/env python3
"""Local editing server for the Bartop Arcade Photo Hunt manual pipeline.

Serves the repo over HTTP and adds the small API the annotation tool
(tools/annotate.html) needs:

    GET  /api/status                    progress for all 98 pairs
    GET  /api/diff?base=<base>          auto-detected change regions
    POST /api/save-manifest             write <base>__mods.json
    POST /api/rebuild                   regenerate js/photo-pairs.js

Start it:

    python3 scripts/serve.py
    # then open http://127.0.0.1:8091/tools/annotate.html
"""

from __future__ import annotations

import json
import subprocess
import sys
import threading
from collections import deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PHOTO_DIR = ROOT / "assets" / "photos"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8091

sys.path.insert(0, str(ROOT / "scripts"))
import prepare_manual_edits as prep  # noqa: E402

# ── change detection ─────────────────────────────────────────────────────────

BLOCK = 8          # clustering grid, source pixels
DIFF_THRESHOLD = 26  # per-channel mean abs delta that counts as "changed"


def diff_map(base: str):
    b = PHOTO_DIR / f"{base}.jpg"
    e = PHOTO_DIR / f"{base}__edited.jpg"
    if not (b.exists() and e.exists()):
        return None
    with Image.open(b) as im:
        a = im.convert("RGB")
    with Image.open(e) as im:
        c = im.convert("RGB")
    if a.size != c.size:
        c = c.resize(a.size, Image.Resampling.LANCZOS)
    A = np.asarray(a, dtype=np.int16)
    C = np.asarray(c, dtype=np.int16)
    return np.abs(A - C).mean(axis=2)


def detect_regions(base: str, want: int = 5) -> list[dict]:
    """Cluster the changed pixels into up to `want` localized regions.

    Returns the strongest regions first. `score` is the mean per-channel delta
    inside the region (subtlety gauge), `peak` the strongest single pixel.
    """
    d = diff_map(base)
    if d is None:
        return []
    h, w = d.shape
    hb, wb = h // BLOCK, w // BLOCK
    blocks = d[:hb * BLOCK, :wb * BLOCK].reshape(hb, BLOCK, wb, BLOCK).mean(axis=(1, 3))
    hot = blocks > DIFF_THRESHOLD

    seen = np.zeros_like(hot, dtype=bool)
    regions = []
    for by in range(hb):
        for bx in range(wb):
            if not hot[by, bx] or seen[by, bx]:
                continue
            q = deque([(by, bx)])
            seen[by, bx] = True
            cells = []
            while q:
                cy, cx = q.popleft()
                cells.append((cy, cx))
                for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1),
                               (cy + 1, cx + 1), (cy + 1, cx - 1), (cy - 1, cx + 1), (cy - 1, cx - 1)):
                    if 0 <= ny < hb and 0 <= nx < wb and hot[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            ys = [c[0] for c in cells]
            xs = [c[1] for c in cells]
            y0, y1 = min(ys) * BLOCK, (max(ys) + 1) * BLOCK
            x0, x1 = min(xs) * BLOCK, (max(xs) + 1) * BLOCK
            sub = d[y0:y1, x0:x1]
            regions.append({
                "x": int((x0 + x1) / 2),
                "y": int((y0 + y1) / 2),
                "w": int(x1 - x0),
                "h": int(y1 - y0),
                "area": int(len(cells) * BLOCK * BLOCK),
                "score": round(float(sub.mean()), 1),
                "peak": int(sub.max()),
            })

    # Rank by a blend of strength and size — a big faint region beats a tiny loud one.
    regions.sort(key=lambda r: (r["score"] * 0.7 + r["peak"] * 0.3) * (r["area"] ** 0.25),
                 reverse=True)
    # Drop regions that sit on top of a stronger one.
    keep = []
    for r in regions:
        if all(abs(r["x"] - k["x"]) > 40 or abs(r["y"] - k["y"]) > 40 for k in keep):
            keep.append(r)
        if len(keep) >= want:
            break
    for r in keep:
        r["hitR"] = max(55, int(max(r["w"], r["h"]) * 0.75))
    return keep


# ── status ───────────────────────────────────────────────────────────────────

def status_payload():
    rows = prep.scan()
    out = []
    for r in rows:
        out.append({
            "base": r["base"],
            "category": r["base"].split("__")[0],
            "edited": r["edited"],
            "touched": r["touched"],
            "located": r["located"],
            "total": r["total"],
            "ready": r["ready"],
            "state": "ready" if r["ready"] else ("wip" if (r["touched"] or r["located"]) else "todo"),
        })
    return {"pairs": out, "ready": sum(1 for r in out if r["ready"]), "total": len(out)}


def rebuild():
    prep.write_pairs_js(prep.scan())
    js = (ROOT / "js" / "photo-pairs.js").read_text(encoding="utf-8")
    count = js.count("{ base:")
    return {"ok": True, "pairs": count}


# ── HTTP ─────────────────────────────────────────────────────────────────────

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, fmt, *args):
        if "/api/" in (self.path or ""):
            sys.stderr.write("  %s\n" % (fmt % args))

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/status":
            return self._json(status_payload())
        if u.path == "/api/diff":
            base = (parse_qs(u.query).get("base") or [""])[0]
            if not prep.BASE_RE.match(f"{base}.jpg"):
                return self._json({"error": "bad base name"}, 400)
            return self._json({"base": base, "regions": detect_regions(base)})
        return super().do_GET()

    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return self._json({"error": "bad json"}, 400)

        if u.path == "/api/save-manifest":
            base = payload.get("base", "")
            diffs = payload.get("diffs", [])
            if not prep.BASE_RE.match(f"{base}.jpg"):
                return self._json({"error": "bad base name"}, 400)
            if len(diffs) != prep.TOTAL_DIFFS:
                return self._json({"error": f"need {prep.TOTAL_DIFFS} diffs, got {len(diffs)}"}, 400)
            clean = []
            for d in diffs:
                if not isinstance(d.get("x"), (int, float)) or not isinstance(d.get("y"), (int, float)):
                    return self._json({"error": "every diff needs numeric x and y"}, 400)
                clean.append({
                    "type": str(d.get("type", "object_changed")),
                    "hint": str(d.get("hint", "Something changed here")),
                    "x": int(d["x"]),
                    "y": int(d["y"]),
                    "hitR": int(d.get("hitR", prep.DEFAULT_HIT_R)),
                })
            prep.manifest_path(base).write_text(json.dumps(clean, indent=2) + "\n", encoding="utf-8")
            return self._json(rebuild())

        if u.path == "/api/rebuild":
            return self._json(rebuild())

        return self._json({"error": "unknown endpoint"}, 404)


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Photo Hunt editing server -> http://127.0.0.1:{PORT}/tools/annotate.html")
    print(f"serving {ROOT}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
