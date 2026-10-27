// Key extraction for the i18n coverage test (also handy for listing keys).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RULESETS, INVALID_REASON_TEXT, TERMINAL_REASON_TEXT } from '../js/rules/engine.js';
import { AI_LEVELS } from '../js/rules/ai.js';
import { LESSONS } from '../js/content/lessons.js';
import { JOURNEY_STAGES, JOURNEY_CHAPTERS } from '../js/content/journey.js';
import { CHALLENGES } from '../js/content/challenges.js';
import { ACHIEVEMENTS } from '../js/content/achievements.js';
import { THEMES, COSMETICS, MASTERY_TRACK } from '../js/content/themes.js';
import { ACTIONS } from '../js/ui/actions.js';

const ROOT = new URL('..', import.meta.url).pathname;

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === 'i18n' ? [] : files(p)) : /\.(js|ts)$/.test(p) ? [p] : [];
  });
}

const unescape = (s) => s.replace(/\\(['"\\])/g, '$1');

export function sourceKeys() {
  const keys = new Set();
  // T(cond ? 'a' : 'b', …) picks one of two keys.
  const ternary = /(?<![\w.$])(?:T|tr)\([^'"\n()]*?\?\s*'((?:[^'\\\n]|\\.)*)'\s*:\s*'((?:[^'\\\n]|\\.)*)'/g;
  const ternary2 = /(?<![\w.$])(?:T|tr)\([^'"\n()]*?\?\s*"((?:[^"\\\n]|\\.)*)"\s*:\s*"((?:[^"\\\n]|\\.)*)"/g;
  const call = /(?<![\w.$])(?:T|N|tr)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
  for (const f of [...files(join(ROOT, 'js')), ...files(join(ROOT, 'native'))]) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(call)) keys.add(unescape(m[1] ?? m[2]));
    for (const m of src.matchAll(ternary)) { keys.add(unescape(m[1])); keys.add(unescape(m[2])); }
    for (const m of src.matchAll(ternary2)) { keys.add(unescape(m[1])); keys.add(unescape(m[2])); }
  }
  return keys;
}

export function contentKeys() {
  const keys = new Set();
  const add = (...v) => v.forEach((s) => { if (typeof s === 'string' && s) keys.add(s); });
  for (const r of Object.values(RULESETS)) add(r.name, r.description, r.playersLabel);
  for (const l of Object.values(AI_LEVELS)) add(l.name, l.blurb);
  Object.values(INVALID_REASON_TEXT).forEach((s) => add(s));
  Object.values(TERMINAL_REASON_TEXT).forEach((s) => add(s));
  for (const l of LESSONS) { add(l.title, l.intro); for (const s of l.steps) add(s.text, s.success); }
  for (const c of JOURNEY_CHAPTERS) add(c.name, c.blurb);
  for (const s of JOURNEY_STAGES) add(s.name, s.blurb);
  for (const c of CHALLENGES) add(c.name, c.desc);
  for (const a of ACHIEVEMENTS) add(a.name, a.desc);
  for (const t of Object.values(THEMES)) add(t.name, t.blurb);
  for (const c of COSMETICS) add(c.name, c.desc);
  for (const m of MASTERY_TRACK) add(m.label);
  for (const a of ACTIONS) add(a.label);
  // Seat names the game hands to the engine.
  add('You', 'Garden Novice', 'Garden AI', 'Ivory', 'Onyx', 'Jade', 'Ember', 'A house', 'Guest Gardener', 'House {n}');
  return keys;
}

export const ALL = new Set([...sourceKeys(), ...contentKeys()]);
