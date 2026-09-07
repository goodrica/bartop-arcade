# Bartop Arcade — Handoff v2

> Fresh handoff document for trying another model. This is a self-contained
> description of the project as it currently stands. Read this first.

---

## What this is

A pure HTML5 Canvas + vanilla JavaScript **bartop arcade game**, inspired by
the **Megatouch** bar-top arcade machines from the late 1990s/early 2000s.
Designed to run on a **17" widescreen touchscreen monitor** at **1920×1080
landscape resolution** — not a phone, not a portrait touchscreen.

**Currently implemented: 1 game** ("Spot the Difference", a.k.a. Photo Hunt).
The architecture supports a collection of mini-games (the engine has a menu
screen and a registration pattern), but only this one game is shipped.

### Spot the Difference (a.k.a. Photo Hunt) — how it works

- One stock photo is loaded.
- The **same photo is drawn identically** on both panes (left = reference,
  right = modified).
- 5 modifications are applied to the right pane:
  - `object_removed` — region painted with border-average color (looks like
    an object was airbrushed out)
  - `color_swap` — region replaced with complementary hue
  - `large_darken` / `large_brighten` — strong brightness shift
  - `contrast_invert` — full RGB invert in the region
  - `red_tint` / `yellow_tint` / `blue_tint` — strong color overlay
- Player taps the modification on the right pane → scored; tap wrong →
  -5 second time penalty.
- 60 seconds total. Find all 5 → win.

### Difficulty scaling

- Level 1 → 1.5× (50% easier: bigger patches, more generous hit zones)
- Level 2 → 1.4×
- Level 3 → 1.3×
- Level 4+ → 1.0× (normal)
- Bumps on each Play Again. Resets to 1 when user returns to Menu.

---

## Project layout

```
bartop-arcade/                  # Git repo, remote: git@github.com:goodrica/bartop-arcade.git
├── index.html                  # Entry point, viewport meta, loads engine + game
├── css/
│   └── style.css               # Dark theme, full-viewport canvas
├── js/
│   ├── engine.js               # Core engine (canvas, game loop, screen stack, menu, HUD,
│   │                           #   results screen, pointer + click handlers, level tracking)
│   ├── audio.js                # Web Audio API procedural sounds (WIP)
│   ├── photo-loader.js         # Local photo loader; exports CATEGORIES + loadPhotosByCategory()
│   └── games/
│       └── spot-the-difference.js  # The only game implemented (~900 lines)
├── assets/
│   └── photos/                 # 98 JPEG photos total
│       ├── animals__bear.jpg ...         (96 Picsum CC0 photos at 1360×900)
│       ├── purchased__sierra-mountains.jpg
│       └── purchased__tennis-girls.jpg
├── scripts/
│   └── download-photos.sh      # Bash script to re-download Picsum photos
├── tests/                      # CDP-based Python test scripts
│   ├── cdp_test_arcade.py
│   ├── cdp_playthrough.py
│   ├── cdp_results_buttons.py
│   ├── cdp_screenshot.py
│   └── cdp_touch_test.py
├── README.md
├── HANDOFF.md                  # Earlier handoff (pre-landscape-refactor)
└── handoff2.md                 # This file
```

---

## File-by-file responsibilities

### `index.html`
```html
<canvas id="gameCanvas"></canvas>
<script type="module" src="js/engine.js"></script>
<script type="module" src="js/games/spot-the-difference.js"></script>
```
Two `<script type="module">` tags load engine.js then the game. Order matters
because the game imports from the engine.

### `js/engine.js` (~520 lines)
Core engine. Key things:
- `const W = 1920, H = 1080` — landscape canvas
- **Touch input**: Pointer Events API + click fallback + 100ms debounce
- **Screen stack**: `['menu']` → `['playing']` → `['results']`
- **Level tracking**: `getLevel()`, `incrementLevel()`, `resetLevel()`
- **Game registration**: `registerGame(module)` — game modules export
  `{ name, description, init(), draw(), handlePointer(), cleanup() }`
- Draws: menu, HUD, results
- `window.__bartopDebug` — exposes `screen` and `gameData` for tests

### `js/games/spot-the-difference.js` (~900 lines)
The game module. Exports a default object with `name`, `description`,
`init()`, `draw()`, `handlePointer()`, `cleanup()`. Also registers itself
with the engine via `registerGame()`.

Key internal layout constants (landscape):
```js
const DISPLAY_PHOTO_W = 920;       // pane width
const DISPLAY_PHOTO_H = 609;       // pane height (920 / 1.51)
const PANE_GAP        = 16;
const PANE_X_LEFT     = (1920 - (920*2 + 16)) / 2;  // 32
const PANE_X_RIGHT    = PANE_X_LEFT + 920 + 16;     // 968
const PANE_Y          = 130;       // below HUD bar
const SRC_W = 1360, SRC_H = 900;   // source photo resolution
```

Key functions:
- `generateRound()` — load photo, set up 5 modifications
- `applyModification(mod)` — applies ONE modification to the off-screen
  canvas. Switch on `mod.type`.
- `drawFoundHighlight(ctx, mod, sceneX, sceneY)` — green circle + check
- `window.__photoHuntDebug()` — returns diff positions for tests

### `js/photo-loader.js`
```js
export const CATEGORIES = [
  { id: 'animals',  files: [...] },  // 10 photos
  { id: 'food',     files: [...] },  // 10 photos
  // ... 8 categories total
  { id: 'purchased', files: ['purchased__sierra-mountains.jpg', 'purchased__tennis-girls.jpg'] },
];
export function loadPhotosByCategory(categoryId, count) { ... }
export function randomCategoryId() { ... }
```

**Currently pinned to 'purchased'** in `spot-the-difference.js` so the
user can preview their own photos. To restore random category picking,
change `categoryId = 'purchased'` back to `categoryId = randomCategoryId()`.

### `assets/photos/`
- 96 photos from Picsum (CC0 license), all 1360×900 (1.51:1 aspect ratio)
- 2 purchased stock photos:
  - `purchased__sierra-mountains.jpg` (from INH_19071_28919.jpg)
  - `purchased__tennis-girls.jpg` (from INH_32193_245577_1.jpg)
- License clause allows commercial use including video games.

---

## How to run

```bash
cd /home/andrew/bartop-arcade
python3 -m http.server 8091 --bind 127.0.0.1
```
Open **http://127.0.0.1:8091** in any modern browser. Touch + mouse both work.

## How to test (CDP)

Headless Chrome is already running at `127.0.0.1:9222`. Use the Python
`websockets` library to drive it. Pattern:

```python
import asyncio, json, urllib.request, websockets

async def send(ws, method, params=None):
    # ... CDP send pattern

async def ev(ws, expr):
    # Runtime.evaluate wrapper

async def click_logical(ws, lx, ly):
    # Convert logical canvas coords (1920x1080) to actual screen coords
    # by reading canvas bounding rect
```

Useful JS to run inside the page:
```js
window.__bartopDebug.screen                 // 'menu' | 'playing' | 'results'
window.__bartopDebug.gameData               // { score, timeRemaining, found, total, won, ... }
window.__photoHuntDebug()                   // [{ type, hint, x, y, hitR, found, diffMult }, ...]
```

---

## Key technical decisions (don't undo these)

1. **Same photo on both panes** — NOT two different photos. Megatouch Photo
   Hunt works by loading ONE photo and modifying a copy. `leftImg === rightImg`.
2. **Image-relative coordinates** for differences. `differences[i].x` is a
   position within the photo (0–DISPLAY_PHOTO_W), not canvas coords. The
   `handlePointer()` method translates pane-relative taps to image-relative
   for hit-testing.
3. **Off-screen canvas at SOURCE resolution (1360×900)** for modifications.
   The main canvas displays them scaled down to 920×609. This keeps the
   modifications sharp.
4. **`imageSmoothingEnabled = false` on the right-pane drawImage** — without
   this, the downscale averages modification pixels with their neighbors and
   **the modifications become invisible**. This was a major bug that took
   extensive CDP testing to find.
5. **Local photo files** in `assets/photos/`, not remote. Avoids CORS
   taint issues on canvas.
6. **Pointer Events + click fallback + 100ms debounce** for input. Mouse
   clicks were broken in earlier versions due to `e.preventDefault()`
   blocking them; the click fallback is mandatory.
7. **Two `<script type="module">` tags** in `index.html` — engine.js first,
   then the game. Order matters; circular dependency TDZ issues if you
   try to merge them or use dynamic imports.

---

## What needs work (why I'm handing this off)

The user reports that **even at level 1, the modifications are still hard to
spot**. The current pixel sampling test (max diff = 222 between panes) shows
the modifications are visually present, but the user couldn't find any on
their actual gameplay. Possible improvements to try:

1. **Make the modifications even bolder** — bigger patches, even more
   saturated colors. The current patches are ~25-43 display px at level 1.
   Maybe bump to 60-90 px.
2. **Use less-photo-realistic mods** — instead of "this region was tinted",
   draw actual simple shapes (a colored circle, an X, an arrow) directly on
   top of the photo. Some Photo Hunt implementations do this.
3. **Improve the click hit zone** — currently 55 px radius. For a finger
   tap on a touchscreen, you might need larger.
4. **Add a hint mode** — e.g. after 10 seconds without progress, briefly
   flash one of the unmodified areas.
5. **Re-test with the user's purchased photos** — they specifically
   mentioned these photos for evaluation; the new `purchased` category
   pin lets you see exactly what they see.

The user wants to try a different model to see if it produces better
results. Start by **testing the current build first** to confirm what's
working and what isn't, then propose improvements.

---

## Git state

```
Repo:   git@github.com:goodrica/bartop-arcade.git
Branch: main
Author SSH: configured (no `gh` CLI)
```

Recent commits (most recent first):
```
16cd5b1  feat: rewrite mods as Megatouch Photo Hunt-style changes, make them visible
ae85941  feat: difficulty scaling (3 easier levels) + side-by-side layout
3f7af5e  feat: switch to landscape 1920x1080 for 17" touchscreen, add purchased photos
e922343  fix: photo panes were different sizes — left was clipped 40px
c88a3d7  fix: make Photo Hunt truly Megatouch-style — same photo, 5 subtle mods
37de266  fix: critical bug — diff hit zone read wrong property, taps never landed
30d8c7b  feat: replace procedural scenes with real Megatouch-style photo hunt
bc52a7b  fix: game module crashed on load — phantom scene generator functions
```

---

## Environment

- Linux host, Python 3.10+ available
- Headless Chrome at `127.0.0.1:9222` (already running, profile at
  `/tmp/bartop-chrome-profile2`)
- HTTP server at `127.0.0.1:8091` (run `python3 -m http.server 8091`
  from the project root)
- Photo file `assets/photos/*.jpg` is local; no external HTTP needed at
  runtime.

---

## Suggested first steps for the new model

1. **Run the game yourself** — open `http://127.0.0.1:8091`, click the
   menu card, play a round. Confirm what's working.
2. **Read `js/games/spot-the-difference.js`** — it's the only file with
   game logic. ~900 lines. The interesting bits are in `generateRound()`,
   `applyModification()`, and the modification helper functions
   (applyPaintOut, applyColorSwap, applyInvert, applyColorOverlay).
3. **Run a CDP test** — use the patterns in `tests/cdp_*.py` to
   programmatically verify changes.
4. **Make ONE change at a time**, then verify with CDP pixel sampling.
5. **Commit and push** with descriptive commit messages.

Good luck.
