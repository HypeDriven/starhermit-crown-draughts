// The look per graphics level: the browser build's four presets and their
// 60 FPS budgets (js/render/gfx.js before the port: TABLE and BUDGETS) keyed
// by the runtime's quality tier (frame().quality), with the grass tuft and
// drifting-particle budgets scaled within the tier by the level
// (frame().levelIndex) as the browser build scaled them by its hardware
// level. The runtime owns what the old Graphics panel did besides: Auto and
// the level choice, render scale and the pixel-ratio cap, adaptive
// resolution, the frame-rate limit and readout, and the shadow map size it
// holds to the level.
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Lambert on Low, standard PBR on Balanced, clearcoat physical on High and Ultra. */
  material: "lambert" | "standard" | "physical";
  /** Procedural texture size in px (marble, slate, grass; hedge is half). */
  texture: number;
  /** Lathe segments of the turned pieces and the crown markers. */
  pieceSegs: number;
  crownSegs: number;
  /** Grass tufts around the terrace (detail) and drifting petals / snow / embers. */
  tufts: number;
  ambient: number;
  bloomRes: number;
  aoRes: number;
  /** Frosted backdrop blur behind the HUD rails and panels. */
  hudBlur: boolean;
}
export interface Look {
  preset: QualityTier;
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  reflections: boolean;
  particles: "low" | "high";
  detailed: boolean;
  budget: Budget;
}

const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, particles: "low", detailed: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, particles: "high", detailed: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, particles: "high", detailed: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, particles: "high", detailed: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", texture: 128, pieceSegs: 16, crownSegs: 12, tufts: 0, ambient: 40, bloomRes: 0.5, aoRes: 0.5, hudBlur: false },
  balanced: { material: "standard", texture: 256, pieceSegs: 24, crownSegs: 16, tufts: 160, ambient: 80, bloomRes: 0.5, aoRes: 0.5, hudBlur: false },
  high: { material: "physical", texture: 256, pieceSegs: 40, crownSegs: 28, tufts: 420, ambient: 140, bloomRes: 0.5, aoRes: 0.5, hudBlur: true },
  ultra: { material: "physical", texture: 512, pieceSegs: 64, crownSegs: 40, tufts: 700, ambient: 220, bloomRes: 1, aoRes: 1, hudBlur: true },
};
export const TUFT_MAX = 1400;
export const AMBIENT_MAX = 820;
/** The first level index of each tier (quantum, molecular, terrestrial, galactic). */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 quantum … 9 infinite). */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  // Levels are about 1.64× apart in GPU throughput; counts grow at most 2× within a tier.
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  const b = BUDGETS[preset];
  return {
    preset, ...TABLE[preset],
    budget: { ...b, tufts: Math.min(TUFT_MAX, Math.round(b.tufts * k)), ambient: Math.min(AMBIENT_MAX, Math.round(b.ambient * k)) },
  };
}
