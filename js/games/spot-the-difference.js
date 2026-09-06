/* ============================================
   Bartop Arcade - Spot the Difference
   ============================================
   Inspired by Megatouch's "Photo Hunt".
   Uses real stock photos from Picsum (free
   for commercial use, served from Unsplash).
   One photo on each side; 5 visible
   modifications on the right.
   ============================================ */

import { AudioManager } from '../audio.js';
import { registerGame, getGameData, setGameData, pushScreen } from '../engine.js';
import { PALETTE } from '../engine.js';
import { loadPhotosByCategory, randomCategoryId } from '../photo-loader.js';

// ── Layout constants ──
const SCENE_X_LEFT  = 30;
const SCENE_X_RIGHT = 540;
const SCENE_Y       = 160;
const SCENE_W       = 510;
const SCENE_H       = 900;

const TOTAL_DIFFERENCES = 5;
const TIME_LIMIT        = 60;
const PENALTY_TIME      = 5;
const SCORE_CORRECT     = 100;
const SCORE_BONUS_MULT  = 2;
const PHOTO_HIT_RADIUS  = 50;   // logical pixels — generous for touch

// ── Per-round state ──
let photoImg        = null;     // HTMLImageElement (shared left/right)
let photoUrl        = '';       // for credits
let categoryId      = '';
let differences     = [];       // [{type, x, y, hitW, hitH, hitR, found, apply, hint}]
let foundParticles  = [];
let wrongFlash      = 0;
let warningFlash    = 0;
let splashTimer     = 2.0;
let lastTickSecond  = -1;
let loadError       = null;

// ── Modification registry ──
// Each mod draws an overlay on the right photo AND contributes a hit zone.
// `apply(ctx, ox, oy)` runs once during draw to render the overlay.
// `hitPoint` is the logical point (relative to photo) the user must tap.
// `hitRadius` is the touch hit zone radius.
const MOD_TYPES = [
  // Bright, easy-to-spot additions
  { type: 'red_dot',       color: '#ff2244',  shape: 'circle',   size: 30, hint: 'Red dot' },
  { type: 'yellow_square', color: '#ffdd00',  shape: 'square',   size: 50, hint: 'Yellow square' },
  { type: 'blue_x',        color: '#2266ff',  shape: 'x',        size: 44, hint: 'Blue X' },
  { type: 'green_tri',     color: '#33ee66',  shape: 'triangle', size: 50, hint: 'Green triangle' },
  { type: 'cyan_circle',   color: '#00ddff',  shape: 'circle',   size: 28, hint: 'Cyan circle' },
  { type: 'pink_star',     color: '#ff66cc',  shape: 'star',     size: 46, hint: 'Pink star' },
  // Subtle photo modifications
  { type: 'invert',        hint: 'Inverted patch' },
  { type: 'darken',        hint: 'Darkened patch' },
  { type: 'brighten',      hint: 'Brightened patch' },
  { type: 'hue_shift',     hint: 'Color-shifted patch' },
];

function rand(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

// ── Round generation ──
async function generateRound() {
  // Pick a category, load one photo
  categoryId = randomCategoryId();
  const imgs = await loadPhotosByCategory(categoryId, 1);
  photoImg = imgs[0];

  if (!photoImg) {
    loadError = new Error(`Failed to load photo from category: ${categoryId}`);
    return false;
  }

  loadError = null;
  photoUrl = `${categoryId} photo (Picsum/Unsplash)`;

  // Pick 5 unique modification types from the registry
  const pool = [...MOD_TYPES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const chosen = pool.slice(0, TOTAL_DIFFERENCES);

  // Place each modification at a random point on the photo
  differences = chosen.map((mod, i) => {
    const margin = 60;
    const x = rand(margin, SCENE_W - margin);
    const y = rand(margin, SCENE_H - margin);
    return {
      key: `${mod.type}-${i}-${Date.now()}`,
      type: mod.type,
      color: mod.color,
      shape: mod.shape,
      size: mod.size,
      hint: mod.hint,
      x, y,
      hitR: PHOTO_HIT_RADIUS,
      found: false,
    };
  });

  return true;
}

// ── Modification overlay drawing ──
function drawMod(ctx, mod, ox, oy) {
  const cx = ox + mod.x;
  const cy = oy + mod.y;

  ctx.save();

  switch (mod.type) {
    case 'red_dot':
    case 'cyan_circle': {
      // Filled circle with subtle glow
      ctx.shadowColor = mod.color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = mod.color;
      ctx.beginPath();
      ctx.arc(cx, cy, mod.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // Inner highlight
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(cx - mod.size * 0.3, cy - mod.size * 0.3, mod.size * 0.25, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'yellow_square': {
      ctx.shadowColor = mod.color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = mod.color;
      ctx.fillRect(cx - mod.size / 2, cy - mod.size / 2, mod.size, mod.size);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - mod.size / 2, cy - mod.size / 2, mod.size, mod.size);
      break;
    }

    case 'blue_x': {
      ctx.shadowColor = mod.color;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = mod.color;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - mod.size / 2, cy - mod.size / 2);
      ctx.lineTo(cx + mod.size / 2, cy + mod.size / 2);
      ctx.moveTo(cx + mod.size / 2, cy - mod.size / 2);
      ctx.lineTo(cx - mod.size / 2, cy + mod.size / 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      break;
    }

    case 'green_tri': {
      ctx.shadowColor = mod.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = mod.color;
      ctx.beginPath();
      ctx.moveTo(cx, cy - mod.size / 2);
      ctx.lineTo(cx + mod.size / 2, cy + mod.size / 2);
      ctx.lineTo(cx - mod.size / 2, cy + mod.size / 2);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#003300';
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    }

    case 'pink_star': {
      ctx.shadowColor = mod.color;
      ctx.shadowBlur = 16;
      ctx.fillStyle = mod.color;
      ctx.strokeStyle = '#660044';
      ctx.lineWidth = 2;
      const spikes = 5, outerR = mod.size / 2, innerR = mod.size / 4;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (Math.PI / spikes) * i - Math.PI / 2;
        const px = cx + Math.cos(angle) * r;
        const py = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      break;
    }

    case 'invert': {
      // Get pixels, invert them, put them back
      const w = 80, h = 80;
      const sx = cx - w / 2, sy = cy - h / 2;
      try {
        const imgData = ctx.getImageData(sx, sy, w, h);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          d[i]     = 255 - d[i];
          d[i + 1] = 255 - d[i + 1];
          d[i + 2] = 255 - d[i + 2];
        }
        ctx.putImageData(imgData, sx, sy);
        // Border so it's findable
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(sx, sy, w, h);
        ctx.setLineDash([]);
      } catch (e) {
        // getImageData can throw if region is invalid (cross-origin etc.)
        drawFallbackTint(ctx, cx, cy, 80, '#ff00ff');
      }
      break;
    }

    case 'darken': {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(cx - 50, cy - 50, 100, 100);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(cx - 50, cy - 50, 100, 100);
      ctx.setLineDash([]);
      break;
    }

    case 'brighten': {
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillRect(cx - 50, cy - 50, 100, 100);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(cx - 50, cy - 50, 100, 100);
      ctx.setLineDash([]);
      break;
    }

    case 'hue_shift': {
      ctx.fillStyle = 'rgba(255,0,128,0.55)';
      ctx.fillRect(cx - 50, cy - 50, 100, 100);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(cx - 50, cy - 50, 100, 100);
      ctx.setLineDash([]);
      break;
    }
  }

  ctx.restore();
}

function drawFallbackTint(ctx, cx, cy, size, color) {
  // Used when getImageData fails (CORS): draw a visible tinted box
  ctx.fillStyle = color;
  ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
}

// ── Photo rendering with safe fallback ──
function drawPhoto(ctx, img, ox, oy) {
  if (img && img.complete && img.naturalWidth > 0) {
    // object-fit: cover behavior — crop to fill, no stretch
    const srcAspect = img.naturalWidth / img.naturalHeight;
    const dstAspect = SCENE_W / SCENE_H;
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (srcAspect > dstAspect) {
      // Source is wider — crop horizontally
      sw = img.naturalHeight * dstAspect;
      sx = (img.naturalWidth - sw) / 2;
    } else {
      // Source is taller — crop vertically
      sh = img.naturalWidth / dstAspect;
      sy = (img.naturalHeight - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, ox, oy, SCENE_W, SCENE_H);
  } else {
    // Fallback: gradient placeholder
    const grad = ctx.createLinearGradient(ox, oy, ox, oy + SCENE_H);
    grad.addColorStop(0, '#1a1a3a');
    grad.addColorStop(1, '#2a2a50');
    ctx.fillStyle = grad;
    ctx.fillRect(ox, oy, SCENE_W, SCENE_H);
    ctx.fillStyle = '#555577';
    ctx.font = '24px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Loading…', ox + SCENE_W / 2, oy + SCENE_H / 2);
  }
}

// ── Game module ──

const spotTheDifference = {
  name: 'Spot the Difference',
  description: 'Find 5 changes between two real photos. 60 seconds. Go!',

  async init() {
    photoImg        = null;
    photoUrl        = '';
    differences     = [];
    foundParticles  = [];
    wrongFlash      = 0;
    warningFlash    = 0;
    splashTimer     = 2.0;
    lastTickSecond  = -1;
    loadError       = null;

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

    // Kick off photo load (does not block splash)
    generateRound().then(ok => {
      const data = getGameData();
      data.loading = false;
      if (ok) {
        data.total = differences.length;
      } else {
        data.total = 0;
      }
      setGameData(data);
    });
  },

  update(dt) {
    const data = getGameData();
    if (data.gameOver) return;

    // Splash countdown
    if (splashTimer > 0) {
      splashTimer -= dt;
      return;
    }

    // Wait for photo to load — timer paused
    if (data.loading) return;

    // No diffs loaded (load failure) — bail to results
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

    // Particle lifecycle
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

    // Background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, 1080, 1920);

    // Splash screen
    if (splashTimer > 0) {
      drawSplash(ctx);
      return;
    }

    // Loading photo (after splash, before photo ready)
    if (data.loading || !photoImg) {
      drawLoading(ctx, data);
      return;
    }

    // ── Draw both sides ──
    // Left: clean photo
    drawPhoto(ctx, photoImg, SCENE_X_LEFT, SCENE_Y);
    // Right: photo + modifications
    drawPhoto(ctx, photoImg, SCENE_X_RIGHT, SCENE_Y);
    for (const mod of differences) {
      drawMod(ctx, mod, SCENE_X_RIGHT, SCENE_Y);
    }

    // Divider
    ctx.strokeStyle = PALETTE.dim;
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(540, SCENE_Y - 10);
    ctx.lineTo(540, SCENE_Y + SCENE_H + 10);
    ctx.stroke();
    ctx.setLineDash([]);

    // Side labels
    ctx.fillStyle = PALETTE.dim;
    ctx.textAlign = 'center';
    ctx.font = '22px "Courier New", monospace';
    ctx.fillText('REFERENCE', SCENE_X_LEFT + SCENE_W / 2, SCENE_Y - 14);
    ctx.fillText('FIND CHANGES', SCENE_X_RIGHT + SCENE_W / 2, SCENE_Y - 14);

    // Photo credits (required by Picsum terms)
    ctx.fillStyle = '#444466';
    ctx.font = '14px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Photos: Picsum / Unsplash (CC0)', 540, SCENE_Y + SCENE_H + 26);
    ctx.fillText(`Category: ${categoryId}`, 540, SCENE_Y + SCENE_H + 46);

    // Found-difference highlights (green circle + checkmark on both sides)
    for (const mod of differences) {
      if (!mod.found) continue;
      drawFoundHighlight(ctx, mod, SCENE_X_LEFT, SCENE_Y);
      drawFoundHighlight(ctx, mod, SCENE_X_RIGHT, SCENE_Y);
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
      ctx.fillRect(0, 0, 1080, 1920);
    }

    // Low-time border warning
    if (data.timeRemaining <= 10 && warningFlash > 0) {
      const a = Math.sin(Date.now() / 150) * 0.12 + 0.12;
      ctx.fillStyle = `rgba(255, 51, 85, ${a})`;
      ctx.fillRect(0, 0, 1080, SCENE_Y);
    }
  },

  handlePointer(x, y) {
    const data = getGameData();
    if (data.gameOver || splashTimer > 0 || data.loading) return;
    if (!photoImg || differences.length === 0) return;

    // Tap must be inside one of the photo areas
    const inLeft  = x >= SCENE_X_LEFT  && x <= SCENE_X_LEFT  + SCENE_W &&
                    y >= SCENE_Y       && y <= SCENE_Y       + SCENE_H;
    const inRight = x >= SCENE_X_RIGHT && x <= SCENE_X_RIGHT + SCENE_W &&
                    y >= SCENE_Y       && y <= SCENE_Y       + SCENE_H;
    if (!inLeft && !inRight) return;

    const sceneX = inLeft ? SCENE_X_LEFT : SCENE_X_RIGHT;
    const relX = x - sceneX;
    const relY = y - SCENE_Y;

    // Check hits
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
        y: SCENE_Y + mod.y,
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
    photoImg = null;
    photoUrl = '';
    differences = [];
    foundParticles = [];
    wrongFlash = 0;
    loadError = null;
  },
};

// ── Drawing helpers ──
function drawSplash(ctx) {
  ctx.fillStyle = 'rgba(10,10,15,0.92)';
  ctx.fillRect(0, 0, 1080, 1920);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.shadowColor = PALETTE.neonCyan;
  ctx.shadowBlur = 60;
  ctx.fillStyle = PALETTE.neonCyan;
  ctx.font = 'bold 72px "Courier New", monospace';
  ctx.fillText('PHOTO', 540, 600);
  ctx.shadowColor = PALETTE.neonPink;
  ctx.shadowBlur = 60;
  ctx.fillStyle = PALETTE.neonPink;
  ctx.fillText('HUNT', 540, 720);
  ctx.shadowBlur = 0;

  ctx.fillStyle = PALETTE.white;
  ctx.font = '36px "Courier New", monospace';
  ctx.fillText(`Find ${TOTAL_DIFFERENCES} changes in ${TIME_LIMIT} seconds`, 540, 870);

  ctx.fillStyle = PALETTE.dim;
  ctx.font = '28px "Courier New", monospace';
  ctx.fillText('Wrong taps cost 5 seconds!', 540, 940);

  const count = Math.ceil(splashTimer);
  ctx.fillStyle = PALETTE.neonAmber;
  ctx.font = 'bold 200px "Courier New", monospace';
  ctx.fillText(count, 540, 1280);

  ctx.fillStyle = PALETTE.dim;
  ctx.font = '22px "Courier New", monospace';
  ctx.fillText('Loading photo…', 540, 1500);
}

function drawLoading(ctx, data) {
  // Semi-transparent dark overlay so user sees what's behind
  ctx.fillStyle = 'rgba(10,10,15,0.85)';
  ctx.fillRect(0, 0, 1080, 1920);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.white;
  ctx.font = 'bold 48px "Courier New", monospace';
  ctx.fillText('LOADING PHOTO…', 540, 900);

  if (loadError) {
    ctx.fillStyle = PALETTE.red;
    ctx.font = '24px "Courier New", monospace';
    ctx.fillText('Photo failed to load — ending round', 540, 980);
  } else {
    // Spinner
    const t = Date.now() / 200;
    ctx.strokeStyle = PALETTE.neonCyan;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(540, 1100, 60, t, t + Math.PI * 1.4);
    ctx.stroke();
  }
}

function drawFoundHighlight(ctx, mod, ox, oy) {
  const cx = ox + mod.x;
  const cy = oy + mod.y;
  ctx.strokeStyle = PALETTE.neonGreen;
  ctx.lineWidth = 4;
  ctx.shadowColor = PALETTE.neonGreen;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(cx, cy, 28, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Checkmark
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy);
  ctx.lineTo(cx - 3, cy + 9);
  ctx.lineTo(cx + 14, cy - 10);
  ctx.stroke();
}

// Register with engine
registerGame(spotTheDifference);

export default spotTheDifference;
