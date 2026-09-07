/* ============================================
   Bartop Arcade - Photo Hunt (Spot the Difference)
   ============================================
   Inspired by Megatouch's "Photo Hunt" (called
   "PixMix" on later systems).

   Two different photographs from the same
   category are shown side-by-side. The right
   photo has 5 subtle, photo-realistic
   modifications applied to it. The user must
   tap each difference.

   Differences are natural-looking photo
   effects (NOT overlaid shapes): brightness
   patches, hue shifts, blurred regions, and
   simulated "missing details." No borders,
   no markers — the photo itself changes.
   ============================================ */

import { AudioManager } from '../audio.js';
import { registerGame, getGameData, setGameData, pushScreen, getLevel, incrementLevel, resetLevel } from '../engine.js';
import { PALETTE } from '../engine.js';
import { loadPhotosByCategory, randomCategoryId, clearCache } from '../photo-loader.js';

// ── Layout (logical canvas pixels, 1920x1080 landscape) ──
// Two photos side-by-side. Each photo at 1.51:1 aspect (920×609).
// HUD bar at top (~100px), photo area below.
const DISPLAY_PHOTO_W = 920;       // pane width
const DISPLAY_PHOTO_H = 609;       // pane height (920 / 1.51 ≈ 609)
const PANE_GAP        = 16;        // gap between left and right panes
const TOTAL_PANE_W    = DISPLAY_PHOTO_W * 2 + PANE_GAP;        // 1856
const PANE_X_LEFT     = (1920 - TOTAL_PANE_W) / 2;              // = 32
const PANE_X_RIGHT    = PANE_X_LEFT + DISPLAY_PHOTO_W + PANE_GAP; // = 968
const PANE_Y          = 130;                                    // below HUD bar

// Game-logic aliases (SCENE_W/H = pane size; SCENE_X depends on which pane was tapped).
const SCENE_W = DISPLAY_PHOTO_W;
const SCENE_H = DISPLAY_PHOTO_H;

// Off-screen canvas kept at source resolution for sharp modifications.
const SRC_W = 1360;
const SRC_H = 900;

// ── Difficulty scaling ──
// Level 1 → 1.5× (50% easier), Level 2 → 1.4×, Level 3 → 1.3×, Level 4+ → 1.0×
// "Easier" = bigger patches + stronger modifications + larger hit zones.
function difficultyMultiplier(level) {
  const map = { 1: 1.5, 2: 1.4, 3: 1.3 };
  return map[level] || 1.0;
}

const TOTAL_DIFFERENCES = 5;
const TIME_LIMIT        = 60;
const PENALTY_TIME      = 5;
const SCORE_CORRECT     = 100;
const SCORE_BONUS_MULT  = 2;
const PHOTO_HIT_RADIUS  = 55;    // generous for touch

// ── Modification registry ──
// Each type modifies actual photo pixels in a circular region on
// the right photo. Effects are subtle enough that they look like
// natural differences between two photos, not added shapes.
const MOD_TYPES = [
  { type: 'brighten',   hint: 'Brighter region' },
  { type: 'darken',     hint: 'Darker region' },
  { type: 'saturate',   hint: 'More saturated region' },
  { type: 'desaturate', hint: 'Less saturated region' },
  { type: 'hue_warm',   hint: 'Warmer color region' },
  { type: 'hue_cool',   hint: 'Cooler color region' },
  { type: 'blur_patch', hint: 'Blurred region' },
  { type: 'sharpen',    hint: 'Sharper region' },
];

// ── Per-round state ──
let leftImg         = null;   // Reference photo (untouched)
let rightImg        = null;   // Modified photo (with differences)
let rightCanvas     = null;   // Off-screen canvas with the modified copy
let rightCtx        = null;   // 2D context for rightCanvas
let categoryId      = '';
let differences     = [];     // [{x, y, r, found, hint, type}]
let foundParticles  = [];
let wrongFlash      = 0;
let warningFlash    = 0;
let splashTimer     = 2.0;
let lastTickSecond  = -1;
let loadError       = null;

function rand(min, max) { return min + Math.random() * (max - min); }

// ── Color utilities (RGB <-> HSL) ──
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60)       [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else              [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// ── Photo modification operations ──
// Each takes an ImageData region and modifies pixels.
// All operations use a soft circular mask so the patch
// blends into the surrounding photo (no sharp borders).
function maskFalloff(distance, maxR) {
  // Smooth falloff: 1 at center, 0 at edge
  const t = Math.max(0, Math.min(1, 1 - distance / maxR));
  return t * t * (3 - 2 * t); // smoothstep
}

function applyBrighten(data, cx, cy, radius, strength) {
  for (let py = -radius; py <= radius; py++) {
    for (let px = -radius; px <= radius; px++) {
      const dist = Math.sqrt(px * px + py * py);
      if (dist > radius) continue;
      const x = cx + px, y = cy + py;
      if (x < 0 || x >= data.width || y < 0 || y >= data.height) continue;
      const i = (y * data.width + x) * 4;
      const m = maskFalloff(dist, radius) * strength;
      data.data[i]     = Math.min(255, data.data[i]     + 255 * m);
      data.data[i + 1] = Math.min(255, data.data[i + 1] + 255 * m);
      data.data[i + 2] = Math.min(255, data.data[i + 2] + 255 * m);
    }
  }
}

function applyDarken(data, cx, cy, radius, strength) {
  for (let py = -radius; py <= radius; py++) {
    for (let px = -radius; px <= radius; px++) {
      const dist = Math.sqrt(px * px + py * py);
      if (dist > radius) continue;
      const x = cx + px, y = cy + py;
      if (x < 0 || x >= data.width || y < 0 || y >= data.height) continue;
      const i = (y * data.width + x) * 4;
      const m = maskFalloff(dist, radius) * strength;
      data.data[i]     = Math.max(0, data.data[i]     - 255 * m);
      data.data[i + 1] = Math.max(0, data.data[i + 1] - 255 * m);
      data.data[i + 2] = Math.max(0, data.data[i + 2] - 255 * m);
    }
  }
}

function applySaturation(data, cx, cy, radius, factor) {
  for (let py = -radius; py <= radius; py++) {
    for (let px = -radius; px <= radius; px++) {
      const dist = Math.sqrt(px * px + py * py);
      if (dist > radius) continue;
      const x = cx + px, y = cy + py;
      if (x < 0 || x >= data.width || y < 0 || y >= data.height) continue;
      const i = (y * data.width + x) * 4;
      const m = maskFalloff(dist, radius);
      const r = data.data[i], g = data.data[i + 1], b = data.data[i + 2];
      const [h, s, l] = rgbToHsl(r, g, b);
      const newS = Math.max(0, Math.min(1, s * (1 + (factor - 1) * m)));
      const [nr, ng, nb] = hslToRgb(h, newS, l);
      data.data[i] = nr;
      data.data[i + 1] = ng;
      data.data[i + 2] = nb;
    }
  }
}

function applyHueShift(data, cx, cy, radius, degrees) {
  for (let py = -radius; py <= radius; py++) {
    for (let px = -radius; px <= radius; px++) {
      const dist = Math.sqrt(px * px + py * py);
      if (dist > radius) continue;
      const x = cx + px, y = cy + py;
      if (x < 0 || x >= data.width || y < 0 || y >= data.height) continue;
      const i = (y * data.width + x) * 4;
      const m = maskFalloff(dist, radius);
      const r = data.data[i], g = data.data[i + 1], b = data.data[i + 2];
      const [h, s, l] = rgbToHsl(r, g, b);
      const newH = (h + degrees * m + 360) % 360;
      const [nr, ng, nb] = hslToRgb(newH, s, l);
      data.data[i] = nr;
      data.data[i + 1] = ng;
      data.data[i + 2] = nb;
    }
  }
}

// Box blur with smooth circular mask. Works on a copy to
// avoid feedback loops (read original pixels, write back).
function applyBlur(data, cx, cy, radius, strength) {
  const samples = [];
  for (let py = -radius; py <= radius; py++) {
    for (let px = -radius; px <= radius; px++) {
      const dist = Math.sqrt(px * px + py * py);
      if (dist > radius) continue;
      const x = cx + px, y = cy + py;
      if (x < 0 || x >= data.width || y < 0 || y >= data.height) continue;
      let r = 0, g = 0, b = 0, count = 0;
      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          const sx = x + ox, sy = y + oy;
          if (sx < 0 || sx >= data.width || sy < 0 || sy >= data.height) continue;
          const si = (sy * data.width + sx) * 4;
          r += data.data[si];
          g += data.data[si + 1];
          b += data.data[si + 2];
          count++;
        }
      }
      samples.push({ i: (y * data.width + x) * 4, r: r / count, g: g / count, b: b / count, dist });
    }
  }
  // Write back
  for (const s of samples) {
    const m = maskFalloff(s.dist, radius) * strength;
    data.data[s.i]     = data.data[s.i]     * (1 - m) + s.r * m;
    data.data[s.i + 1] = data.data[s.i + 1] * (1 - m) + s.g * m;
    data.data[s.i + 2] = data.data[s.i + 2] * (1 - m) + s.b * m;
  }
}

// Local contrast boost (lighten highlights, darken shadows)
function applySharpen(data, cx, cy, radius, strength) {
  for (let py = -radius; py <= radius; py++) {
    for (let px = -radius; px <= radius; px++) {
      const dist = Math.sqrt(px * px + py * py);
      if (dist > radius) continue;
      const x = cx + px, y = cy + py;
      if (x < 0 || x >= data.width || y < 0 || y >= data.height) continue;
      const i = (y * data.width + x) * 4;
      const m = maskFalloff(dist, radius) * strength;
      for (let c = 0; c < 3; c++) {
        const v = data.data[i + c];
        // Pull toward 128 (mid gray) by negative amount = push away = sharpen
        data.data[i + c] = v + (v - 128) * m * 0.8;
      }
    }
  }
}

// ── Photo loading + modification ──
// The real Megatouch Photo Hunt model: load ONE photo, draw it identically
// on both sides, then apply 5 very subtle, SMALL pixel-level modifications
// to the right copy. The changes should look like natural photo details
// — one petal slightly different, one small spot of shade, etc.
async function generateRound() {
  categoryId = randomCategoryId();

  // Load ONE photo (used on both sides — they're identical except for mods)
  const imgs = await loadPhotosByCategory(categoryId, 1);
  if (!imgs[0]) {
    loadError = new Error(`Failed to load photo from category: ${categoryId}`);
    return false;
  }

  leftImg = imgs[0];
  rightImg = imgs[0];   // SAME photo — modifications applied via off-screen canvas
  loadError = null;

  // Off-screen canvas at SOURCE resolution (sharp modifications)
  if (!rightCanvas) {
    rightCanvas = document.createElement('canvas');
  }
  rightCanvas.width = SRC_W;
  rightCanvas.height = SRC_H;
  rightCtx = rightCanvas.getContext('2d', { willReadFrequently: true });
  drawPhotoCover(rightCtx, rightImg, 0, 0, SRC_W, SRC_H);

  // Pick 5 unique modification types
  const pool = [...MOD_TYPES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const chosen = pool.slice(0, TOTAL_DIFFERENCES);

  // Place each modification at a SMALL random point on the photo,
  // stored in DISPLAY coords (what the user sees and taps).
  // When we apply it to the source canvas, we scale up by SRC/display ratio.
  // Difficulty scales patch radius + hit zone (lower levels = bigger/easier).
  const diff = difficultyMultiplier(getLevel());
  const margin = 50;
  differences = chosen.map((mod, i) => {
    return {
      key: `${mod.type}-${i}-${Date.now()}`,
      type: mod.type,
      hint: mod.hint,
      // Display coords — used for tap hit-testing
      x: rand(margin, SCENE_W - margin),
      y: rand(margin, SCENE_H - margin),
      // Visual radius scaled to display; will be scaled up for source canvas.
      // Higher difficulty multiplier = bigger patch (easier to see).
      r: rand(10, 22) * diff,
      // Hit zone: generous even at base level, scaled up for early levels.
      hitR: Math.round(PHOTO_HIT_RADIUS * diff),
      // Stashed multiplier for applyModification to scale strength.
      diffMult: diff,
      found: false,
    };
  });

  // Apply each modification to the off-screen canvas
  for (const mod of differences) {
    applyModification(mod);
  }

  return true;
}

// Apply a single modification to the right canvas
// Strengths are deliberately SUBTLE — the differences should look like
// natural photo details (a petal slightly different, one leaf darker)
// not obvious color shifts. Megatouch Photo Hunt's whole challenge is
// that the changes are tiny.
//
// The diff is stored in DISPLAY coords; we scale up to SOURCE coords when
// drawing on the off-screen canvas (which is at source resolution).
function applyModification(mod) {
  const scaleX = SRC_W / SCENE_W;
  const scaleY = SRC_H / SCENE_H;

  const srcX = mod.x * scaleX;
  const srcY = mod.y * scaleY;
  const srcR = mod.r * scaleX;

  const r = Math.ceil(srcR);
  const x0 = Math.max(0, Math.floor(srcX - r));
  const y0 = Math.max(0, Math.floor(srcY - r));
  const w  = Math.min(SRC_W - x0, r * 2);
  const h  = Math.min(SRC_H - y0, r * 2);

  if (w <= 0 || h <= 0) return;

  const imgData = rightCtx.getImageData(x0, y0, w, h);
  const cx = srcX - x0;
  const cy = srcY - y0;

  // Difficulty multiplier scales modification strength (lower level = stronger).
  const diff = mod.diffMult || 1.0;

  switch (mod.type) {
    case 'brighten':
      applyBrighten(imgData, cx, cy, r, 0.15 * diff);
      break;
    case 'darken':
      applyDarken(imgData, cx, cy, r, 0.15 * diff);
      break;
    case 'saturate':
      applySaturation(imgData, cx, cy, r, 1 + (1.25 - 1) * diff);
      break;
    case 'desaturate':
      applySaturation(imgData, cx, cy, r, 1 - (1 - 0.6) * diff);
      break;
    case 'hue_warm':
      applyHueShift(imgData, cx, cy, r, -8 * diff);
      break;
    case 'hue_cool':
      applyHueShift(imgData, cx, cy, r, 8 * diff);
      break;
    case 'blur_patch':
      applyBlur(imgData, cx, cy, r, 0.4 * diff);
      break;
    case 'sharpen':
      applySharpen(imgData, cx, cy, r, 0.25 * diff);
      break;
  }

  rightCtx.putImageData(imgData, x0, y0);
}

// ── Photo drawing (object-fit: cover — crop to fill, no stretch) ──
// Draws to (dstX, dstY) so the photo aligns with its clip-path pane.
// The off-screen right canvas uses (0, 0); the left pane uses (40, 160).
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

    // Kick off async round generation (doesn't block splash)
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

    // Dark background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, 1920, 1080);

    if (splashTimer > 0) { drawSplash(ctx); return; }
    if (data.loading || !leftImg || !rightImg) { drawLoading(ctx, data); return; }

    // Photo borders (left=reference, right=modified)
    drawPhotoFrame(ctx, PANE_X_LEFT, PANE_Y, SCENE_W, SCENE_H);
    drawPhotoFrame(ctx, PANE_X_RIGHT, PANE_Y, SCENE_W, SCENE_H);

    // LEFT photo — clean reference
    ctx.save();
    roundRectPath(ctx, PANE_X_LEFT, PANE_Y, SCENE_W, SCENE_H, 12);
    ctx.clip();
    drawPhotoCover(ctx, leftImg, PANE_X_LEFT, PANE_Y, SCENE_W, SCENE_H);
    ctx.restore();

    // RIGHT photo — modified copy from off-screen canvas (drawn into the pane clip)
    ctx.save();
    roundRectPath(ctx, PANE_X_RIGHT, PANE_Y, SCENE_W, SCENE_H, 12);
    ctx.clip();
    if (rightCanvas) {
      ctx.drawImage(rightCanvas, PANE_X_RIGHT, PANE_Y, SCENE_W, SCENE_H);
    } else {
      drawPhotoCover(ctx, rightImg, PANE_X_RIGHT, PANE_Y, SCENE_W, SCENE_H);
    }
    ctx.restore();

    // Labels above each pane
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px "Courier New", monospace';
    ctx.fillStyle = PALETTE.dim;
    ctx.fillText('REFERENCE', PANE_X_LEFT + SCENE_W / 2, PANE_Y - 12);
    ctx.fillText('FIND CHANGES', PANE_X_RIGHT + SCENE_W / 2, PANE_Y - 12);

    // Found-difference highlights (green circle + check on both panes)
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

    // Wrong-tap red flash
    if (wrongFlash > 0) {
      ctx.fillStyle = `rgba(255, 51, 85, ${wrongFlash * 0.5})`;
      ctx.fillRect(0, 0, 1920, 1080);
    }

    // Low-time warning
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

    // Tap must be inside one of the photo panes (left or right)
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
    rightCanvas = null;
    rightCtx = null;
    differences = [];
    foundParticles = [];
    wrongFlash = 0;
    loadError = null;
  },
};

// ── Drawing helpers ──
function drawSplash(ctx) {
  ctx.fillStyle = 'rgba(10,10,15,0.92)';
  ctx.fillRect(0, 0, 1920, 1080);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Level badge in upper-left corner
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

  // Difficulty hint for early levels (level 1 = 50% easier, etc.)
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

function drawFoundHighlight(ctx, mod, ox, oy) {
  const cx = ox + mod.x;
  const cy = oy + mod.y;
  ctx.strokeStyle = PALETTE.neonGreen;
  ctx.lineWidth = 4;
  ctx.shadowColor = PALETTE.neonGreen;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 14, cy);
  ctx.lineTo(cx - 4, cy + 10);
  ctx.lineTo(cx + 16, cy - 12);
  ctx.stroke();
}

// Register with engine
registerGame(spotTheDifference);

// ── Debug hook for testing ──
// Exposes the current round's difference positions so CDP tests can
// tap them deterministically. Harmless in production (read-only).
window.__photoHuntDebug = () => {
  if (!differences.length) return null;
  // Positions are returned in canvas coords (relative to the right pane).
  // Caller can also derive left-pane coords by swapping sceneX if needed.
  return differences.map(m => ({
    type: m.type,
    hint: m.hint,
    x: Math.round(m.x + PANE_X_LEFT),
    y: Math.round(m.y + PANE_Y),
    hitR: m.hitR,
    found: m.found,
    diffMult: m.diffMult,
  }));
};

export default spotTheDifference;
