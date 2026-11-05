// The look per graphics level. The engine-owned effects (shadows and their
// map size, ambient occlusion, bloom, the grade, anti-aliasing) are the
// level's own (levelSettings(): the same table every StarHermit game reads).
// The game's art (materials, textures, lathe segments, reflections,
// particles, the detailed terrace, the HUD blur) is the browser build's four
// presets and their 60 FPS budgets (js/render/gfx.js before the port: TABLE
// and BUDGETS) keyed by the level's quality tier, with the grass tuft and
// drifting-particle budgets scaled within the tier by the level's particle
// budget against the tier's anchor level (quantum, molecular, terrestrial,
// galactic), at most twice. The runtime owns what the old Graphics panel did
// besides: Auto and the level choice, render scale and the pixel-ratio cap,
// adaptive resolution and the frame-rate limit and readout.
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Lambert on Low, standard PBR on Balanced, clearcoat physical on High and Ultra. */
  material: "lambert" | "standard" | "physical";
  /** Procedural texture size in px (marble, slate, grass; hedge is half), within the level's largest texture. */
  texture: number;
  /** Lathe segments of the turned pieces and the crown markers. */
  pieceSegs: number;
  crownSegs: number;
  /** Grass tufts around the terrace (detail) and drifting petals / snow / embers. */
  tufts: number;
  ambient: number;
  /** Frosted backdrop blur behind the HUD rails and panels. */
  hudBlur: boolean;
}
export interface Look {
  preset: QualityTier;
  /** The level's sun shadow map size, 0 when the level draws no shadows. */
  shadows: number;
  /** The level's ambient occlusion (null: off). */
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null: off). */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  reflections: boolean;
  particles: "low" | "high";
  detailed: boolean;
  budget: Budget;
}

type Art = Pick<Look, "reflections" | "particles" | "detailed">;
const ART: Record<QualityTier, Art> = {
  low: { reflections: false, particles: "low", detailed: false },
  balanced: { reflections: true, particles: "high", detailed: true },
  high: { reflections: true, particles: "high", detailed: true },
  ultra: { reflections: true, particles: "high", detailed: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", texture: 128, pieceSegs: 16, crownSegs: 12, tufts: 0, ambient: 40, hudBlur: false },
  balanced: { material: "standard", texture: 256, pieceSegs: 24, crownSegs: 16, tufts: 160, ambient: 80, hudBlur: false },
  high: { material: "physical", texture: 256, pieceSegs: 40, crownSegs: 28, tufts: 420, ambient: 140, hudBlur: true },
  ultra: { material: "physical", texture: 512, pieceSegs: 64, crownSegs: 40, tufts: 700, ambient: 220, hudBlur: true },
};
export const TUFT_MAX = 1400;
export const AMBIENT_MAX = 820;
/** The level whose settings are each tier's preset. */
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a graphics level (the frame's by default). */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  // Counts grow with the level's particle budget above the tier's anchor, at most 2× within a tier.
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  const b = BUDGETS[preset];
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: {
      ...b, texture: Math.min(b.texture, s.maxTextureSize),
      tufts: Math.min(TUFT_MAX, Math.round(b.tufts * k)), ambient: Math.min(AMBIENT_MAX, Math.round(b.ambient * k)),
    },
  };
}
