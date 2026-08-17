// Daily challenge: one shared seed and ruleset per UTC day, synchronized to
// platform time. Seeds are immutable after publication — if a day's content
// fails validation it is marked excluded from ranking, never replaced.

import { seedFromString, createRng } from '../rules/rng.js';

export function utcDateKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function dayNumber(key) {
  return Math.floor(Date.parse(`${key}T00:00:00Z`) / 86400000);
}

/**
 * The daily definition for a UTC date key ('YYYY-MM-DD'). Pure and stable:
 * the same date always yields the same content, forever.
 */
export function dailyDefinition(dateKey) {
  const key = dateKey || utcDateKey();
  const day = dayNumber(key);
  const seed = seedFromString(`crown-draughts:daily:${key}`);
  const rng = createRng(seed);
  const rulesets = ['duel', 'duel', 'grand'];
  const ruleset = rulesets[day % rulesets.length];
  const levels = ['apprentice', 'apprentice', 'adept', 'adept', 'master', 'novice', 'adept'];
  const ai = levels[day % levels.length];
  const themes = ['royal-garden', 'tide-terrace', 'dusk-conservatory', 'ember-court', 'frost-arbor'];
  const theme = themes[Math.floor(day / 2) % themes.length];
  // Every seventh day adds a gentle move limit for variety.
  const maxPlies = day % 7 === 3 ? (ruleset === 'grand' ? 120 : 80) : null;
  return {
    id: `daily-${key}`,
    date: key,
    seed,
    ruleset,
    ai,
    theme,
    goal: maxPlies ? { kind: 'win', maxPlies } : { kind: 'win' },
    par: ruleset === 'grand' ? 110 : 70,
    constraints: {},
    ranked: true,
    name: `Daily Court — ${key}`,
  };
}

/** Milliseconds until the next daily rollover (UTC midnight). */
export function msUntilNextDaily(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}
