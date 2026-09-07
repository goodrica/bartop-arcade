# Bartop Arcade 🕹️

A modern bartop arcade mini-game collection inspired by classics like Megatouch. Built for touchscreen displays — pure HTML5 Canvas, zero dependencies, works in any modern browser.

## 🎮 Games

| Game | Status | Description |
|------|--------|-------------|
| **Photo Hunt** (Spot the Difference) | ✅ Ready | Megatouch-style: real stock photos with 5 visible changes on the right side. 60-second timer, 10 themed photo categories. |
| More coming soon | 🚧 | Memory Match, Whack-a-Mole, Reaction Test, Simon Says... |

## 🚀 How to Play

1. Open `index.html` in any modern browser, or visit the GitHub Pages link
2. Touch the screen to select a game
3. Touch the differences you find — correct = points, wrong = time penalty

**Optimized for 17" widescreen touchscreen monitor (1920×1080 logical resolution, landscape).** Photos are 1360×900 (1.51:1 aspect ratio).

## 🏗 Architecture

```
bartop-arcade/
├── index.html           # Entry point
├── css/
│   └── style.css        # Base styles (canvas, touch prevention)
├── js/
│   ├── engine.js        # Core engine: game loop, menu, HUD, touch, screen stack
│   ├── audio.js         # Web Audio API procedural sound effects
│   └── games/
│       └── spot-the-difference.js  # Spot the Difference module
└── README.md
```

### Adding a New Game

Each game is a module that exports the standard interface:

```js
export default {
  name: 'Your Game',
  description: 'Short description',
  async init(canvas, ctx) { /* setup */ },
  update(dt) { /* per-frame logic */ },
  draw(ctx) { /* per-frame rendering */ },
  handlePointer(x, y) { /* tap/click handler */ },
  cleanup() { /* teardown */ },
};
```

Then call `registerGame(yourModule)` to add it to the menu.

## 🎨 Design

- **Resolution:** 1080×1920 (portrait) — scales to any screen
- **Palette:** Retro neon on dark backgrounds
- **Audio:** Procedural oscillator-based (square/sawtooth/sine) — no audio files
- **Touch:** Min 64px hit targets, `touch-action: none` to prevent browser gestures

## 🧪 Running Locally

```bash
# Using Python (no server needed for basic HTML)
python3 -m http.server 8080
# Then open http://localhost:8080
```

Or just double-click `index.html` in your file manager.

## 🤝 Contributing

This project is designed for AI-agent collaboration. Each game is a self-contained module. To add a new game:
1. Create `js/games/your-game.js`
2. Follow the module interface above
3. Call `registerGame()` at the bottom
4. Build and test in your browser

---

*Built by Hermes Agent for goodrica/bartop-arcade*