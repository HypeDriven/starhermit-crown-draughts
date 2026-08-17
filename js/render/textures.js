// Procedural textures: marble, slate, grass, hedge, sky. All authored at
// runtime on canvases — no external assets — with deterministic seeded noise.

import * as THREE from '../../vendor/three.module.js';
import { createRng } from '../rules/rng.js';

function canvasTex(size, draw, { repeat = 1, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Layered value-noise marble veining. */
export function marbleTexture(base = '#d9cdb4', vein = '#b8a888', seed = 7) {
  const rng = createRng(seed);
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const img = ctx.getImageData(0, 0, s, s);
    const d = img.data;
    const [br, bg, bb] = hexToRgb(base);
    const [vr, vg, vb] = hexToRgb(vein);
    const ox = rng.next() * 100, oy = rng.next() * 100;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = (y * s + x) * 4;
        const n = fbm((x + ox) / 48, (y + oy) / 48, seed);
        const veinAmt = Math.pow(Math.abs(Math.sin((x / s) * 6 + n * 5)), 18) * 0.5;
        const grain = (fbm((x + oy) / 9, (y + ox) / 11, seed + 3) - 0.5) * 0.12;
        const m = Math.min(1, Math.max(0, veinAmt + grain));
        d[i] = br + (vr - br) * m;
        d[i + 1] = bg + (vg - bg) * m;
        d[i + 2] = bb + (vb - bb) * m;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

export function slateTexture(base = '#4a4f58', seed = 11) {
  const rng = createRng(seed);
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const img = ctx.getImageData(0, 0, s, s);
    const d = img.data;
    const [br, bg, bb] = hexToRgb(base);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = (y * s + x) * 4;
        const n = (fbm(x / 34, y / 34, seed) - 0.5) * 0.35 + (rng.next() - 0.5) * 0.05;
        d[i] = br * (1 + n);
        d[i + 1] = bg * (1 + n);
        d[i + 2] = bb * (1 + n);
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

export function grassTexture(base = '#5d7a44', seed = 21) {
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const [br, bg, bb] = hexToRgb(base);
    const rng = createRng(seed);
    for (let i = 0; i < 9000; i++) {
      const x = rng.next() * s;
      const y = rng.next() * s;
      const v = (rng.next() - 0.5) * 0.35;
      ctx.fillStyle = `rgb(${Math.round(br * (1 + v))},${Math.round(bg * (1 + v))},${Math.round(bb * (1 + v))})`;
      ctx.fillRect(x, y, 1.5, 2.5);
    }
  }, { repeat: 8 });
}

export function hedgeTexture(base = '#3f6032', seed = 31) {
  return canvasTex(128, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const [br, bg, bb] = hexToRgb(base);
    const rng = createRng(seed);
    for (let i = 0; i < 2600; i++) {
      const x = rng.next() * s;
      const y = rng.next() * s;
      const r = 1 + rng.next() * 2.6;
      const v = (rng.next() - 0.4) * 0.5;
      ctx.fillStyle = `rgba(${Math.round(br * (1 + v))},${Math.round(bg * (1 + v))},${Math.round(bb * (1 + v))},0.9)`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { repeat: 3 });
}

/** Soft radial sprite for particles and contact shadows. */
export function softDiscTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  return canvasTex(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }, { srgb: false });
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Cheap deterministic value noise. */
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const s32 = (seed | 0) || 1;
  const h = (a, b) => {
    let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(s32, 0x9e3779b9 | 0);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (((n ^ (n >>> 16)) >>> 0) % 1000) / 1000;
  };
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return h(xi, yi) * (1 - u) * (1 - v) + h(xi + 1, yi) * u * (1 - v) + h(xi, yi + 1) * (1 - u) * v + h(xi + 1, yi + 1) * u * v;
}

function fbm(x, y, seed) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 4; i++) {
    sum += vnoise(x * freq, y * freq, seed + i * 7) * amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum;
}
