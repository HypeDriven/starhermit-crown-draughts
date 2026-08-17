// Content registry: versioned levels, themes, tutorials, validation metadata.
// Runtime reads baked (pre-validated) layouts; the live generator/solver is
// only used by the bake tool and tests.

import { JOURNEY_STAGES, JOURNEY_CHAPTERS, stageById, resolveStage } from './journey.js';
import { CHALLENGES, challengeById } from './challenges.js';
import { LESSONS, lessonById } from './lessons.js';
import { THEMES, DEFAULT_THEME, COSMETICS, MASTERY_TRACK } from './themes.js';
import { ACHIEVEMENTS } from './achievements.js';
import { dailyDefinition } from './daily.js';
import { BAKED } from './baked.js';

export const CONTENT_SCHEMA_VERSION = 1;

export {
  JOURNEY_STAGES, JOURNEY_CHAPTERS, CHALLENGES, LESSONS, THEMES, COSMETICS,
  MASTERY_TRACK, ACHIEVEMENTS, DEFAULT_THEME, stageById, challengeById, lessonById,
  dailyDefinition,
};

/**
 * Concrete setup for a content definition (journey stage or challenge).
 * Uses the baked, validated layout; falls back to live resolution if the
 * baked file is missing the entry (defensive — tests ensure it never is).
 */
export function contentSetup(def) {
  if (!def || !def.setup || def.setup === 'standard') return null;
  const bakedEntry = BAKED.journey[def.id] || BAKED.challenges[def.id];
  if (bakedEntry) return bakedEntry;
  return resolveStage(def).setup;
}

/** Journey unlock rule: linear within chapters; chapter gates on prior mastery. */
export function stageUnlocked(progress, stage) {
  if (stage.chapter === 1 && stage.index === 1) return true;
  const prevId = stage.index > 1
    ? `ch${stage.chapter}-s${stage.index - 1}`
    : `ch${stage.chapter - 1}-s8`;
  return !!progress.journey[prevId]?.completed;
}

export function journeyStats(progress) {
  let completed = 0;
  let stars = 0;
  for (const s of JOURNEY_STAGES) {
    const rec = progress.journey[s.id];
    if (rec?.completed) {
      completed += 1;
      stars += rec.stars || 1;
    }
  }
  return { completed, total: JOURNEY_STAGES.length, stars, maxStars: JOURNEY_STAGES.length * 3 };
}

/** Star awards for a completed stage: completion, par, no assists. */
export function starsForResult({ won, plies, par, assistsUsed }) {
  if (!won) return 0;
  let stars = 1;
  if (plies <= par) stars += 1;
  if (!assistsUsed) stars += 1;
  return stars;
}
