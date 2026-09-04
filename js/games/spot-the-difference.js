/* ============================================
   Bartop Arcade - Spot the Difference
   ============================================
   Procedurally generated scenes with subtle
   visual differences. Find them before time
   runs out!
   ============================================ */

import { AudioManager } from '../audio.js';
import { registerGame, getGameData, setGameData, pushScreen } from '../engine.js';
import { PALETTE } from '../engine.js';

// ── Constants ──
const TOTAL_DIFFERENCES = 5;
const TIME_LIMIT = 60;
const PENALTY_TIME = 5;    // Seconds lost on wrong tap
const SCORE_CORRECT = 100;
const SCORE_BONUS_MULT = 2; // Multiplier for remaining time

// ── Scene dimensions ──
const SCENE_X = 30;
const SCENE_W = 510;
const SCENE_GAP = 0;
const SCENE2_X = 540;
const SCENE_H = 900;
const SCENE_TOP = 140;

// ── State ──
let leftScene = null;
let rightScene = null;
let differences = [];
let foundIndices = [];
let foundParticles = [];   // Visual feedback
let wrongFlash = 0;        // Wrong tap feedback timer
let warningFlash = 0;       // Timer warning pulse
let splashTimer = 0;        // Start splash delay
let lastTickSecond = -1;    // For metronome tick

// ── Scene Generators ──
const sceneGenerators = [
  generateCityScene,
  generateUnderwaterScene,
  generateSpaceScene,
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

// ── Colour palettes per theme ──
const CITY_COLORS = {
  sky:       ['#0f0f2a', '#1a1a40'],
  building:  ['#1a1a3a', '#222244', '#2a2a50'],
  windowOn:  ['#ffdd44', '#ffaa00', '#ff8822', '#33ddff', '#66ff88'],
  windowOff: ['#111122', '#181830'],
  cloud:     ['#334466', '#445577'],
  moon:      '#99aacc',
  star:      '#ffffff',
};

const WATER_COLORS = {
  bg:        ['#0a1a2a', '#0d2137', '#0f2844'],
  fish:      ['#ff6644', '#ffaa33', '#44ddff', '#ff4488', '#66ff66'],
  seaweed:   ['#22aa44', '#33cc55', '#44ee66'],
  bubble:    ['#88ccff', '#aaddff'],
  rock:      ['#334455', '#445566'],
  sand:      '#1a2a33',
};

const SPACE_COLORS = {
  bg:        '#050510',
  star:      '#ffffff',
  planet1:   ['#ff6644', '#cc5533', '#aa4422'],
  planet2:   ['#44aaff', '#3388dd', '#2277cc'],
  planet3:   ['#ffcc44', '#eebb33', '#ddaa22'],
  rocket:    '#eeeeee',
  alien:     '#66ff66',
  nebula:    ['#442266', '#553377', '#664488'],
};

// ── Scene Types ──

class CityScene {
  constructor() {
    this.buildings = [];
    this.clouds = [];
    this.stars = [];
    this.moonY = rand(100, 400);
    this.moonX = rand(100, 400);
    this.moonPhase = rand(2, 6);
    this.groundY = randInt(720, 780);
    this.differences = [];

    // Generate buildings
    let bx = 0;
    while (bx < SCENE_W + 50) {
      const bw = randInt(30, 80);
      const bh = randInt(120, 400);
      const by = this.groundY - bh;
      const windows = [];
      const cols = Math.floor(bw / 18);
      const rows = Math.floor(bh / 22);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          windows.push({
            x: bx + 10 + c * 18 + rand(0, 4),
            y: by + 20 + r * 22 + rand(0, 4),
            on: Math.random() > 0.3,
            color: pickRandom(CITY_COLORS.windowOn),
          });
        }
      }
      this.buildings.push({ x: bx, y: by, w: bw, h: bh, windows, color: pickRandom(CITY_COLORS.building) });
      bx += bw + rand(2, 8);
    }

    // Clouds
    for (let i = 0; i < 4; i++) {
      this.clouds.push({ x: rand(0, SCENE_W), y: rand(30, 200), w: rand(80, 160), h: rand(20, 35) });
    }

    // Stars
    for (let i = 0; i < 30; i++) {
      this.stars.push({ x: rand(0, SCENE_W), y: rand(0, 400), size: rand(1, 2.5) });
    }
  }

  draw(ctx, ox, oy) {
    const x = ox, y = oy;

    // Sky gradient
    const grad = ctx.createLinearGradient(x, y, x, y + SCENE_H);
    grad.addColorStop(0, '#0a0a20');
    grad.addColorStop(0.5, '#1a1a3a');
    grad.addColorStop(1, '#2a2a4a');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, SCENE_W, SCENE_H);

    // Stars
    ctx.fillStyle = '#ffffff';
    for (const s of this.stars) {
      ctx.globalAlpha = rand(0.3, 1);
      ctx.beginPath();
      ctx.arc(x + s.x, y + s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Moon
    ctx.fillStyle = '#99aacc';
    ctx.shadowColor = '#99aacc';
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.arc(x + this.moonX, y + this.moonY, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Clouds
    for (const c of this.clouds) {
      ctx.fillStyle = '#334466';
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.ellipse(x + c.x, y + c.y, c.w / 2, c.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + c.x - c.w * 0.25, y + c.y + 5, c.w * 0.3, c.h * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + c.x + c.w * 0.25, y + c.y + 5, c.w * 0.3, c.h * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Buildings
    for (const b of this.buildings) {
      ctx.fillStyle = b.color;
      ctx.fillRect(x + b.x, y + b.y, b.w, b.h);

      // Building outline
      ctx.strokeStyle = 'rgba(100,100,180,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + b.x, y + b.y, b.w, b.h);

      // Windows
      for (const w of b.windows) {
        ctx.fillStyle = w.on ? w.color : '#111122';
        ctx.fillRect(x + w.x, y + w.y, 10, 12);
      }
    }

    // Ground
    ctx.fillStyle = '#1a1a30';
    ctx.fillRect(x, y + this.groundY, SCENE_W, SCENE_H - this.groundY);

    // Ground line
    ctx.strokeStyle = '#2a2a44';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + this.groundY + 2);
    ctx.lineTo(x + SCENE_W, y + this.groundY + 2);
    ctx.stroke();
  }

  /** Mutate to produce a difference and return the difference descriptor */
  mutateDifference(existingDiffs) {
    const candidates = [];

    // 1. Toggle a window on/off
    for (const b of this.buildings) {
      for (let wi = 0; wi < b.windows.length; wi++) {
        const w = b.windows[wi];
        // Generate a unique key for this window
        const key = `window-${b.x}-${w.x}-${w.y}`;
        if (!existingDiffs.some(d => d.key === key)) {
          candidates.push({
            key,
            x: SCENE_W / 2 + this.buildings.indexOf(b) * 5, // approximate center
            y: w.y,
            hitX: () => w.x,
            hitY: () => w.y,
            hitW: 14,
            hitH: 16,
            apply: () => { w.on = !w.on; },
            hint: 'Window toggled',
          });
        }
      }
    }

    // 2. Move a cloud
    for (let ci = 0; ci < this.clouds.length; ci++) {
      const c = this.clouds[ci];
      const key = `cloud-${ci}`;
      if (!existingDiffs.some(d => d.key === key)) {
        const dx = rand(20, 60) * (Math.random() > 0.5 ? 1 : -1);
        candidates.push({
          key,
          x: c.x,
          y: c.y,
          hitX: () => c.x,
          hitY: () => c.y,
          hitW: c.w,
          hitH: c.h,
          apply: () => { c.x += dx; },
          hint: 'Cloud moved',
        });
      }
    }

    // 3. Change a star's size
    for (let si = 0; si < this.stars.length; si++) {
      const s = this.stars[si];
      const key = `star-${si}`;
      if (!existingDiffs.some(d => d.key === key)) {
        candidates.push({
          key,
          x: s.x,
          y: s.y,
          hitX: () => s.x,
          hitY: () => s.y,
          hitW: 10,
          hitH: 10,
          apply: () => { s.size = s.size > 2 ? 0.5 : 3; },
          hint: 'Star changed',
        });
      }
    }

    if (candidates.length === 0) return null;
    return pickRandom(candidates);
  }
}

class UnderwaterScene {
  constructor() {
    this.fishes = [];
    this.bubbles = [];
    this.seaweeds = [];
    this.rocks = [];
    this.sandY = randInt(780, 830);
    this.differences = [];

    // Fishes
    for (let i = 0; i < 7; i++) {
      this.fishes.push({
        x: rand(30, SCENE_W - 30),
        y: rand(50, this.sandY - 50),
        size: randInt(15, 30),
        color: pickRandom(WATER_COLORS.fish),
        dir: Math.random() > 0.5 ? 1 : -1,
        speed: rand(10, 30),
      });
    }

    // Bubbles
    for (let i = 0; i < 12; i++) {
      this.bubbles.push({
        x: rand(20, SCENE_W - 20),
        y: rand(20, this.sandY - 20),
        r: rand(3, 10),
        alpha: rand(0.2, 0.6),
      });
    }

    // Seaweed
    for (let i = 0; i < 5; i++) {
      const sx = rand(20, SCENE_W - 20);
      const sh = randInt(80, 200);
      this.seaweeds.push({
        x: sx,
        y: this.sandY - sh,
        h: sh,
        segments: 5,
        color: pickRandom(WATER_COLORS.seaweed),
        sway: rand(0, Math.PI * 2),
      });
    }

    // Rocks
    for (let i = 0; i < 4; i++) {
      this.rocks.push({
        x: rand(10, SCENE_W - 40),
        y: this.sandY - randInt(10, 30),
        w: randInt(30, 70),
        h: randInt(15, 30),
        color: pickRandom(WATER_COLORS.rock),
      });
    }
  }

  draw(ctx, ox, oy) {
    const x = ox, y = oy;

    // Water gradient
    const grad = ctx.createLinearGradient(x, y, x, y + SCENE_H);
    grad.addColorStop(0, '#0a1a2a');
    grad.addColorStop(0.3, '#0d2137');
    grad.addColorStop(0.6, '#0f2844');
    grad.addColorStop(1, '#152a40');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, SCENE_W, SCENE_H);

    // Light rays
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = '#88ccff';
      const rx = rand(50, SCENE_W - 50);
      ctx.beginPath();
      ctx.moveTo(x + rx, y);
      ctx.lineTo(x + rx - 30, y + SCENE_H);
      ctx.lineTo(x + rx + 30, y + SCENE_H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Seaweed (back layer)
    for (const sw of this.seaweeds) {
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const sway = Math.sin(sw.sway) * 15;
      ctx.moveTo(x + sw.x, y + sw.y + sw.h);
      for (let s = 0; s <= sw.segments; s++) {
        const sy = y + sw.y + sw.h - (sw.h / sw.segments) * s;
        const sx = x + sw.x + Math.sin(sway * s / sw.segments + sw.sway) * 10;
        ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // Bubbles
    for (const b of this.bubbles) {
      ctx.strokeStyle = WATER_COLORS.bubble[0];
      ctx.fillStyle = 'rgba(136,204,255,0.15)';
      ctx.globalAlpha = b.alpha;
      ctx.beginPath();
      ctx.arc(x + b.x, y + b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Rocks
    for (const r of this.rocks) {
      ctx.fillStyle = r.color;
      ctx.beginPath();
      ctx.ellipse(x + r.x, y + r.y, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Fishes
    for (const f of this.fishes) {
      ctx.fillStyle = f.color;
      const fx = x + f.x;
      const fy = y + f.y;
      // Body
      ctx.beginPath();
      ctx.ellipse(fx, fy, f.size, f.size * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Tail
      ctx.beginPath();
      ctx.moveTo(fx - f.size * f.dir, fy);
      ctx.lineTo(fx - f.size * 1.5 * f.dir, fy - f.size * 0.5);
      ctx.lineTo(fx - f.size * 1.5 * f.dir, fy + f.size * 0.5);
      ctx.closePath();
      ctx.fill();
      // Eye
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(fx + f.dir * f.size * 0.3, fy - f.size * 0.1, f.size * 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(fx + f.dir * f.size * 0.3, fy - f.size * 0.1, f.size * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sand
    ctx.fillStyle = WATER_COLORS.sand;
    ctx.fillRect(x, y + this.sandY, SCENE_W, SCENE_H - this.sandY);
  }

  mutateDifference(existingDiffs) {
    const candidates = [];

    // 1. Change fish color
    for (let fi = 0; fi < this.fishes.length; fi++) {
      const f = this.fishes[fi];
      const key = `fish-color-${fi}`;
      if (!existingDiffs.some(d => d.key === key)) {
        const newColor = pickRandom(WATER_COLORS.fish.filter(c => c !== f.color));
        candidates.push({
          key,
          x: f.x,
          y: f.y,
          hitX: () => f.x,
          hitY: () => f.y,
          hitW: f.size * 2,
          hitH: f.size,
          apply: () => { f.color = newColor; },
          hint: 'Fish color changed',
        });
      }
    }

    // 2. Add/remove a bubble
    for (let bi = 0; bi < this.bubbles.length; bi++) {
      const b = this.bubbles[bi];
      const key = `bubble-${bi}`;
      if (!existingDiffs.some(d => d.key === key)) {
        candidates.push({
          key,
          x: b.x,
          y: b.y,
          hitX: () => b.x,
          hitY: () => b.y,
          hitW: b.r * 2 + 4,
          hitH: b.r * 2 + 4,
          apply: () => { b.alpha = b.alpha > 0 ? 0 : rand(0.3, 0.7); },
          hint: 'Bubble hidden/shown',
        });
      }
    }

    // 3. Move a fish
    for (let fi = 0; fi < this.fishes.length; fi++) {
      const f = this.fishes[fi];
      const key = `fish-move-${fi}`;
      if (!existingDiffs.some(d => d.key === key)) {
        candidates.push({
          key,
          x: f.x,
          y: f.y,
          hitX: () => f.x,
          hitY: () => f.y,
          hitW: f.size * 2,
          hitH: f.size,
          apply: () => { f.x = Math.max(30, Math.min(SCENE_W - 30, f.x + rand(-40, 40))); },
          hint: 'Fish moved',
        });
      }
    }

    if (candidates.length === 0) return null;
    return pickRandom(candidates);
  }
}

class SpaceScene {
  constructor() {
    this.stars = [];
    this.planets = [];
    this.nebulae = [];
    this.rocketY = 0;
    this.aliens = [];
    this.differences = [];

    // Stars (many)
    for (let i = 0; i < 60; i++) {
      this.stars.push({
        x: rand(0, SCENE_W),
        y: rand(0, SCENE_H),
        size: rand(0.5, 2),
        twinkle: rand(0, Math.PI * 2),
      });
    }

    // Planets
    for (let i = 0; i < 3; i++) {
      this.planets.push({
        x: rand(50, SCENE_W - 50),
        y: rand(100, SCENE_H - 100),
        r: randInt(15, 45),
        color: pickRandom(i === 0 ? SPACE_COLORS.planet1 : i === 1 ? SPACE_COLORS.planet2 : SPACE_COLORS.planet3),
        hasRing: i === 1 && Math.random() > 0.4,
        craters: i === 0 ? randInt(2, 5) : 0,
      });
    }

    // Nebulae
    for (let i = 0; i < 3; i++) {
      this.nebulae.push({
        x: rand(0, SCENE_W),
        y: rand(0, SCENE_H),
        r: rand(40, 100),
        color: pickRandom(SPACE_COLORS.nebula),
        alpha: rand(0.05, 0.12),
      });
    }

    // Aliens
    for (let i = 0; i < 2; i++) {
      this.aliens.push({
        x: rand(50, SCENE_W - 50),
        y: rand(50, SCENE_H - 200),
        size: randInt(12, 20),
      });
    }
  }

  draw(ctx, ox, oy) {
    const x = ox, y = oy;

    // Deep space background
    ctx.fillStyle = '#050510';
    ctx.fillRect(x, y, SCENE_W, SCENE_H);

    // Nebulae
    for (const n of this.nebulae) {
      const grad = ctx.createRadialGradient(x + n.x, y + n.y, 0, x + n.x, y + n.y, n.r);
      grad.addColorStop(0, n.color.replace(')', `, ${n.alpha})`).replace('rgb', 'rgba'));
      grad.addColorStop(1, 'rgba(5,5,16,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x + n.x, y + n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Stars
    for (const s of this.stars) {
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.5 + Math.sin(s.twinkle) * 0.4;
      ctx.beginPath();
      ctx.arc(x + s.x, y + s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Planets
    for (const p of this.planets) {
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 25;
      ctx.beginPath();
      ctx.arc(x + p.x, y + p.y, p.r, 0, Math.PI * 2);
      ctx.fill();

      // Ring
      if (p.hasRing) {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.ellipse(x + p.x, y + p.y, p.r * 1.6, p.r * 0.3, -0.3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Craters
      if (p.craters > 0) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        for (let ci = 0; ci < p.craters; ci++) {
          const cx = x + p.x + rand(-p.r * 0.4, p.r * 0.4);
          const cy = y + p.y + rand(-p.r * 0.4, p.r * 0.4);
          const cr = rand(3, p.r * 0.2);
          ctx.beginPath();
          ctx.arc(cx, cy, cr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.shadowBlur = 0;
    }

    // Aliens
    for (const a of this.aliens) {
      ctx.fillStyle = '#66ff66';
      ctx.shadowColor = '#66ff66';
      ctx.shadowBlur = 10;
      // Body
      ctx.beginPath();
      ctx.ellipse(x + a.x, y + a.y, a.size, a.size * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      // Eyes
      ctx.fillStyle = '#000000';
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(x + a.x - a.size * 0.3, y + a.y - a.size * 0.15, a.size * 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + a.x + a.size * 0.3, y + a.y - a.size * 0.15, a.size * 0.15, 0, Math.PI * 2);
      ctx.fill();
      // Eye whites
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + a.x - a.size * 0.3, y + a.y - a.size * 0.15, a.size * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + a.x + a.size * 0.3, y + a.y - a.size * 0.15, a.size * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  mutateDifference(existingDiffs) {
    const candidates = [];

    // 1. Change a planet's color
    for (let pi = 0; pi < this.planets.length; pi++) {
      const p = this.planets[pi];
      const pal = pi === 0 ? SPACE_COLORS.planet1 : pi === 1 ? SPACE_COLORS.planet2 : SPACE_COLORS.planet3;
      const key = `planet-color-${pi}`;
      if (!existingDiffs.some(d => d.key === key)) {
        const newColor = pickRandom(pal.filter(c => c !== p.color));
        candidates.push({
          key,
          x: p.x,
          y: p.y,
          hitX: () => p.x,
          hitY: () => p.y,
          hitW: p.r * 2,
          hitH: p.r * 2,
          apply: () => { p.color = newColor; },
          hint: 'Planet color changed',
        });
      }
    }

    // 2. Toggle planet ring
    for (let pi = 0; pi < this.planets.length; pi++) {
      const p = this.planets[pi];
      const key = `planet-ring-${pi}`;
      if (!existingDiffs.some(d => d.key === key)) {
        candidates.push({
          key,
          x: p.x,
          y: p.y,
          hitX: () => p.x,
          hitY: () => p.y,
          hitW: p.r * 3,
          hitH: p.r * 2,
          apply: () => { p.hasRing = !p.hasRing; },
          hint: 'Planet ring toggled',
        });
      }
    }

    // 3. Move an alien
    for (let ai = 0; ai < this.aliens.length; ai++) {
      const a = this.aliens[ai];
      const key = `alien-move-${ai}`;
      if (!existingDiffs.some(d => d.key === key)) {
        candidates.push({
          key,
          x: a.x,
          y: a.y,
          hitX: () => a.x,
          hitY: () => a.y,
          hitW: a.size * 2 + 10,
          hitH: a.size * 2 + 10,
          apply: () => { a.x = Math.max(30, Math.min(SCENE_W - 30, a.x + rand(-50, 50))); },
          hint: 'Alien moved',
        });
      }
    }

    if (candidates.length === 0) return null;
    return pickRandom(candidates);
  }
}

// ── Generate a pair of scenes with differences ──
function generateRound() {
  const Generator = pickRandom(sceneGenerators);
  const baseScene = new Generator();
  const diffScene = new Generator();

  // Copy base properties to diff scene — then apply mutations
  // Actually easier: use the same generator type but we need to track the diffs
  // Let's use a simpler approach: clone by creating two instances and applying mutations to the second

  // But we applied random in constructor, so they differ already.
  // We need to make a copy of the scene state and apply differences to the copy.
  // Actually the cleanest way is to serialize/deserialize the scene.

  // Simpler approach: Create base, then create diff as a deep clone, then apply differences to diff
  const baseJSON = JSON.stringify(baseScene, (key, val) => {
    if (key === 'differences' || key === 'mutatePointer') return undefined;
    return val;
  });
  const diffData = JSON.parse(baseJSON);

  // Rebuild diff scene from parsed data
  // We need to reconstruct the class instance. Let's just use a plain object pattern instead.
  // Actually this is getting complex. Let me simplify: both scenes start identical from the same instance,
  // then we apply mutations to the "right" scene only.

  // New approach: generate one scene, deep-copy it, then apply mutations to copy.
  // But our constructors use random. Let's make a generate function that creates a pair.

  // Simplest: Create ONE scene, serialize its data, deserialize for right, then mutate right.
  const cloneData = JSON.parse(JSON.stringify(baseScene, (k, v) => {
    if (k === 'differences' || k === 'mutatePointer') return undefined;
    return v;
  }));

  // Reconstruct objects (they're plain objects now, not class instances)
  // But draw() works on plain objects with the same properties, so that's fine.
  // We just need the mutateDifference function to work on plain objects too.
  // Let me just define mutateDifference as a standalone function.

  return { left: baseScene, right: cloneData };
}

// Standalone mutation function for any scene type
function mutateScene(scene, existingDiffs) {
  // Detect type by properties
  const isCity = 'buildings' in scene;
  const isWater = 'fishes' in scene;
  const isSpace = 'planets' in scene;

  if (isCity) return mutateCityDifference(scene, existingDiffs);
  if (isWater) return mutateWaterDifference(scene, existingDiffs);
  if (isSpace) return mutateSpaceDifference(scene, existingDiffs);
  return null;
}

function mutateCityDifference(scene, existingDiffs) {
  const candidates = [];

  // Toggle a window
  for (const b of scene.buildings) {
    for (let wi = 0; wi < b.windows.length; wi++) {
      const w = b.windows[wi];
      if (w._mutated) continue;
      const key = `city-win-${b.x}-${wi}`;
      if (!existingDiffs.some(d => d.key === key)) {
        candidates.push({
          key, scene,
          x: b.x + w.x - SCENE_W / 2,
          y: w.y,
          hitX: () => b.x + w.x,
          hitY: () => w.y,
          hitW: 14,
          hitH: 16,
          apply: () => { w.on = !w.on; w._mutated = true; },
          hint: 'Window changed',
        });
      }
    }
  }

  // Move a cloud
  for (let ci = 0; ci < scene.clouds.length; ci++) {
    const c = scene.clouds[ci];
    const key = `city-cloud-${ci}`;
    if (!existingDiffs.some(d => d.key === key)) {
      candidates.push({
        key, scene,
        x: c.x - SCENE_W / 2,
        y: c.y,
        hitX: () => c.x,
        hitY: () => c.y,
        hitW: c.w,
        hitH: c.h,
        apply: () => { c.x += rand(20, 60) * (Math.random() > 0.5 ? 1 : -1); },
        hint: 'Cloud moved',
      });
    }
  }

  if (candidates.length === 0) return null;
  return pickRandom(candidates);
}

function mutateWaterDifference(scene, existingDiffs) {
  const candidates = [];

  // Change fish color
  for (let fi = 0; fi < scene.fishes.length; fi++) {
    const f = scene.fishes[fi];
    const key = `water-fish-${fi}`;
    if (!existingDiffs.some(d => d.key === key)) {
      const newColor = pickRandom(WATER_COLORS.fish.filter(c => c !== f.color));
      candidates.push({
        key, scene,
        x: f.x - SCENE_W / 2,
        y: f.y,
        hitX: () => f.x,
        hitY: () => f.y,
        hitW: f.size * 2,
        hitH: f.size,
        apply: () => { f.color = newColor; },
        hint: 'Fish color changed',
      });
    }
  }

  // Toggle bubble visibility
  for (let bi = 0; bi < scene.bubbles.length; bi++) {
    const b = scene.bubbles[bi];
    const key = `water-bubble-${bi}`;
    if (!existingDiffs.some(d => d.key === key)) {
      candidates.push({
        key, scene,
        x: b.x - SCENE_W / 2,
        y: b.y,
        hitX: () => b.x,
        hitY: () => b.y,
        hitW: b.r * 2 + 4,
        hitH: b.r * 2 + 4,
        apply: () => { b.alpha = b.alpha > 0.1 ? 0 : rand(0.3, 0.7); },
        hint: 'Bubble hidden/shown',
      });
    }
  }

  if (candidates.length === 0) return null;
  return pickRandom(candidates);
}

function mutateSpaceDifference(scene, existingDiffs) {
  const candidates = [];

  // Change planet color
  for (let pi = 0; pi < scene.planets.length; pi++) {
    const p = scene.planets[pi];
    const key = `space-planet-${pi}`;
    if (!existingDiffs.some(d => d.key === key)) {
      const allColors = [...SPACE_COLORS.planet1, ...SPACE_COLORS.planet2, ...SPACE_COLORS.planet3];
      const newColor = pickRandom(allColors.filter(c => c !== p.color));
      candidates.push({
        key, scene,
        x: p.x - SCENE_W / 2,
        y: p.y,
        hitX: () => p.x,
        hitY: () => p.y,
        hitW: p.r * 2,
        hitH: p.r * 2,
        apply: () => { p.color = newColor; },
        hint: 'Planet color changed',
      });
    }
  }

  // Toggle planet ring
  for (let pi = 0; pi < scene.planets.length; pi++) {
    const p = scene.planets[pi];
    if (!('hasRing' in p)) continue;
    const key = `space-ring-${pi}`;
    if (!existingDiffs.some(d => d.key === key)) {
      candidates.push({
        key, scene,
        x: p.x - SCENE_W / 2,
        y: p.y,
        hitX: () => p.x,
        hitY: () => p.y,
        hitW: p.r * 3,
        hitH: p.r * 2,
        apply: () => { p.hasRing = !p.hasRing; },
        hint: 'Planet ring toggled',
      });
    }
  }

  // Move an alien
  if (scene.aliens) {
    for (let ai = 0; ai < scene.aliens.length; ai++) {
      const a = scene.aliens[ai];
      const key = `space-alien-${ai}`;
      if (!existingDiffs.some(d => d.key === key)) {
        candidates.push({
          key, scene,
          x: a.x - SCENE_W / 2,
          y: a.y,
          hitX: () => a.x,
          hitY: () => a.y,
          hitW: a.size * 2 + 10,
          hitH: a.size * 2 + 10,
          apply: () => { a.x = Math.max(30, Math.min(SCENE_W - 30, a.x + rand(-50, 50))); },
          hint: 'Alien moved',
        });
      }
    }
  }

  if (candidates.length === 0) return null;
  return pickRandom(candidates);
}

// ── Render a scene object using its own draw method or generic draw ──
function drawScene(ctx, scene, ox, oy) {
  if (scene.draw) {
    scene.draw(ctx, ox, oy);
  } else {
    // Plain object — use auto-detect
    const isCity = 'buildings' in scene;
    const isWater = 'fishes' in scene;
    const isSpace = 'planets' in scene;

    // We need generic draw functions for each. Let's extract them.
    // For simplicity, if it's a class instance use the method.
    // Since we deep-cloned, they're plain objects.
    // Let's just use the class draw by constructing temp instances.
    // OR: attach draw functions to scenes.
    // For now, this shouldn't happen because we always use class instances for left.
    // Right may be a clone, but draw functions got stripped by JSON.
    // We need a different approach.
  }
}

// ── Draw a scene (handles both class instances and plain objects) ──
function drawSceneGeneric(ctx, scene, ox, oy) {
  if (typeof scene.draw === 'function') {
    scene.draw(ctx, ox, oy);
    return;
  }

  // Auto-detect type from properties
  if (scene.buildings) {
    drawCityPlain(ctx, scene, ox, oy);
  } else if (scene.fishes) {
    drawWaterPlain(ctx, scene, ox, oy);
  } else if (scene.planets) {
    drawSpacePlain(ctx, scene, ox, oy);
  }
}

function drawCityPlain(ctx, scene, ox, oy) {
  const x = ox, y = oy;

  const grad = ctx.createLinearGradient(x, y, x, y + SCENE_H);
  grad.addColorStop(0, '#0a0a20');
  grad.addColorStop(0.5, '#1a1a3a');
  grad.addColorStop(1, '#2a2a4a');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, SCENE_W, SCENE_H);

  if (scene.stars) {
    for (const s of scene.stars) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + s.x, y + s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (scene.moonX !== undefined) {
    ctx.fillStyle = '#99aacc';
    ctx.shadowColor = '#99aacc';
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.arc(x + scene.moonX, y + scene.moonY, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  if (scene.clouds) {
    for (const c of scene.clouds) {
      ctx.fillStyle = '#334466';
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.ellipse(x + c.x, y + c.y, c.w / 2, c.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + c.x - c.w * 0.25, y + c.y + 5, c.w * 0.3, c.h * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + c.x + c.w * 0.25, y + c.y + 5, c.w * 0.3, c.h * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  if (scene.buildings) {
    for (const b of scene.buildings) {
      ctx.fillStyle = b.color;
      ctx.fillRect(x + b.x, y + b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(100,100,180,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + b.x, y + b.y, b.w, b.h);
      if (b.windows) {
        for (const w of b.windows) {
          ctx.fillStyle = w.on ? w.color : '#111122';
          ctx.fillRect(x + w.x, y + w.y, 10, 12);
        }
      }
    }
  }

  if (scene.groundY !== undefined) {
    ctx.fillStyle = '#1a1a30';
    ctx.fillRect(x, y + scene.groundY, SCENE_W, SCENE_H - scene.groundY);
    ctx.strokeStyle = '#2a2a44';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + scene.groundY + 2);
    ctx.lineTo(x + SCENE_W, y + scene.groundY + 2);
    ctx.stroke();
  }
}

function drawWaterPlain(ctx, scene, ox, oy) {
  const x = ox, y = oy;

  const grad = ctx.createLinearGradient(x, y, x, y + SCENE_H);
  grad.addColorStop(0, '#0a1a2a');
  grad.addColorStop(0.3, '#0d2137');
  grad.addColorStop(0.6, '#0f2844');
  grad.addColorStop(1, '#152a40');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, SCENE_W, SCENE_H);

  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = '#88ccff';
    const rx = rand(50, SCENE_W - 50);
    ctx.beginPath();
    ctx.moveTo(x + rx, y);
    ctx.lineTo(x + rx - 30, y + SCENE_H);
    ctx.lineTo(x + rx + 30, y + SCENE_H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (scene.seaweeds) {
    for (const sw of scene.seaweeds) {
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + sw.x, y + sw.y + sw.h);
      for (let s = 0; s <= sw.segments; s++) {
        const sy = y + sw.y + sw.h - (sw.h / sw.segments) * s;
        const sx = x + sw.x + Math.sin(rand(0, 6.28)) * 10;
        ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
  }

  if (scene.bubbles) {
    for (const b of scene.bubbles) {
      ctx.strokeStyle = '#88ccff';
      ctx.fillStyle = 'rgba(136,204,255,0.15)';
      ctx.globalAlpha = b.alpha || 0.4;
      ctx.beginPath();
      ctx.arc(x + b.x, y + b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  if (scene.rocks) {
    for (const r of scene.rocks) {
      ctx.fillStyle = r.color;
      ctx.beginPath();
      ctx.ellipse(x + r.x, y + r.y, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (scene.fishes) {
    for (const f of scene.fishes) {
      ctx.fillStyle = f.color;
      const fx = x + f.x;
      const fy = y + f.y;
      const dir = f.dir || 1;
      ctx.beginPath();
      ctx.ellipse(fx, fy, f.size, f.size * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(fx - f.size * dir, fy);
      ctx.lineTo(fx - f.size * 1.5 * dir, fy - f.size * 0.5);
      ctx.lineTo(fx - f.size * 1.5 * dir, fy + f.size * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(fx + dir * f.size * 0.3, fy - f.size * 0.1, f.size * 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(fx + dir * f.size * 0.3, fy - f.size * 0.1, f.size * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (scene.sandY !== undefined) {
    ctx.fillStyle = '#1a2a33';
    ctx.fillRect(x, y + scene.sandY, SCENE_W, SCENE_H - scene.sandY);
  }
}

function drawSpacePlain(ctx, scene, ox, oy) {
  const x = ox, y = oy;

  ctx.fillStyle = '#050510';
  ctx.fillRect(x, y, SCENE_W, SCENE_H);

  if (scene.nebulae) {
    for (const n of scene.nebulae) {
      const grad = ctx.createRadialGradient(x + n.x, y + n.y, 0, x + n.x, y + n.y, n.r);
      grad.addColorStop(0, n.color.replace(')', `, ${n.alpha || 0.08})`).replace('rgb', 'rgba'));
      grad.addColorStop(1, 'rgba(5,5,16,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x + n.x, y + n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (scene.stars) {
    for (const s of scene.stars) {
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.5 + Math.sin(s.twinkle || 0) * 0.4;
      ctx.beginPath();
      ctx.arc(x + s.x, y + s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (scene.planets) {
    for (const p of scene.planets) {
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 25;
      ctx.beginPath();
      ctx.arc(x + p.x, y + p.y, p.r, 0, Math.PI * 2);
      ctx.fill();

      if (p.hasRing) {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.ellipse(x + p.x, y + p.y, p.r * 1.6, p.r * 0.3, -0.3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.shadowBlur = 0;
    }
  }

  if (scene.aliens) {
    for (const a of scene.aliens) {
      ctx.fillStyle = '#66ff66';
      ctx.shadowColor = '#66ff66';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.ellipse(x + a.x, y + a.y, a.size, a.size * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(x + a.x - a.size * 0.3, y + a.y - a.size * 0.15, a.size * 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + a.x + a.size * 0.3, y + a.y - a.size * 0.15, a.size * 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + a.x - a.size * 0.3, y + a.y - a.size * 0.15, a.size * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + a.x + a.size * 0.3, y + a.y - a.size * 0.15, a.size * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}

// ── Game Module ──

const spotTheDifference = {
  name: 'Spot the Difference',
  description: 'Find 5 differences between two pictures before time runs out!',

  async init(canvas, ctx) {
    leftScene = null;
    rightScene = null;
    differences = [];
    foundIndices = [];
    foundParticles = [];
    wrongFlash = 0;
    warningFlash = 0;
    splashTimer = 2.0;
    lastTickSecond = -1;

    setGameData({
      score: 0,
      timeRemaining: TIME_LIMIT,
      totalTime: TIME_LIMIT,
      found: 0,
      total: TOTAL_DIFFERENCES,
      wrongTaps: 0,
      gameOver: false,
      won: false,
    });
  },

  update(dt) {
    const data = getGameData();
    if (data.gameOver) return;

    // Splash timer
    if (splashTimer > 0) {
      splashTimer -= dt;
      return;
    }

    // Decrease timer
    data.timeRemaining -= dt;

    // Tick sound every second in last 10
    const currentSec = Math.floor(data.timeRemaining);
    if (currentSec >= 0 && currentSec <= 10 && currentSec !== lastTickSecond) {
      if (currentSec > 0 || data.timeRemaining > 0) {
        AudioManager.playTick();
        warningFlash = 0.3;
      }
      lastTickSecond = currentSec;
    }

    // Warning flash fade
    if (warningFlash > 0) warningFlash -= dt;

    // Wrong flash fade
    if (wrongFlash > 0) wrongFlash -= dt;

    // Update found particles
    for (let i = foundParticles.length - 1; i >= 0; i--) {
      const p = foundParticles[i];
      p.life -= dt;
      p.radius += dt * 60;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) {
        foundParticles.splice(i, 1);
      }
    }

    // Check time up
    if (data.timeRemaining <= 0) {
      data.timeRemaining = 0;
      data.gameOver = true;
      data.won = false;
      AudioManager.playGameOver();
    }
  },

  draw(ctx) {
    const data = getGameData();

    // Background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, 1080, 1920);

    // Splash screen
    if (splashTimer > 0) {
      ctx.fillStyle = 'rgba(10,10,15,0.9)';
      ctx.fillRect(0, 0, 1080, 1920);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.shadowColor = PALETTE.neonCyan;
      ctx.shadowBlur = 60;
      ctx.fillStyle = PALETTE.neonCyan;
      ctx.font = 'bold 72px "Courier New", monospace';
      ctx.fillText('SPOT THE', 540, 700);
      ctx.shadowColor = PALETTE.neonPink;
      ctx.shadowBlur = 60;
      ctx.fillStyle = PALETTE.neonPink;
      ctx.fillText('DIFFERENCE!', 540, 800);
      ctx.shadowBlur = 0;

      ctx.fillStyle = PALETTE.white;
      ctx.font = '36px "Courier New", monospace';
      ctx.fillText(`Find ${TOTAL_DIFFERENCES} differences in ${TIME_LIMIT} seconds`, 540, 950);
      ctx.fillStyle = PALETTE.dim;
      ctx.font = '28px "Courier New", monospace';
      ctx.fillText('Wrong taps cost 5 seconds!', 540, 1030);

      // Countdown
      const count = Math.ceil(splashTimer);
      ctx.fillStyle = PALETTE.neonAmber;
      ctx.font = 'bold 160px "Courier New", monospace';
      ctx.fillText(count, 540, 1250);

      return;
    }

    // Draw scenes side by side
    if (leftScene) {
      drawSceneGeneric(ctx, leftScene, SCENE_X, SCENE_TOP);
    }
    if (rightScene) {
      drawSceneGeneric(ctx, rightScene, SCENE2_X, SCENE_TOP);
    }

    // Divider line
    ctx.strokeStyle = PALETTE.dim;
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(540, SCENE_TOP);
    ctx.lineTo(540, SCENE_TOP + SCENE_H);
    ctx.stroke();
    ctx.setLineDash([]);

    // "LEFT" / "RIGHT" labels
    ctx.fillStyle = PALETTE.dim;
    ctx.textAlign = 'center';
    ctx.font = '18px "Courier New", monospace';
    ctx.fillText('LEFT', 280, SCENE_TOP + SCENE_H + 30);
    ctx.fillText('RIGHT', 800, SCENE_TOP + SCENE_H + 30);

    // Found difference highlights on RIGHT scene only
    for (let i = 0; i < foundIndices.length; i++) {
      const diff = differences[foundIndices[i]];
      if (!diff) continue;
      const hx = diff.hitX();
      const hy = diff.hitY();

      // Highlight circle on both scenes
      for (const sceneX of [SCENE_X, SCENE2_X]) {
        ctx.strokeStyle = PALETTE.neonGreen;
        ctx.lineWidth = 3;
        ctx.shadowColor = PALETTE.neonGreen;
        ctx.shadowBlur = 15;
        const cx = sceneX + hx;
        const cy = SCENE_TOP + hy;
        ctx.beginPath();
        ctx.arc(cx + diff.hitW / 2, cy + diff.hitH / 2 - diff.hitH * 0.2, 20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // X mark
        ctx.strokeStyle = PALETTE.neonGreen;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 8, cy - 8);
        ctx.lineTo(cx + 8, cy + 8);
        ctx.moveTo(cx + 8, cy - 8);
        ctx.lineTo(cx - 8, cy + 8);
        ctx.stroke();
      }
    }

    // Draw found particles
    for (const p of foundParticles) {
      ctx.globalAlpha = p.alpha;
      ctx.strokeStyle = PALETTE.neonGreen;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Wrong tap flash overlay
    if (wrongFlash > 0) {
      ctx.fillStyle = `rgba(255, 51, 85, ${wrongFlash * 0.5})`;
      ctx.fillRect(0, 0, 1080, 1920);
    }

    // Low time warning
    if (data.timeRemaining <= 10 && warningFlash > 0) {
      const alpha = Math.sin(Date.now() / 150) * 0.15 + 0.15;
      ctx.fillStyle = `rgba(255, 51, 85, ${alpha})`;
      ctx.fillRect(0, 0, 1080, SCENE_TOP);
      ctx.fillRect(0, 0, SCENE_X, 1920);
      ctx.fillRect(1080 - 30, 0, 30, 1920);
    }
  },

  handlePointer(x, y) {
    const data = getGameData();
    if (data.gameOver || splashTimer > 0) return;
    if (!leftScene || !rightScene) return;

    // Check if tap is within either scene area
    const inLeftScene = x >= SCENE_X && x <= SCENE_X + SCENE_W && y >= SCENE_TOP && y <= SCENE_TOP + SCENE_H;
    const inRightScene = x >= SCENE2_X && x <= SCENE2_X + SCENE_W && y >= SCENE_TOP && y <= SCENE_TOP + SCENE_H;

    if (!inLeftScene && !inRightScene) return;

    // Determine which scene was tapped and get relative coordinates
    const sceneX = inLeftScene ? SCENE_X : SCENE2_X;
    const relX = x - sceneX;
    const relY = y - SCENE_TOP;

    // Check if tap is near any unfound difference
    let hitIndex = -1;
    for (let i = 0; i < differences.length; i++) {
      if (foundIndices.includes(i)) continue;
      const diff = differences[i];
      const dx = diff.hitX();
      const dy = diff.hitY();
      const hw = diff.hitW / 2;
      const hh = diff.hitH / 2;

      if (relX >= dx - hw && relX <= dx + hw &&
          relY >= dy - hh && relY <= dy + hh) {
        hitIndex = i;
        break;
      }
    }

    if (hitIndex >= 0) {
      // Correct!
      const diff = differences[hitIndex];
      foundIndices.push(hitIndex);
      foundIndices.sort((a, b) => a - b);

      data.found = foundIndices.length;
      data.score += SCORE_CORRECT;

      // Apply visual change to right scene
      diff.apply();

      // Particle effect
      foundParticles.push({
        x: sceneX + diff.hitX() + diff.hitW / 2,
        y: SCENE_TOP + diff.hitY() + diff.hitH / 2,
        radius: 10,
        life: 1.0,
        maxLife: 1.0,
        alpha: 1,
      });

      AudioManager.playCorrect();

      // Check win
      if (data.found >= data.total) {
        data.gameOver = true;
        data.won = true;
        // Time bonus
        const timeBonus = Math.floor(data.timeRemaining * SCORE_BONUS_MULT);
        data.score += timeBonus;
        AudioManager.playVictory();
      }
    } else {
      // Wrong tap — penalty
      data.timeRemaining -= PENALTY_TIME;
      data.wrongTaps++;
      wrongFlash = 0.3;
      AudioManager.playWrong();

      if (data.timeRemaining <= 0) {
        data.timeRemaining = 0;
        data.gameOver = true;
        data.won = false;
        AudioManager.playGameOver();
      }
    }

    setGameData(data);
  },

  cleanup() {
    leftScene = null;
    rightScene = null;
    differences = [];
    foundIndices = [];
    foundParticles = [];
    wrongFlash = 0;
  },

  // Called after every splash to transition into actual gameplay
  _onSplashDone() {
    const pair = generateRound();
    leftScene = pair.left;
    rightScene = pair.right;

    // Generate differences on the right scene
    differences = [];
    const usedKeys = new Set();
    for (let i = 0; i < TOTAL_DIFFERENCES; i++) {
      const diff = mutateScene(rightScene, differences);
      if (diff) {
        differences.push(diff);
        usedKeys.add(diff.key);
      } else {
        // Fill remaining with simpler differences
        break;
      }
    }

    setGameData({
      found: 0,
      total: differences.length,
    });

    // Debug log
    console.log(`Spot the Difference: Generated ${differences.length} differences`);
  },
};

// Override update to handle splash -> game transition
const origUpdate = spotTheDifference.update;
spotTheDifference.update = function(dt) {
  const data = getGameData();

  if (splashTimer > 0) {
    splashTimer -= dt;
    if (splashTimer <= 0) {
      // Splash done, generate the scenes
      const pair = generateRound();
      leftScene = pair.left;
      rightScene = pair.right;

      differences = [];
      for (let i = 0; i < TOTAL_DIFFERENCES; i++) {
        const diff = mutateScene(rightScene, differences);
        if (diff) {
          differences.push(diff);
        } else {
          // Not enough candidates — shouldn't happen with 5 diffs but just in case
          console.warn('Only generated', differences.length, 'differences');
          break;
        }
      }

      setGameData({
        found: 0,
        total: differences.length,
      });
    }
    return;
  }

  // Call original update
  if (typeof origUpdate === 'function') {
    origUpdate.call(spotTheDifference, dt);
  }
};

// Register with engine
registerGame(spotTheDifference);

export default spotTheDifference;