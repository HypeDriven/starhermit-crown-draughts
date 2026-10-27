// Bakes the browser build's procedural stone, grass and hedge textures
// (js/render/textures.js before the port: seeded value-noise marble veining,
// slate mottling, grass blades, hedge leaves) into grey factor maps under
// assets/tex/: the engine's interpreter is far too slow to run the per-pixel
// noise at start. Each map is the texture divided by its base colour (so
// one map serves every theme's tint): native/render.ts multiplies it by the
// material colour, `gain` above 1 restoring what was scaled down to fit.
// Run: node tools/bake-textures.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { createRng } from '../js/rules/rng.js';

function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const s32 = (seed | 0) || 1;
  const h = (a, b) => {
    let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(s32, 0x9e3779b9 | 0);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (((n ^ (n >>> 16)) >>> 0) % 1000) / 1000;
  };
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return h(xi, yi) * (1 - u) * (1 - v) + h(xi + 1, yi) * u * (1 - v) + h(xi, yi + 1) * (1 - u) * v + h(xi + 1, yi + 1) * u * v;
}
function fbm(x, y, seed) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 4; i++) { sum += vnoise(x * freq, y * freq, seed + i * 7) * amp; amp *= 0.5; freq *= 2.1; }
  return sum;
}

/** Marble: base→vein by the veining mask; as a factor, 1 − (1 − k)·m with the veins k of the base. */
function marble(s, seed, k) {
  const rng = createRng(seed);
  const ox = rng.next() * 100, oy = rng.next() * 100;
  const out = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const u = x * 256 / s, v = y * 256 / s;
    const n = fbm((u + ox) / 48, (v + oy) / 48, seed);
    const veinAmt = Math.pow(Math.abs(Math.sin((x / s) * 6 + n * 5)), 18) * 0.5;
    const grain = (fbm((u + oy) / 9, (v + ox) / 11, seed + 3) - 0.5) * 0.12;
    const m = Math.min(1, Math.max(0, veinAmt + grain));
    out[y * s + x] = 1 - (1 - k) * m;
  }
  return out;
}
function slate(s, seed) {
  const rng = createRng(seed);
  const out = new Float32Array(s * s), k = 256 / s;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    out[y * s + x] = 1 + (fbm(x * k / 34, y * k / 34, seed) - 0.5) * 0.35 + (rng.next() - 0.5) * 0.05;
  }
  return out;
}
function grass(s, seed) {
  const out = new Float32Array(s * s).fill(1);
  const rng = createRng(seed);
  const blades = Math.round(9000 * (s / 256) ** 2);
  for (let i = 0; i < blades; i++) {
    const x = rng.next() * s, y = rng.next() * s, v = 1 + (rng.next() - 0.5) * 0.35;
    for (let yy = Math.floor(y); yy < Math.min(s, Math.ceil(y + 2.5)); yy++) for (let xx = Math.floor(x); xx < Math.min(s, Math.ceil(x + 1.5)); xx++) out[yy * s + xx] = v;
  }
  return out;
}
function hedge(s, seed) {
  const out = new Float32Array(s * s).fill(1);
  const rng = createRng(seed);
  const k = s / 128;
  for (let i = 0; i < Math.round(2600 * k * k); i++) {
    const x = rng.next() * s, y = rng.next() * s, r = (1 + rng.next() * 2.6) * k, v = 1 + (rng.next() - 0.4) * 0.5;
    for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
      if (xx < 0 || yy < 0 || xx >= s || yy >= s || (xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
      const o = yy * s + xx;
      out[o] = out[o] + (v - out[o]) * 0.9;
    }
  }
  return out;
}

function png(path, s, f, gain) {
  const raw = Buffer.alloc((s + 1) * s);
  for (let y = 0; y < s; y++) {
    raw[y * (s + 1)] = 0;
    for (let x = 0; x < s; x++) raw[y * (s + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(255 * f[y * s + x] / gain)));
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0); ihdr.writeUInt32BE(s, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(path, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

const dir = new URL('../assets/tex/', import.meta.url);
mkdirSync(dir, { recursive: true });
// name, size, field, gain (render.ts TEX_GAIN must match)
const maps = [
  ['marble-cell', 256, marble(256, 25, 0.81), 1.02],
  ['marble-frame', 256, marble(256, 3, 0.77), 1.02],
  ['marble-path', 256, marble(256, 6, 0.72), 1.02],
  ['marble-piece', 256, marble(256, 43, 0.87), 1.02],
  ['slate-cell', 256, slate(256, 31), 1.2],
  ['slate-piece', 256, slate(256, 41), 1.2],
  ['grass', 256, grass(256, 21), 1.18],
  ['hedge', 128, hedge(128, 31), 1.3],
];
for (const [name, s, f, gain] of maps) {
  png(new URL(`${name}.png`, dir), s, f, gain);
  console.log(`assets/tex/${name}.png ${s}x${s} gain ${gain}`);
}
