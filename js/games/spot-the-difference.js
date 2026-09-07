/* ============================================
   Bartop Arcade - Photo Hunt (Spot the Difference)
   ============================================
   Inspired by Megatouch's "Photo Hunt".
   Uses PRE-GENERATED photo pairs created by
   scripts/photo_editor.py — real PIL-based
   object-level edits (removals, color swaps,
   synthetic objects, texture patches).

   The modified photo is loaded as a separate
   image file alongside its JSON diff manifest.
   No runtime pixel manipulation needed.
   ============================================ */

import { AudioManager } from '../audio.js';
import { registerGame, getGameData, setGameData, pushScreen, getLevel, incrementLevel, resetLevel } from '../engine.js';
import { PALETTE } from '../engine.js';

// ── Layout (logical canvas pixels, 1920x1080 landscape) ──
const DISPLAY_PHOTO_W = 920;
const DISPLAY_PHOTO_H = 609;
const PANE_GAP        = 16;
const PANE_X_LEFT     = (1920 - (DISPLAY_PHOTO_W * 2 + PANE_GAP)) / 2;
const PANE_X_RIGHT    = PANE_X_LEFT + DISPLAY_PHOTO_W + PANE_GAP;
const PANE_Y          = 130;

const SCENE_W = DISPLAY_PHOTO_W;
const SCENE_H = DISPLAY_PHOTO_H;

// ── Difficulty scaling ──
function difficultyMultiplier(level) {
  const map = { 1: 1.5, 2: 1.4, 3: 1.3 };
  return map[level] || 1.0;
}

const TOTAL_DIFFERENCES = 5;
const TIME_LIMIT        = 60;
const PENALTY_TIME      = 5;
const SCORE_CORRECT     = 100;
const SCORE_BONUS_MULT  = 2;
const PHOTO_HIT_RADIUS  = 55;

// ── Pre-generated photo pairs ──
// Each entry maps a base photo filename to its modified version + diffs.
// The editor script (scripts/photo_editor.py) produces {name}__modified.jpg
// and {name}__mods.json.
const PHOTO_PAIRS = [
  { base: 'purchased__tennis-girls',   modified: 'purchased__tennis-girls__modified' },
  { base: 'purchased__sierra-mountains', modified: 'purchased__sierra-mountains__modified' },
];

// ── Per-round state ──
let leftImg         = null;   // Reference photo (original)
let rightImg        = null;   // Modified photo (pre-generated)
let differences     = [];     // Loaded from mods JSON
let foundParticles  = [];
let wrongFlash      = 0;
let warningFlash    = 0;
let splashTimer     = 2.0;
let lastTickSecond  = -1;
let loadError       = null;

// ── Photo loading ──

function loadImage(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${path}`));
    img.src = path;
  });
}

async function generateRound() {
  loadError = null;

  // Pick a pair
  const pair = PHOTO_PAIRS[Math.floor(Math.random() * PHOTO_PAIRS.length)];
  const basePath = `assets/photos/${pair.base}.jpg`;
  const modPath  = `assets/photos/${pair.modified}.jpg`;
  const jsonPath = `assets/photos/${pair.base}__mods.json`;

  try {
    // Load both images + the diff manifest in parallel
    const [left, right, modsData] = await Promise.all([
      loadImage(basePath),
      loadImage(modPath),
      fetch(jsonPath).then(r => {
        if (!r.ok) throw new Error('JSON not found');
        return r.json();
      }),
    ]);

    leftImg = left;
    rightImg = right;

    // Scale source coords (1360×900) to display coords (920×609)
    const sx = SCENE_W / 1360;
    const sy = SCENE_H / 900;

    // Apply difficulty scaling to hit zones
    const diff = difficultyMultiplier(getLevel());

    differences = modsData.map((m, i) => ({
      key: `${m.type}-${i}`,
      type: m.type,
      hint: m.hint,
      x: Math.round(m.x * sx),
      y: Math.round(m.y * sy),
      hitR: Math.round((m.hitR || 50) * sx * diff),
      found: false,
    }));
  } catch (e) {
    loadError = e;
    console.error('[Photo Hunt]', e.message);
    return false;
  }

  return true;
}

// ── Photo drawing (object-fit: cover — crop to fill, no stretch) ──
function drawPhotoCover(ctx, img, dstX, dstY, dstW, dstH) {
  if (!img || !img.complete || img.naturalWidth === 0) {
    const grad = ctx.createLinearGradient(dstX, dstY, dstX, dstY + dstH);
    grad.addColorStop(0, '#1a1a3a');
    grad.addColorStop(1, '#2a2a50');
    ctx.fillStyle = grad;
    ctx.fillRect(dstX, dstY, dstW, dstH);
    return;
  }
  const srcAspect = img.naturalWidth / img.naturalHeight;
  const dstAspect = dstW / dstH;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (srcAspect > dstAspect) {
    sw = img.naturalHeight * dstAspect;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / dstAspect;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dstX, dstY, dstW, dstH);
}

// ── Drawing helpers ──

function drawPhotoFrame(ctx, x, y, w, h) {
  ctx.save();
  ctx.shadowColor = PALETTE.neonCyan;
  ctx.shadowBlur = 18;
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
  ctx.lineWidth = 2;
  roundRectPath(ctx, x, y, w, h, 12);
  ctx.stroke();
  ctx.restore();
}

function roundRectPath(ctx, x, y, w, h, r) {
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

function drawFoundHighlight(ctx, mod, sceneX, sceneY) {
  const cx = sceneX + mod.x;
  const cy = sceneY + mod.y;
  const r = mod.hitR * 0.8;

  ctx.save();
  ctx.globalAlpha = 0.7;

  ctx.strokeStyle = PALETTE.neonGreen;
  ctx.lineWidth = 4;
  ctx.shadowColor = PALETTE.neonGreen;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Check mark
  ctx.strokeStyle = PALETTE.neonGreen;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.4, cy);
  ctx.lineTo(cx - r * 0.05, cy + r * 0.35);
  ctx.lineTo(cx + r * 0.45, cy - r * 0.35);
  ctx.stroke();

  ctx.restore();
}

function drawSplash(ctx) {
  ctx.fillStyle = 'rgba(10,10,15,0.92)';
  ctx.fillRect(0, 0, 1920, 1080);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const level = getLevel();
  ctx.fillStyle = PALETTE.dim;
  ctx.font = 'bold 28px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`LEVEL ${level}`, 40, 50);
  ctx.textAlign = 'center';

  ctx.shadowColor = PALETTE.neonCyan;
  ctx.shadowBlur = 60;
  ctx.fillStyle = PALETTE.neonCyan;
  ctx.font = 'bold 96px "Courier New", monospace';
  ctx.fillText('PHOTO', 960, 320);
  ctx.shadowColor = PALETTE.neonPink;
  ctx.shadowBlur = 60;
  ctx.fillStyle = PALETTE.neonPink;
  ctx.fillText('HUNT', 960, 440);
  ctx.shadowBlur = 0;

  ctx.fillStyle = PALETTE.white;
  ctx.font = '36px "Courier New", monospace';
  ctx.fillText(`Find ${TOTAL_DIFFERENCES} subtle differences in ${TIME_LIMIT} seconds`, 960, 540);

  ctx.fillStyle = PALETTE.dim;
  ctx.font = '28px "Courier New", monospace';
  ctx.fillText('Wrong taps cost 5 seconds', 960, 600);

  if (level <= 3) {
    const bonusMap = { 1: 50, 2: 40, 3: 30 };
    ctx.fillStyle = PALETTE.neonGreen;
    ctx.font = 'bold 28px "Courier New", monospace';
    ctx.fillText(`LEVEL ${level}: ${bonusMap[level]}% EASIER`, 960, 660);
  }

  const count = Math.ceil(splashTimer);
  ctx.fillStyle = PALETTE.neonAmber;
  ctx.font = 'bold 200px "Courier New", monospace';
  ctx.fillText(count, 960, 800);

  ctx.fillStyle = PALETTE.dim;
  ctx.font = '24px "Courier New", monospace';
  ctx.fillText('Loading photos…', 960, 1000);
}

function drawLoading(ctx, data) {
  ctx.fillStyle = 'rgba(10,10,15,0.85)';
  ctx.fillRect(0, 0, 1920, 1080);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.white;
  ctx.font = 'bold 56px "Courier New", monospace';
  ctx.fillText('LOADING PHOTOS…', 960, 500);

  if (loadError) {
    ctx.fillStyle = PALETTE.red;
    ctx.font = '28px "Courier New", monospace';
    ctx.fillText('Photos failed to load — ending round', 960, 600);
  } else {
    const t = Date.now() / 200;
    ctx.strokeStyle = PALETTE.neonCyan;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(960, 750, 80, t, t + Math.PI * 1.4);
    ctx.stroke();
  }
}

// ── Game module ──
const spotTheDifference = {
  name: 'Photo Hunt',
  description: 'Spot 5 subtle differences between two photos. 60 seconds. Find them!',

  async init() {
    leftImg = null;
    rightImg = null;
    differences = [];
    foundParticles = [];
    wrongFlash = 0;
    warningFlash = 0;
    splashTimer = 2.0;
    lastTickSecond = -1;
    loadError = null;

    setGameData({
      score: 0,
      timeRemaining: TIME_LIMIT,
      totalTime: TIME_LIMIT,
      found: 0,
      total: TOTAL_DIFFERENCES,
      wrongTaps: 0,
      gameOver: false,
      won: false,
      loading: true,
    });

    generateRound().then(ok => {
      const data = getGameData();
      data.loading = false;
      if (ok) data.total = differences.length;
      else data.total = 0;
      setGameData(data);
    });
  },

  update(dt) {
    const data = getGameData();
    if (data.gameOver) return;

    if (splashTimer > 0) { splashTimer -= dt; return; }
    if (data.loading) return;

    if (differences.length === 0) {
      data.gameOver = true;
      data.won = false;
      pushScreen('results');
      return;
    }

    data.timeRemaining -= dt;

    const curSec = Math.floor(data.timeRemaining);
    if (curSec >= 0 && curSec <= 10 && curSec !== lastTickSecond) {
      AudioManager.playTick();
      warningFlash = 0.3;
      lastTickSecond = curSec;
    }
    if (warningFlash > 0) warningFlash -= dt;
    if (wrongFlash > 0) wrongFlash -= dt;

    for (let i = foundParticles.length - 1; i >= 0; i--) {
      const p = foundParticles[i];
      p.life -= dt;
      p.radius += dt * 70;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) foundParticles.splice(i, 1);
    }

    if (data.timeRemaining <= 0) {
      data.timeRemaining = 0;
      data.gameOver = true;
      data.won = false;
      AudioManager.playGameOver();
      pushScreen('results');
    }
  },

  draw(ctx) {
    const data = getGameData();

    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, 1920, 1080);

    if (splashTimer > 0) { drawSplash(ctx); return; }
    if (data.loading || !leftImg || !rightImg) { drawLoading(ctx, data); return; }

    // Photo borders
    drawPhotoFrame(ctx, PANE_X_LEFT, PANE_Y, SCENE_W, SCENE_H);
    drawPhotoFrame(ctx, PANE_X_RIGHT, PANE_Y, SCENE_W, SCENE_H);

    // LEFT — original reference
    ctx.save();
    roundRectPath(ctx, PANE_X_LEFT, PANE_Y, SCENE_W, SCENE_H, 12);
    ctx.clip();
    drawPhotoCover(ctx, leftImg, PANE_X_LEFT, PANE_Y, SCENE_W, SCENE_H);
    ctx.restore();

    // RIGHT — pre-generated modified photo (loaded as a regular image)
    ctx.save();
    roundRectPath(ctx, PANE_X_RIGHT, PANE_Y, SCENE_W, SCENE_H, 12);
    ctx.clip();
    drawPhotoCover(ctx, rightImg, PANE_X_RIGHT, PANE_Y, SCENE_W, SCENE_H);
    ctx.restore();

    // Labels
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px "Courier New", monospace';
    ctx.fillStyle = PALETTE.dim;
    ctx.fillText('REFERENCE', PANE_X_LEFT + SCENE_W / 2, PANE_Y - 12);
    ctx.fillText('FIND CHANGES', PANE_X_RIGHT + SCENE_W / 2, PANE_Y - 12);

    // Found-difference highlights
    for (const mod of differences) {
      if (!mod.found) continue;
      drawFoundHighlight(ctx, mod, PANE_X_LEFT, PANE_Y);
      drawFoundHighlight(ctx, mod, PANE_X_RIGHT, PANE_Y);
    }

    // Found particles
    for (const p of foundParticles) {
      ctx.globalAlpha = p.alpha;
      ctx.strokeStyle = PALETTE.neonGreen;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (wrongFlash > 0) {
      ctx.fillStyle = `rgba(255, 51, 85, ${wrongFlash * 0.5})`;
      ctx.fillRect(0, 0, 1920, 1080);
    }

    if (data.timeRemaining <= 10 && warningFlash > 0) {
      const a = Math.sin(Date.now() / 150) * 0.12 + 0.12;
      ctx.fillStyle = `rgba(255, 51, 85, ${a})`;
      ctx.fillRect(0, 0, 1920, 110);
    }
  },

  handlePointer(x, y) {
    const data = getGameData();
    if (data.gameOver || splashTimer > 0 || data.loading) return;
    if (differences.length === 0) return;

    const inLeft  = x >= PANE_X_LEFT  && x <= PANE_X_LEFT  + SCENE_W &&
                     y >= PANE_Y      && y <= PANE_Y      + SCENE_H;
    const inRight = x >= PANE_X_RIGHT && x <= PANE_X_RIGHT + SCENE_W &&
                     y >= PANE_Y      && y <= PANE_Y      + SCENE_H;
    if (!inLeft && !inRight) return;

    const sceneX = inLeft ? PANE_X_LEFT : PANE_X_RIGHT;
    const relX = x - sceneX;
    const relY = y - PANE_Y;

    let hitIndex = -1;
    for (let i = 0; i < differences.length; i++) {
      const mod = differences[i];
      if (mod.found) continue;
      const dx = relX - mod.x;
      const dy = relY - mod.y;
      if (dx * dx + dy * dy <= mod.hitR * mod.hitR) {
        hitIndex = i;
        break;
      }
    }

    if (hitIndex >= 0) {
      const mod = differences[hitIndex];
      mod.found = true;
      data.found = differences.filter(d => d.found).length;
      data.score += SCORE_CORRECT;

      foundParticles.push({
        x: sceneX + mod.x,
        y: PANE_Y + mod.y,
        radius: 10,
        life: 1.0,
        maxLife: 1.0,
        alpha: 1,
      });

      AudioManager.playCorrect();

      if (data.found >= data.total) {
        data.gameOver = true;
        data.won = true;
        const bonus = Math.floor(data.timeRemaining * SCORE_BONUS_MULT);
        data.score += bonus;
        AudioManager.playVictory();
        pushScreen('results');
      }
    } else {
      data.timeRemaining -= PENALTY_TIME;
      data.wrongTaps++;
      wrongFlash = 0.3;
      AudioManager.playWrong();

      if (data.timeRemaining <= 0) {
        data.timeRemaining = 0;
        data.gameOver = true;
        data.won = false;
        AudioManager.playGameOver();
        pushScreen('results');
      }
    }

    setGameData(data);
  },

  cleanup() {
    leftImg = null;
    rightImg = null;
    differences = [];
    foundParticles = [];
    wrongFlash = 0;
    loadError = null;
  },
};

// ── Debug hook ──
window.__photoHuntDebug = () => {
  if (!differences.length) return null;
  return differences.map(m => ({
    type: m.type,
    hint: m.hint,
    x: Math.round(m.x + PANE_X_LEFT),
    y: Math.round(m.y + PANE_Y),
    hitR: m.hitR,
    found: m.found,
  }));
};

registerGame(spotTheDifference);
export default spotTheDifference;