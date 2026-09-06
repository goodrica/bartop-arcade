# Handoff: Bartop Arcade — Spot the Difference

## Status: ✅ FIXED & VERIFIED (2026-09-06)

**Project:** `goodrica/bartop-arcade` — HTML5 Canvas touchscreen mini-game collection

The "black screen / clicks do nothing" bug is **fixed and verified end-to-end in a real
headless Chrome via the DevTools Protocol** (see Test Evidence below). Both **mouse
clicks** and **touch events** work.

---

## Photo Hunt Rebuild (v2 — 2026-09-06)

The procedural stick-figure scenes were replaced with **real stock photos** and the
game was renamed "Photo Hunt" to match Megatouch's actual name.

### Architecture

- **Two genuinely different photos** are loaded from the same category (40/40
  sampled pixels differ between left and right sides).
- The **right photo** is copied to an off-screen canvas, then 5 subtle
  modifications are applied to pixel data — no overlaid shapes.
- All modifications use a smooth circular mask so patches blend naturally
  (no sharp borders).

### Modification Types (all subtle, photo-realistic)

| Type | Effect |
|------|--------|
| `brighten` | Lighter patch (RGB +255·falloff) |
| `darken` | Darker patch (RGB −255·falloff) |
| `saturate` | Multiply saturation by 1.7 |
| `desaturate` | Multiply saturation by 0.3 |
| `hue_warm` | Shift hue −15° (toward red/orange) |
| `hue_cool` | Shift hue +25° (toward blue/cyan) |
| `blur_patch` | 5×5 box-blur with mask blend |
| `sharpen` | Local contrast boost |

### Critical Bug Found and Fixed During Verification

The diff objects were created with property `r` (visual patch radius) but
`handlePointer()` and the debug hook read `hitR` (touch hit zone). Result:
every tap compared against `undefined`, which fails the distance check.
**Every previous "test passed" output was wrong** — the photos loaded
correctly but no tap could ever land.

**Fix:** Added `hitR: PHOTO_HIT_RADIUS` to each diff object in `generateRound()`.
Verified: tap on diff 0 → found 0→1, score 0→100, diff marked `found: true`.

### Files Touched

- `js/photo-loader.js` — NEW: local-photo loader with caching, 10 categories
- `assets/photos/*.jpg` — NEW: 96 stock photos (CC0 via Picsum/Unsplash), ~5.6MB
- `scripts/download-photos.sh` — NEW: bash script to refresh photo set
- `js/games/spot-the-difference.js` — FULL REWRITE: two photos + subtle mods
- `HANDOFF.md`, `README.md` — Updated to reflect Photo Hunt design

### Test Evidence (CDP-driven, headless Chrome 148)

- 5/5 modifications found via debug-hook taps → score 612 → game won
- Mouse clicks and touch events both register
- Zero JS exceptions across full session
- Photos render as real images (40/40 unique pixels per 40-sample set)
- Screenshots: `/tmp/hunt_menu.png`, `/tmp/hunt_gameplay.png`, `/tmp/hunt_results.png`

---

## Root Cause (actual, confirmed in browser)

All the earlier module-loading theories (circular imports, TDZ on `menuGames`,
DOMContentLoaded timing) were **wrong or secondary**. The real bug, revealed by loading
the page in Chrome and reading the console:

```
Uncaught ReferenceError: generateCityScene is not defined
    at js/games/spot-the-difference.js:41
```

`spot-the-difference.js` line 40-44 referenced three functions that **never existed
anywhere in the codebase**:

```js
const sceneGenerators = [
  generateCityScene,        // ❌ never defined
  generateUnderwaterScene,  // ❌ never defined
  generateSpaceScene,       // ❌ never defined
];
```

The real generators are **classes** (`CityScene`, `UnderwaterScene`, `SpaceScene`)
declared *later* in the file. The module threw during evaluation, so
`registerGame()` at the bottom of the file never ran → menu had zero cards →
clicks hit nothing. (Class declarations are also TDZ-bound, hence the lazy accessor.)

### Why it looked like a loading-order problem
The engine module loaded fine and drew the menu chrome (title, background), so the page
*looked* half-alive. The game module's crash was silent unless you opened the console.
**Lesson: read the browser console before theorizing.**

## Fixes Applied

1. **`js/games/spot-the-difference.js`** — replaced the phantom-function array with a
   lazy accessor returning the real classes:
   ```js
   function getSceneGenerators() {
     return [CityScene, UnderwaterScene, SpaceScene];
   }
   ```
   `generateRound()` now calls `pickRandom(getSceneGenerators())`, and the dead
   `diffScene`/`baseJSON` code in `generateRound()` was removed.

2. **Results screen never showed** — `gameOver` was set but nothing pushed the
   `results` screen. Added `pushScreen('results')` at all three end states
   (time-up in `update()`, win in `handlePointer()`, time-up via penalty).

3. **`js/engine.js` — `start()` could never fire on cached loads** — module scripts
   are deferred; if `DOMContentLoaded` already fired, the listener never runs.
   Added `if (document.readyState !== 'loading') start();` fallback.

4. **Play Again button** — was calling `launchGame(currentGame.constructor?.module)`
   (nonsense); now just `launchGame(currentGame)`.

5. **Debug hook** — `window.__bartopDebug` exposes `{screen, screenStack, games,
   gameData, running}` for automated testing. Harmless in production, do not remove;
   the CDP test scripts depend on it.

## Test Evidence (all run against real headless Chrome 148 via CDP)

`/tmp/cdp_playthrough.py` — full playthrough:
```
[PASS] no JS exceptions on load
[PASS] engine running, menu screen active
[PASS] game registered  games=['Spot the Difference']
[PASS] click card -> screen switched to playing
[PASS] 5 differences generated, timer counting down
[PASS] tap registered in game (wrong tap penalty applied)
[PASS] game reaches results screen on game over
[PASS] zero exceptions for entire session
```

`/tmp/cdp_results_buttons.py` — results navigation:
```
Play Again -> playing  PASS
Menu -> menu           PASS
menu -> play again     PASS
```

`/tmp/cdp_touch_test.py` — touch emulation (Input.dispatchTouchEvent):
```
TOUCH on card -> playing            PASS
touch in scene registers wrong/hit  PASS
```

Screenshots: `/tmp/arcade_menu.png`, `/tmp/arcade_splash.png`, `/tmp/arcade_gameplay.png`

## How to Re-Run the Tests

```bash
# 1. Serve the game
cd /home/andrew/bartop-arcade && python3 -m http.server 8091 --bind 127.0.0.1 &

# 2. Headless Chrome with CDP
/home/andrew/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome \
  --headless=new --remote-debugging-port=9222 --no-sandbox --disable-gpu \
  --user-data-dir=/tmp/bartop-chrome-profile about:blank &

# 3. Run tests (need `websockets` pip package)
python3 /tmp/cdp_playthrough.py
```

**Pitfall:** Chrome caches ES modules aggressively. Tests must send
`Network.setCacheDisabled` or you'll test stale code. For manual testing after an
update, hard-refresh (Ctrl+Shift+R).

## Architecture Notes for Future Games

- `index.html` loads `js/engine.js` then `js/games/<game>.js` as sibling
  `<script type="module">` tags (execute in order — this part was never broken).
- New game = new module: export default `{name, description, init, update, draw,
  handlePointer, cleanup}`, call `registerGame(module)` at module level, add one
  script tag to `index.html`.
- Engine owns: canvas scaling (1080×1920 logical), pointer+click+debounce input,
  screen stack (menu/playing/results), HUD, scoring data via get/setGameData.
- Game end: set `gameData.gameOver = true`, `gameData.won`, then `pushScreen('results')`.

## Photo System (v2 — 2026-09-06)

The procedural stick-figure scenes were replaced with **real stock photos** from
Picsum (served by Unsplash, CC0/free for commercial use). 96 photos in 10 themed
categories are pre-downloaded to `assets/photos/` via `scripts/download-photos.sh`.

- `js/photo-loader.js` — module that loads local photos with caching
- `js/games/spot-the-difference.js` — uses one photo, draws it on both sides, then
  overlays 5 of 10 modification types on the right side
- Modifications: red dot, yellow square, blue X, green triangle, cyan circle, pink
  star (geometric), and invert/darken/brighten/hue_shift patches (photo effects)
- Photo effects (invert etc.) require `getImageData`, which needs same-origin
  assets — hence the move from picsum.photos to local files

## Known Remaining Polish Items

- Photos downloaded from Picsum are somewhat random per seed — the themed
  category labels don't guarantee the photo content matches (e.g. "food:pizza"
  may not be pizza). For tighter curation, hand-pick seeds and replace the
  curl script with a static list.
- `drawScene()` (unused, half-written) still in the file from the procedural
  version; safe to delete.
- The procedural fallback system remains in code (`drawPhoto` shows a gradient
  placeholder if the image fails to load) — good safety net but never exercised
  in testing because local loads are instant.
