# Manual Photo Hunt editing workflow

Photo Hunt is played on **one photo with 5 changes**. Per photo the game needs two image
files plus a manifest, all in `assets/photos/`:

| File | Who creates it | Purpose |
| --- | --- | --- |
| `<base>.jpg` | already in the repo | the untouched reference photo (left pane) |
| `<base>__edited.jpg` | exported from your PSD | the same scene with exactly 5 changes (right pane) |
| `<base>__mods.json` | exported from your PSD | the 5 changed spots as coordinates, for tap hit-testing |

`<base>` is the filename stem: `animals__dog`, `food__pizza`, `purchased__tennis-girls`, …
Every base photo is 1360×900 and all coordinates are in that space; the game scales them
to its 920×609 panes.

## The layered-PSD workflow (recommended)

Every photo already has a layered working file waiting for you:

```
assets/photos/psd/<base>.psd      ← 98 of them, two layers each
```

The PSD opens with exactly two layers:

- **`MARKS`** (top, transparent) — draw a **yellow circle** around each of your 5 changes.
  Crisp yellow, ~4–6 px stroke. This layer is a scratchpad: it is *never* part of the game
  image, it only tells the importer where the changes are.
- **`photo`** (bottom) — make your 5 changes here. Do **not** draw circles on this layer,
  or they end up baked into the game image.

Then:

```bash
cd /home/andrew/bartop-arcade
python3 scripts/import_psd.py <base>       # or --all, or --status
```

The importer flattens every layer **except** `MARKS` into `<base>__edited.jpg`, reads the
yellow circles as tap coordinates, classifies each change, writes `<base>__mods.json`, and
regenerates the game's pair index. One command turns a layered file into a finished level.

It also reports a **subtlety delta** per circle — the mean pixel difference inside that
circle — so you can see immediately whether a change is fair:

| delta | verdict | meaning |
| --- | --- | --- |
| < 8 | too subtle | the player will never see it; make the change stronger |
| 8 – 45 | ok | the target feel: missed at first glance, obvious when looked at |
| > 45 | obvious | fine for an early level, too easy later |

### Editing the PSDs

**Photopea** (free, in-browser, opens PSD): <https://www.photopea.com> → File → Open →
`assets/photos/psd/<base>.psd` → edit → File → Save (Ctrl/Cmd-S writes back over the same
file). Layer names are preserved, so the importer can still find `MARKS`.

- **Do not flatten the image** before saving — that destroys the `MARKS` layer and the
  importer will refuse, telling you why.
- Keep the canvas at 1360×900. If you crop or resize, the importer rescales and warns, but
  coordinates get less accurate.
- Changes to existing content only: remove an object (clone/heal it away), recolor an object
  (keep its texture and shading), resize or rotate an object, remove a background detail.
  No pasted-on bright shapes, no global color grading, no microscopic tweaks. The target
  feel: *missed at first glance, obvious once you look in the right area*.
- Save the PSD; the importer does the JPEG export. Don't hand-export JPEGs.

## Batch and status commands

```bash
python3 scripts/make_psd.py --list              # which photos have PSDs
python3 scripts/make_psd.py <base>            # (re)create one PSD; --force to overwrite
python3 scripts/prepare_manual_edits.py --status   # todo / WIP / READY for all 98
python3 scripts/import_psd.py --all           # import every PSD that exists
```

`python3 scripts/make_psd.py --all` builds the whole set (~465 MB total; they are
git-ignored, being large derived files). It has already been run for all 98 photos, seeded
from your existing edit where there is one — dog, burger, classic car, sierra mountains and
tennis girls came from the earlier AI edits, so you can refine those directly.

## Playing your work

```bash
python3 scripts/serve.py            # http://127.0.0.1:8091
```

Photo Hunt walks the playable pairs in order: level 1 = first pair in `js/photo-pairs.js`,
level 2 = second, and so on, cycling after the last. A pair only becomes playable when its
edited image exists **and** differs from the base **and** its manifest has 5 located diffs,
so an unfinished photo can never be served with coordinates for changes that aren't there.

## What counts as playable

- `<base>__edited.jpg` exists **and** is not byte-identical to `<base>.jpg`;
- `<base>__mods.json` has 5 entries with numeric `x`/`y`.

`python3 scripts/prepare_manual_edits.py --status` is the source of truth: `todo` (not
edited), `WIP` (edited and/or partly annotated), `READY` (playable).

## Alternative: click the changes instead of drawing circles

`http://127.0.0.1:8091/tools/annotate.html` does the same job without layers: pick a photo,
click the changed spots on the edited pane, save. It also has auto-detect (pixel-diff
clustering), a changed-pixel overlay with a threshold slider, and an A/B flip. Its stage bar
has buttons that drive the PSD scripts too, so you can create and import a PSD from there.

## Files

| Path | Role |
| --- | --- |
| `scripts/prepare_manual_edits.py` | scaffolds edit copies + manifest templates; validates; writes `js/photo-pairs.js` |
| `scripts/make_psd.py` | writes the two-layer PSDs (also the PSD writer itself) |
| `scripts/import_psd.py` | PSD → edited JPEG + manifest + pair index |
| `scripts/serve.py` | local server + API for the annotator |
| `tools/annotate.html` | point-and-click annotator |
| `tests/psd_pipeline_test.py` | round-trip test of the whole PSD flow |

## Notes

- Work in small batches and play each photo before moving on — visual balance is what
  matters, and it is easier to judge one pair at a time.
- The five AI-seeded pairs are a good reference for how strong an edit should be.