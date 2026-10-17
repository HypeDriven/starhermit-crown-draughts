// Graphics quality model: presets, per-category overrides, GPU detection and a
// cost summary. Pure (no three.js), so the settings panel, the renderer and the
// unit tests agree on what a setting means.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],
  particles: ['low', 'high'],
  detail: ['plain', 'detailed'],
};

// Each preset is a row of tiers, a render scale (multiplies the capped device
// pixel ratio) and a device-pixel-ratio cap.
const TABLE = {
  low: { scale: 1, dprCap: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa', reflections: 'off', particles: 'low', detail: 'plain' },
  balanced: { scale: 0.9, dprCap: 1.5, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', particles: 'high', detail: 'detailed' },
  high: { scale: 1, dprCap: 2, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', particles: 'high', detail: 'detailed' },
  ultra: { scale: 1.25, dprCap: 2, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', particles: 'high', detail: 'detailed' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

export const DEFAULT_GRAPHICS = { preset: 'auto', render_scale: 1, adaptive: true, show_fps: false };

// Auto picks the preset from the StarHermit hardware level (gpu-level.js → globalThis.StarHermitGpu,
// loaded before the game modules): 0 = Galaxy S20 / Intel UHD or weaker and every software renderer,
// 20 = RTX 5090, each level ≈ 1.23×. Low from 0, Balanced from 4, High from 10, Ultra from 17. Phones,
// tablets and ≤ 4 GB machines are capped at level 9 (Balanced) by the shared module.
export const PRESET_LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level (0–20) for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system = {}) {
  const G = gpuApi();
  if (!G) return PRESET_LEVELS.balanced;
  return G.detectLevel({ webgl: true, webgl2: true, ...system, gpu: String(gpu || '') });
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  if (G) return G.presetForLevel(level, PRESET_LEVELS);
  return level >= 17 ? 'ultra' : level >= 10 ? 'high' : level >= 4 ? 'balanced' : 'low';
}

/** Best preset for this GPU (the level already caps phones and tablets at Balanced). */
export function detectPreset(gpu, system = {}) {
  return presetForLevel(detectLevel(gpu, system));
}

/*
 * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it (Low →
 * level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). Counts are tuned at
 * the preset's floor level and scale up within the preset on faster GPUs (StarHermitGpu.scaleBudget, ≤ 4×).
 *   material     'lambert' | 'standard' | 'physical' (stone cells, pieces, garden);
 *   texture      procedural canvas-texture size in px (marble, slate, grass; hedge is half);
 *   pieceSegs / crownSegs  lathe segments of the turned pieces and crown markers;
 *   tufts        grass tufts around the terrace (Garden detail); ambient  drifting petals/snow/embers;
 *   bloomRes / aoRes       bloom and GTAO resolution as a fraction of the frame;
 *   hudBlur      frosted backdrop blur behind the HUD rails and panels (re-composited every frame).
 */
export const BUDGETS = {
  low: { material: 'lambert', texture: 128, pieceSegs: 16, crownSegs: 12, tufts: 0, ambient: 40, bloomRes: 0.5, aoRes: 0.5, hudBlur: false },
  balanced: { material: 'standard', texture: 256, pieceSegs: 24, crownSegs: 16, tufts: 160, ambient: 80, bloomRes: 0.5, aoRes: 0.5, hudBlur: false },
  high: { material: 'physical', texture: 256, pieceSegs: 40, crownSegs: 28, tufts: 420, ambient: 140, bloomRes: 0.5, aoRes: 0.5, hudBlur: true },
  ultra: { material: 'physical', texture: 512, pieceSegs: 64, crownSegs: 40, tufts: 700, ambient: 220, bloomRes: 1, aoRes: 1, hudBlur: true },
};
const SCALED = ['tufts', 'ambient'];

/** A preset's concrete budget for a hardware level (counts scale up within the preset, never down). */
export function budgetFor(preset, level = 0) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const floor = PRESET_LEVELS[preset] || 0;
  const G = gpuApi();
  for (const k of SCALED) {
    b[k] = Math.round(G ? G.scaleBudget(b[k], Math.max(Number(level) || 0, floor), floor) : b[k]);
  }
  return b;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level = 0) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const out = {
    preset, auto,
    dprCap: row.dprCap,
    scale: row.scale * clamp(Number(s.render_scale) || 1, 0.5, 2),
  };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.budget = budgetFor(preset, level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; otherwise the canvas MSAA is used.
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' || out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

/** Apply a preset choice: clears every per-category override. */
export function choosePreset(saved, preset) {
  const out = { ...DEFAULT_GRAPHICS, ...(saved || {}) };
  for (const cat of Object.keys(CATEGORIES)) delete out[cat];
  out.preset = PRESETS.includes(preset) ? preset : 'auto';
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset]?.[cat];
}

const SUMMARY_EN = {
  noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion',
  bloom: 'bloom', reflections: 'reflections', noAa: 'no anti-aliasing',
};

/** Cost summary; `labels` localizes the words (defaults to English). */
export function describe(r, pixels, labels = SUMMARY_EN) {
  const L = { ...SUMMARY_EN, ...labels };
  const parts = [
    r.shadows === 'off' ? L.noShadows : `${SHADOW_MAP[r.shadows]}² ${L.shadows}`,
    r.ao === 'off' ? null : r.ao === 'high' ? L.aoHigh : L.ao,
    r.bloom === 'on' ? L.bloom : null,
    r.reflections === 'on' ? L.reflections : null,
    r.antialias === 'off' ? L.noAa : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** Migrate the pre-preset settings shape ({ tier, renderScale }). */
export function migrateGraphics(g) {
  const out = { ...DEFAULT_GRAPHICS, ...(g || {}) };
  if (g && g.tier && !g.preset) {
    out.preset = { high: 'high', medium: 'balanced', low: 'low' }[g.tier] || 'auto';
  }
  if (g && g.renderScale != null && g.render_scale == null) out.render_scale = clamp(Number(g.renderScale) || 1, 0.5, 2);
  delete out.tier;
  delete out.renderScale;
  return out;
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
