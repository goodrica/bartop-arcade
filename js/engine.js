/* ============================================
   Bartop Arcade - Game Engine
   ============================================
   Manages canvas, game loop, screen stack,
   touch input, and module loading.
   ============================================ */

import { AudioManager } from './audio.js';
// Game modules register via the separate <script type="module"> tag in index.html
// This avoids circular dependency issues (engine → game → engine)

// ── Colour Palette (retro neon on dark) ──
export const PALETTE = {
  bg:        '#0a0a0f',
  bgLight:   '#14142a',
  bgCard:    '#1a1a30',
  neonPink:  '#ff2d78',
  neonCyan:  '#00f0ff',
  neonGreen: '#39ff14',
  neonAmber: '#ffaa00',
  neonPurple:'#b44dff',
  white:     '#f0f0f0',
  dim:       '#555577',
  red:       '#ff3355',
  shadow:    'rgba(0,0,0,0.4)',
};

// ── Engine State ──
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Logical resolution (17" widescreen touchscreen, 1.78:1)
const W = 1920;
const H = 1080;

let currentGame = null;      // Loaded game module
let screenStack = [];        // 'menu' | 'playing' | 'results'
let gameData = {};           // Per-game state (score, timer, etc.)
let lastTime = 0;
let running = false;

// Touch / pointer state
let pointerActive = false;
let pointerX = 0;
let pointerY = 0;

// ── Canvas Sizing ──
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const maxW = window.innerWidth;
  const maxH = window.innerHeight;

  // Fit 1080x1920 into viewport maintaining aspect ratio
  const scale = Math.min(maxW / W, maxH / H);
  const w = Math.floor(W * scale);
  const h = Math.floor(H * scale);

  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ── Input Normalisation ──
function normalizePointer(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = W / rect.width;
  const scaleY = H / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function onPointerDown(e) {
  const p = normalizePointer(e.clientX, e.clientY);
  pointerActive = true;
  pointerX = p.x;
  pointerY = p.y;
  handleTap(p.x, p.y);
}

function onPointerMove(e) {
  const p = normalizePointer(e.clientX, e.clientY);
  pointerX = p.x;
  pointerY = p.y;
}

function onPointerUp(e) {
  pointerActive = false;
}

function onClick(e) {
  // Fallback for environments where pointerdown doesn't fire reliably
  const p = normalizePointer(e.clientX, e.clientY);
  handleTap(p.x, p.y);
}

let lastTapTime = 0;

// ── Tap Dispatcher ──
function handleTap(x, y) {
  // Debounce: ignore rapid duplicate taps (pointerdown + click on same press)
  const now = Date.now();
  if (now - lastTapTime < 100) return;
  lastTapTime = now;

  AudioManager.ensureInit();

  const top = screenStack[screenStack.length - 1];

  if (top === 'menu') {
    handleMenuTap(x, y);
  } else if (top === 'playing' && currentGame && currentGame.handlePointer) {
    currentGame.handlePointer(x, y);
  } else if (top === 'results') {
    handleResultsTap(x, y);
  }
}

// ── Menu ──
const menuGames = [];

export function registerGame(module) {
  menuGames.push(module);
}

function handleMenuTap(x, y) {
  const cardW = 900;
  const cardH = 200;
  const gap = 24;
  const startX = (W - cardW) / 2;
  const startY = 280;

  for (let i = 0; i < menuGames.length; i++) {
    const cy = startY + i * (cardH + gap);
    if (x >= startX && x <= startX + cardW && y >= cy && y <= cy + cardH) {
      launchGame(menuGames[i]);
      return;
    }
  }
}

function handleResultsTap(x, y) {
  // Buttons: two side-by-side at the bottom — see drawResults()
  const btnW = 360;
  const btnH = 100;
  const gap = 60;
  const totalBtnW = btnW * 2 + gap;
  const startX = (W - totalBtnW) / 2;
  const btnY = 800;

  // "Play Again" button (left)
  if (x >= startX && x <= startX + btnW && y >= btnY && y <= btnY + btnH) {
    if (currentGame) launchGame(currentGame);
    else screenStack = ['menu'];
    return;
  }
  // "Menu" button (right)
  const menuX = startX + btnW + gap;
  if (x >= menuX && x <= menuX + btnW && y >= btnY && y <= btnY + btnH) {
    screenStack = ['menu'];
    if (currentGame && currentGame.cleanup) currentGame.cleanup();
    currentGame = null;
    return;
  }
}

// ── Game Launch ──
async function launchGame(module) {
  if (currentGame && currentGame.cleanup) currentGame.cleanup();
  currentGame = module;
  screenStack = ['playing'];
  gameData = {
    score: 0,
    timeRemaining: 60,
    totalTime: 60,
    found: 0,
    total: 0,
    wrongTaps: 0,
    gameOver: false,
  };
  if (currentGame.init) await currentGame.init(canvas, ctx);
}

// ── Screen Stack ──
export function pushScreen(name) {
  screenStack.push(name);
}

export function popScreen() {
  screenStack.pop();
}

// ── Game Data Access ──
export function getGameData() {
  return gameData;
}

export function setGameData(updates) {
  Object.assign(gameData, updates);
}

// ── Drawing: Menu ──
// Layout: 1920x1080 landscape. Title at top-center, game cards in a
// vertical stack on the left half, info/credits on the right.
function drawMenu() {
  // Background
  const grad = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 1400);
  grad.addColorStop(0, PALETTE.bgLight);
  grad.addColorStop(1, PALETTE.bg);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Decorative grid dots
  ctx.fillStyle = PALETTE.dim;
  for (let x = 0; x < W; x += 80) {
    for (let y = 0; y < H; y += 80) {
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Title — centered top
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.shadowColor = PALETTE.neonCyan;
  ctx.shadowBlur = 50;
  ctx.fillStyle = PALETTE.neonCyan;
  ctx.font = 'bold 88px "Courier New", monospace';
  ctx.fillText('BARTOP', W / 2, 70);
  ctx.shadowColor = PALETTE.neonPink;
  ctx.shadowBlur = 50;
  ctx.fillStyle = PALETTE.neonPink;
  ctx.fillText('ARCADE', W / 2, 170);
  ctx.shadowBlur = 0;

  // Subtitle
  ctx.fillStyle = PALETTE.dim;
  ctx.font = '24px "Courier New", monospace';
  ctx.fillText('TOUCH A CARD TO PLAY', W / 2, 230);

  // Game cards — full-width stack, top-center area
  const cardW = 900;
  const cardH = 200;
  const gap = 24;
  const startX = (W - cardW) / 2;
  const startY = 280;

  for (let i = 0; i < menuGames.length; i++) {
    const cy = startY + i * (cardH + gap);
    if (cy + cardH > H - 80) break;  // off-screen guard
    const game = menuGames[i];
    const isHovered = pointerActive && pointerX >= startX && pointerX <= startX + cardW &&
                                  pointerY >= cy && pointerY <= cy + cardH;

    // Card bg
    ctx.shadowColor = PALETTE.shadow;
    ctx.shadowBlur = 20;
    ctx.fillStyle = isHovered ? PALETTE.bgLight : PALETTE.bgCard;
    roundRect(ctx, startX, cy, cardW, cardH, 20);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Neon border
    ctx.strokeStyle = isHovered ? PALETTE.neonCyan : PALETTE.dim;
    ctx.lineWidth = isHovered ? 3 : 1;
    roundRect(ctx, startX, cy, cardW, cardH, 20);
    ctx.stroke();

    // Game icon
    ctx.fillStyle = PALETTE.dim;
    ctx.font = '52px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('▶', startX + 50, cy + cardH / 2);

    // Game name
    ctx.fillStyle = PALETTE.white;
    ctx.font = 'bold 42px "Courier New", monospace';
    ctx.fillText(game.name || 'Unknown Game', startX + 130, cy + cardH / 2 - 14);

    // Description
    ctx.fillStyle = PALETTE.dim;
    ctx.font = '24px "Courier New", monospace';
    ctx.fillText(game.description || '', startX + 130, cy + cardH / 2 + 30);

    // Play indicator
    ctx.fillStyle = isHovered ? PALETTE.neonGreen : PALETTE.dim;
    ctx.font = '28px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(isHovered ? '▶ PLAY' : '•', startX + cardW - 50, cy + cardH / 2);
  }

  // Footer
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.dim;
  ctx.font = '20px "Courier New", monospace';
  ctx.fillText('v1.0 — Inspired by arcade classics', W / 2, H - 30);
}

// ── Drawing: HUD during gameplay ──
// Horizontal bar at top, score/found/timer on left, right, center.
function drawHUD() {
  const { score, timeRemaining, totalTime, found, total } = gameData;

  // Top bar background
  const barH = 100;
  ctx.fillStyle = 'rgba(10, 10, 15, 0.85)';
  ctx.fillRect(0, 0, W, barH);

  // Score — left
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.neonAmber;
  ctx.font = 'bold 36px "Courier New", monospace';
  ctx.fillText(`SCORE: ${score}`, 40, 40);

  // Found / Total — under score
  ctx.fillStyle = PALETTE.white;
  ctx.font = '28px "Courier New", monospace';
  ctx.fillText(`${found} / ${total}`, 40, 78);

  // Timer — right
  ctx.textAlign = 'right';
  const timeColor = timeRemaining <= 10 ? PALETTE.neonPink : PALETTE.neonCyan;
  ctx.fillStyle = timeColor;
  ctx.font = 'bold 36px "Courier New", monospace';
  const mins = Math.floor(timeRemaining / 60);
  const secs = Math.floor(timeRemaining % 60);
  ctx.fillText(`${mins}:${secs.toString().padStart(2, '0')}`, W - 40, 40);

  // Label under timer
  ctx.fillStyle = PALETTE.dim;
  ctx.font = '24px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('TIME', W / 2, 78);

  // Timer bar across the bottom of the HUD
  const barW = W - 80;
  const barBh = 6;
  const barY = 90;
  const ratio = Math.max(0, timeRemaining / totalTime);

  ctx.fillStyle = PALETTE.bgLight;
  roundRect(ctx, 40, barY, barW, barBh, 3);
  ctx.fill();

  ctx.fillStyle = timeColor;
  roundRect(ctx, 40, barY, barW * ratio, barBh, 3);
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Drawing: Results ──
// 1920x1080 landscape: title at top, stats centered, buttons side-by-side at bottom.
function drawResults() {
  const { score, found, total, wrongTaps, won } = gameData;

  // Background
  ctx.fillStyle = 'rgba(10, 10, 15, 0.95)';
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (won) {
    ctx.shadowColor = PALETTE.neonGreen;
    ctx.shadowBlur = 60;
    ctx.fillStyle = PALETTE.neonGreen;
    ctx.font = 'bold 88px "Courier New", monospace';
    ctx.fillText('YOU WIN!', W / 2, 180);
    ctx.shadowBlur = 0;
  } else {
    ctx.shadowColor = PALETTE.neonPink;
    ctx.shadowBlur = 60;
    ctx.fillStyle = PALETTE.neonPink;
    ctx.font = 'bold 88px "Courier New", monospace';
    ctx.fillText("TIME'S UP", W / 2, 180);
    ctx.shadowBlur = 0;
  }

  // Big score
  ctx.fillStyle = PALETTE.neonAmber;
  ctx.font = 'bold 140px "Courier New", monospace';
  ctx.fillText(score, W / 2, 400);

  // Stats
  ctx.fillStyle = PALETTE.white;
  ctx.font = '38px "Courier New", monospace';
  ctx.fillText(`${found} / ${total} differences found`, W / 2, 580);

  ctx.fillStyle = PALETTE.dim;
  ctx.font = '30px "Courier New", monospace';
  ctx.fillText(`Wrong taps: ${wrongTaps}`, W / 2, 640);

  // Buttons — side by side at bottom
  const btnW = 360;
  const btnH = 100;
  const gap = 60;
  const totalBtnW = btnW * 2 + gap;
  const startX = (W - totalBtnW) / 2;
  const btnY = 800;

  // Play Again
  const paX = startX;
  const isHoverPA = pointerActive && pointerX >= paX && pointerX <= paX + btnW &&
                                 pointerY >= btnY && pointerY <= btnY + btnH;
  ctx.shadowColor = PALETTE.shadow;
  ctx.shadowBlur = 15;
  ctx.fillStyle = isHoverPA ? PALETTE.neonCyan : PALETTE.bgCard;
  roundRect(ctx, paX, btnY, btnW, btnH, 16);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = PALETTE.neonCyan;
  ctx.lineWidth = 2;
  roundRect(ctx, paX, btnY, btnW, btnH, 16);
  ctx.stroke();
  ctx.fillStyle = PALETTE.white;
  ctx.font = 'bold 36px "Courier New", monospace';
  ctx.fillText('PLAY AGAIN', paX + btnW / 2, btnY + btnH / 2);

  // Menu
  const mX = startX + btnW + gap;
  const isHoverM = pointerActive && pointerX >= mX && pointerX <= mX + btnW &&
                                pointerY >= btnY && pointerY <= btnY + btnH;
  ctx.fillStyle = isHoverM ? PALETTE.neonPurple : PALETTE.bgCard;
  roundRect(ctx, mX, btnY, btnW, btnH, 16);
  ctx.fill();
  ctx.strokeStyle = PALETTE.neonPurple;
  ctx.lineWidth = 2;
  roundRect(ctx, mX, btnY, btnW, btnH, 16);
  ctx.stroke();
  ctx.fillStyle = PALETTE.white;
  ctx.font = 'bold 36px "Courier New", monospace';
  ctx.fillText('MENU', mX + btnW / 2, btnY + btnH / 2);
}

// ── Main Loop ──
function gameLoop(timestamp) {
  if (!running) return;

  const dt = lastTime ? Math.min((timestamp - lastTime) / 1000, 0.1) : 1 / 60;
  lastTime = timestamp;

  const top = screenStack[screenStack.length - 1];

  // Update
  if (top === 'playing' && currentGame && currentGame.update && !gameData.gameOver) {
    currentGame.update(dt);
  }

  // Draw
  ctx.clearRect(0, 0, W, H);

  if (top === 'menu') {
    drawMenu();
  } else if (top === 'playing') {
    if (currentGame && currentGame.draw) {
      currentGame.draw(ctx);
    }
    drawHUD();
  } else if (top === 'results') {
    drawResults();
  }

  requestAnimationFrame(gameLoop);
}

// ── Start ──
export function start() {
  if (running) return;
  running = true;

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Pointer events (unified for mouse + touch)
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  // Click fallback — some environments need this
  canvas.addEventListener('click', onClick);

  // Prevent context menu
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  screenStack = ['menu'];
  lastTime = 0;
  requestAnimationFrame(gameLoop);
}

// ── Auto-start when DOM is ready ──
// Both engine.js and game modules are loaded as separate <script type="module">
// tags in the HTML, so they execute in DOM order (engine first, games second).
// We wait for DOMContentLoaded to guarantee both modules are fully evaluated,
// then kick off the game loop.
document.addEventListener('DOMContentLoaded', () => {
  start();
});

// Module scripts are deferred, so DOMContentLoaded may have ALREADY fired
// by the time this module evaluates (e.g. cached loads). Cover that case.
if (document.readyState !== 'loading') {
  start();
}

// ── Debug hook (used by automated tests; harmless in production) ──
window.__bartopDebug = {
  get screen() { return screenStack[screenStack.length - 1]; },
  get screenStack() { return [...screenStack]; },
  get games() { return menuGames.map(g => g.name); },
  get gameData() { return { ...gameData }; },
  get running() { return running; },
};