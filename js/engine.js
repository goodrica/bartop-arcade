/* ============================================
   Bartop Arcade - Game Engine
   ============================================
   Manages canvas, game loop, screen stack,
   touch input, and module loading.
   ============================================ */

import { AudioManager } from './audio.js';
import './games/spot-the-difference.js';

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

// Logical resolution (portrait touchscreen)
const W = 1080;
const H = 1920;

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
  const cardH = 260;
  const gap = 30;
  const startY = 400;

  for (let i = 0; i < menuGames.length; i++) {
    const cy = startY + i * (cardH + gap);
    if (x >= 90 && x <= 990 && y >= cy && y <= cy + cardH) {
      launchGame(menuGames[i]);
      return;
    }
  }
}

function handleResultsTap(x, y) {
  // "Play Again" button
  if (x >= 340 && x <= 740 && y >= 1400 && y <= 1520) {
    screenStack.pop();
    if (currentGame) launchGame(currentGame.constructor?.module || currentGame);
    else pushScreen('menu');
    return;
  }
  // "Menu" button
  if (x >= 340 && x <= 740 && y >= 1560 && y <= 1680) {
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
function drawMenu() {
  // Background
  const grad = ctx.createRadialGradient(540, 960, 100, 540, 960, 1200);
  grad.addColorStop(0, PALETTE.bgLight);
  grad.addColorStop(1, PALETTE.bg);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Decorative grid dots
  ctx.fillStyle = PALETTE.dim;
  for (let x = 0; x < W; x += 60) {
    for (let y = 0; y < H; y += 60) {
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Title
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Glow for title
  ctx.shadowColor = PALETTE.neonCyan;
  ctx.shadowBlur = 40;
  ctx.fillStyle = PALETTE.neonCyan;
  ctx.font = 'bold 96px "Courier New", monospace';
  ctx.fillText('BARTOP', 540, 140);
  ctx.shadowColor = PALETTE.neonPink;
  ctx.shadowBlur = 40;
  ctx.fillStyle = PALETTE.neonPink;
  ctx.fillText('ARCADE', 540, 260);
  ctx.shadowBlur = 0;

  // Subtitle
  ctx.fillStyle = PALETTE.dim;
  ctx.font = '28px "Courier New", monospace';
  ctx.fillText('TOUCH TO PLAY', 540, 330);

  // Game cards
  const cardW = 900;
  const cardH = 260;
  const gap = 30;
  const startY = 400;

  for (let i = 0; i < menuGames.length; i++) {
    const cy = startY + i * (cardH + gap);
    const game = menuGames[i];
    const isHovered = pointerActive && pointerX >= 90 && pointerX <= 990 && pointerY >= cy && pointerY <= cy + cardH;

    // Card bg
    ctx.shadowColor = PALETTE.shadow;
    ctx.shadowBlur = 20;
    ctx.fillStyle = isHovered ? PALETTE.bgLight : PALETTE.bgCard;
    roundRect(ctx, 90, cy, cardW, cardH, 24);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Neon border
    ctx.strokeStyle = isHovered ? PALETTE.neonCyan : PALETTE.dim;
    ctx.lineWidth = isHovered ? 3 : 1;
    roundRect(ctx, 90, cy, cardW, cardH, 24);
    ctx.stroke();

    // Game icon placeholder
    ctx.fillStyle = PALETTE.dim;
    ctx.font = '64px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('▶', 140, cy + cardH / 2);

    // Game name
    ctx.fillStyle = PALETTE.white;
    ctx.font = 'bold 48px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(game.name || 'Unknown Game', 230, cy + cardH / 2 - 10);

    // Description
    ctx.fillStyle = PALETTE.dim;
    ctx.font = '26px "Courier New", monospace';
    ctx.fillText(game.description || '', 230, cy + cardH / 2 + 50);

    // Play indicator
    ctx.fillStyle = isHovered ? PALETTE.neonGreen : PALETTE.dim;
    ctx.font = '32px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(isHovered ? '▶ PLAY' : '•', 960, cy + cardH / 2);
  }

  // Footer
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.dim;
  ctx.font = '20px "Courier New", monospace';
  ctx.fillText('v1.0 — Inspired by arcade classics', 540, H - 60);
}

// ── Drawing: HUD during gameplay ──
function drawHUD() {
  const { score, timeRemaining, totalTime, found, total } = gameData;

  // Top bar background
  ctx.fillStyle = 'rgba(10, 10, 15, 0.85)';
  ctx.fillRect(0, 0, W, 120);

  // Score
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.neonAmber;
  ctx.font = 'bold 40px "Courier New", monospace';
  ctx.fillText(`SCORE: ${score}`, 40, 60);

  // Found / Total
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.white;
  ctx.font = '36px "Courier New", monospace';
  ctx.fillText(`${found} / ${total}`, 540, 60);

  // Timer
  ctx.textAlign = 'right';
  const timeColor = timeRemaining <= 10 ? PALETTE.neonPink : PALETTE.neonCyan;
  ctx.fillStyle = timeColor;
  ctx.font = 'bold 40px "Courier New", monospace';
  const mins = Math.floor(timeRemaining / 60);
  const secs = Math.floor(timeRemaining % 60);
  ctx.fillText(`${mins}:${secs.toString().padStart(2, '0')}`, W - 40, 60);

  // Timer bar
  const barW = W - 80;
  const barH = 8;
  const barY = 100;
  const ratio = Math.max(0, timeRemaining / totalTime);

  ctx.fillStyle = PALETTE.bgLight;
  roundRect(ctx, 40, barY, barW, barH, 4);
  ctx.fill();

  ctx.fillStyle = timeColor;
  roundRect(ctx, 40, barY, barW * ratio, barH, 4);
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
function drawResults() {
  const { score, found, total, wrongTaps, won } = gameData;

  // Background
  ctx.fillStyle = 'rgba(10, 10, 15, 0.95)';
  ctx.fillRect(0, 0, W, H);

  // Title
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (won) {
    ctx.shadowColor = PALETTE.neonGreen;
    ctx.shadowBlur = 60;
    ctx.fillStyle = PALETTE.neonGreen;
    ctx.font = 'bold 80px "Courier New", monospace';
    ctx.fillText('YOU WIN!', 540, 300);
    ctx.shadowBlur = 0;
  } else {
    ctx.shadowColor = PALETTE.neonPink;
    ctx.shadowBlur = 60;
    ctx.fillStyle = PALETTE.neonPink;
    ctx.font = 'bold 80px "Courier New", monospace';
    ctx.fillText('TIME\'S UP!', 540, 300);
    ctx.shadowBlur = 0;
  }

  // Score big
  ctx.fillStyle = PALETTE.neonAmber;
  ctx.font = 'bold 120px "Courier New", monospace';
  ctx.fillText(score, 540, 520);

  // Stats
  ctx.fillStyle = PALETTE.white;
  ctx.font = '40px "Courier New", monospace';
  ctx.fillText(`${found} / ${total} differences found`, 540, 700);

  ctx.fillStyle = PALETTE.dim;
  ctx.font = '32px "Courier New", monospace';
  ctx.fillText(`Wrong taps: ${wrongTaps}`, 540, 780);

  // Buttons
  // Play Again
  const isHoverPA = pointerActive && pointerX >= 340 && pointerX <= 740 && pointerY >= 1400 && pointerY <= 1520;
  ctx.shadowColor = PALETTE.shadow;
  ctx.shadowBlur = 15;
  ctx.fillStyle = isHoverPA ? PALETTE.neonCyan : PALETTE.bgCard;
  roundRect(ctx, 340, 1400, 400, 120, 20);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = PALETTE.neonCyan;
  ctx.lineWidth = 2;
  roundRect(ctx, 340, 1400, 400, 120, 20);
  ctx.stroke();
  ctx.fillStyle = PALETTE.white;
  ctx.font = 'bold 40px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('PLAY AGAIN', 540, 1460);

  // Menu
  const isHoverM = pointerActive && pointerX >= 340 && pointerX <= 740 && pointerY >= 1560 && pointerY <= 1680;
  ctx.fillStyle = isHoverM ? PALETTE.neonPurple : PALETTE.bgCard;
  roundRect(ctx, 340, 1560, 400, 120, 20);
  ctx.fill();
  ctx.strokeStyle = PALETTE.neonPurple;
  ctx.lineWidth = 2;
  roundRect(ctx, 340, 1560, 400, 120, 20);
  ctx.stroke();
  ctx.fillStyle = PALETTE.white;
  ctx.font = 'bold 40px "Courier New", monospace';
  ctx.fillText('MENU', 540, 1620);
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

// ── Auto-start when module loads ──
start();