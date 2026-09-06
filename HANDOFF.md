# Handoff: Bartop Arcade — Spot the Difference

## Status: ⛔ Menu renders, clicks do nothing

**Project:** `goodrica/bartop-arcade` — HTML5 Canvas touchscreen mini-game collection
**Current bug:** The main menu screen appears ("BARTOP ARCADE", "TOUCH TO PLAY"), but clicking/tapping the screen does nothing. No game cards are present, and clicks have no effect.

---

## Investigation Needed

The menu renders because `engine.js` runs and draws the background. But:

1. **No game card appears** — the "Spot the Difference" card should appear under the title. If it doesn't, `registerGame()` either wasn't called or `menuGames` was empty when the menu drew.
2. **Clicks do nothing** — `handleMenuTap()` iterates `menuGames` to find hits but finds nothing.

## Module Loading Architecture

**index.html** loads two ES module scripts in order:
```html
<script type="module" src="js/engine.js"></script>
<script type="module" src="js/games/spot-the-difference.js"></script>
```

**ES module `<script>` tag execution is guaranteed to be DOM-order within each parse phase,** BUT: module scripts are **deferred by default** — they all execute after the HTML is parsed, in document order. So both execute before `DOMContentLoaded`.

**However**, there is a subtler issue: ES module evaluation is not strictly sequential for *sibling* `<script type="module">` tags in all browsers. The spec says they execute in order, but only after all module **dependency graphs** are resolved. There could be a case where the engine's static imports finish late or the game module's circular imports cause evaluation order issues despite the two-script-tag approach.

### The Circular Dependency

```
engine.js ─────imports─────→ audio.js (no issue)
engine.js ←──re-imports───── games/spot-the-difference.js
```

`spot-the-difference.js` does:
```js
import { registerGame, getGameData, setGameData, pushScreen } from '../engine.js';
import { PALETTE } from '../engine.js';
```

And at module level:
```js
registerGame(spotTheDifference);
```

When this circular import exists and both files are loaded as separate `<script type="module">` tags, the **first script tag** (engine.js) may resolve its static imports (audio.js ✓, no game import), then the **second script tag** (game.js) starts. But game.js imports from engine.js — since engine.js is already being evaluated as an **already-started module**, its exports may be **partially initialized** or the module evaluation may not be complete.

## What to Try

### Hypothesis 1: Live bindings vs. TDZ on circular re-import

Even with two `<script>` tags, if the browser's module loader recognizes that game.js imports engine.js (which is the *same module* as the first script), it may try to grab engine.js's exports before engine.js has finished its top-level execution. In ES modules, `const` declarations aren't initialized until the `const` statement executes — so `menuGames` might be in the TDZ or `undefined` when game.js tries to call `registerGame()`.

**Fix attempt:** Move `registerGame` and `menuGames` into a **separate shared module** that neither engine.js nor game.js has a circular relationship with:

```
registry.js ──→ exports { registerGame, menuGames }
engine.js   ──→ imports { registerGame, menuGames } from registry.js
game.js     ──→ imports { registerGame } from registry.js
```

This breaks the circular dependency entirely. No TDZ issues.

### Hypothesis 2: `DOMContentLoaded` fires before modules fully evaluate

Some environments fire `DOMContentLoaded` when the HTML is parsed but while module scripts are still fetching their imported dependencies. Since `start()` is inside the `DOMContentLoaded` callback, and the game loop immediately draws the menu (finding `menuGames` empty because the game module hasn't run yet), you'd see the menu but no cards.

**Fix:** Don't rely on DOMContentLoaded. Instead, have the game module explicitly **trigger** start when it registers:

```js
// In game.js
import { registerGame, signalGameReady } from '../engine.js';
registerGame(spotTheDifference);
signalGameReady();
```

Where `signalGameReady` increments a counter and calls `start()` only when all games are registered.

### Hypothesis 3: The click handler is wired to the wrong coordinates

The canvas is scaled via CSS. If `getBoundingClientRect()` returns 0,0 width/height before the CSS is applied, coordinates are wrong. This is unlikely since the menu draws correctly.

**Debug:** Add `console.log('Click at', x, y, 'menuGames:', menuGames.length)` inside `handleTap()` and check the browser console.

### Hypothesis 4: File:// protocol restrictions

If opening `index.html` directly as `file:///home/andrew/bartop-arcade/index.html`, ES modules require a server due to CORS. Always serve with:
```bash
python3 -m http.server 8080
```

---

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Entry point — two `<script type="module">` tags |
| `js/engine.js` | Core engine, game loop, menu drawing, HUD, touch/click handling |
| `js/audio.js` | Web Audio API procedural sounds |
| `js/games/spot-the-difference.js` | The game — scene generators, difference detection, scoring |

## Fixes Already Tried

1. **Circular static import** — Original code had `engine.js` static-importing the game module. Removed.
2. **Dynamic import** — Replaced with `import('./game.js')` in engine.js. Game never loaded silently.
3. **Two script tags (current)** — Separate `<script type="module">` for engine and game. Menu renders empty.

## Recommended Next Steps

1. **Break the circular dependency** — Extract `registerGame`, `menuGames`, `PALETTE` into a shared `js/registry.js` module. Neither engine nor game import each other.
2. **Remove `DOMContentLoaded`** — Have the game module signal readiness explicitly.
3. **Add a `console.log` in game.js** to verify it's even being executed:
   ```js
   console.log('🕹️ Spot the Difference module loaded, registering...');
   registerGame(spotTheDifference);
   console.log('✅ Registered! Total games:', menuGames.length);
   ```
4. **Verify with browser DevTools** — Open the Console tab. You should see logs. If you see nothing from game.js, the module never executed.

---

## Test Commands

```bash
# Serve locally (must use a server, not file://)
cd /home/andrew/bartop-arcade
python3 -m http.server 8080
# Open http://localhost:8080

# Check for JS errors in browser: F12 → Console tab
```