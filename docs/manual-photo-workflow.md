# Manual Photo Hunt editing workflow

Photo Hunt is played on **one photo with 5 changes**. The game loads two files per
photo plus one manifest, all in `assets/photos/`:

| File | Who creates it | Purpose |
| --- | --- | --- |
| `<base>.jpg` | already in the repo | the untouched reference photo (1920×1080 canvas shows it on the left) |
| `<base>__edited.jpg` | **you, by hand** | your edited copy — the same scene with exactly 5 changes |
| `<base>__mods.json` | the annotator tool | the 5 changed spots as coordinates, used for tap hit-testing |

`<base>` is the filename stem, e.g. `animals__dog`, `food__pizza`, `purchased__tennis-girls`.
Every base photo is 1360×900, and all manifest coordinates are in **1360×900 source space**
(the game scales them to the 920×609 panes itself).

## One-time setup

```bash
cd /home/andrew/bartop-arcade
python3 scripts/prepare_manual_edits.py
```

This creates, for all 98 base photos:

- `assets/photos/<base>__edited.jpg` — a byte copy of the original, **already named
  correctly**, so you never type a filename. Five photos that already had an approved
  AI edit (dog, burger, classic car, sierra mountains, tennis girls) are seeded from
  that edited version instead, so they are playable immediately.
- `assets/photos/<base>__mods.json` — a template with 5 empty diff slots.
- `js/photo-pairs.js` — the generated pair index the game reads.

Re-running it never overwrites your edited images or filled-in manifests.
`python3 scripts/prepare_manual_edits.py --status` prints progress without changing anything.

## Per photo

1. **Start the editing server** (needed for the annotator and for canvas pixel access):

   ```bash
   python3 scripts/serve.py          # http://127.0.0.1:8091
   ```

2. **Edit the image.** Open `assets/photos/<base>__edited.jpg` in GIMP/Photoshop/your editor
   and make exactly 5 changes to *existing* content:

   - remove an existing object (clone/heal it away),
   - recolor an existing object (keep its texture and shading),
   - resize or rotate an existing object,
   - remove a background detail.

   Do **not** paste bright synthetic shapes (circles, squares, arrows, X marks), do not
   apply global color grading or hue shifts, and do not make microscopic changes.
   The target feel: *missed at first glance, obvious once you look in the right area*.
   Save over the same filename (JPEG, quality ~90+).

3. **Annotate it** in the browser: <http://127.0.0.1:8091/tools/annotate.html>

   - Pick the photo in the left list.
   - Click **Auto-detect 5 regions** — it clusters the pixels that differ between the
     original and your edit and proposes the five spots with a hit radius each.
   - Drag the circles onto the exact changed spots, fix the hint text, and set the hit
     radius (70 is a good default; bigger only for large edits).
   - Use the **overlay → changed pixels** toggle with the threshold slider to see exactly
     what your edit changed — this is how you catch an edit that is too subtle (a low
     Δ/peak in the readout) or one you forgot to save.
   - Use **A / B flip** to see the pair as the player will: it should be findable, but not
     jump out instantly.
   - Click **Save manifest** (or Ctrl/Cmd-S). The manifest is written and
     `js/photo-pairs.js` is regenerated in the same step.

4. **Play it.** Reload <http://127.0.0.1:8091> and start Photo Hunt. Levels walk the
   playable pairs in order (level 1 = first pair in `js/photo-pairs.js`), so the pair you
   just finished shows up at its position in the list. Photo 1 is level 1, photo 2 is
   level 2, and so on, cycling after the last one.

## What counts as playable

A pair reaches the game only when **both** are true:

- `<base>__edited.jpg` exists **and** is not byte-identical to `<base>.jpg` (so a photo you
  have not edited yet can never be served with coordinates for changes that aren't there);
- `<base>__mods.json` has 5 entries with numeric `x`/`y`.

`python3 scripts/prepare_manual_edits.py --status` is the source of truth: `todo` (not
edited), `WIP` (edited and/or partly annotated), `READY` (playable).

## Notes

- Work in batches of a few photos and play each one before moving on — visual balance is
  the thing that matters, and it is easier to judge one pair at a time.
- Editing a JPEG and re-saving it slightly alters the whole image, which is fine; the
  annotation step is what tells the game where to look.
- The five AI-seeded pairs are a good reference for how strong an edit should be.
