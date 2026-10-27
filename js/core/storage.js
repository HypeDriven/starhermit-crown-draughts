// Persistence shapes: the game's own options, the profile and the progress
// document, with their defaults, plus readers for what the browser build
// (before the StarHermit engine) left in the player's account. Pure functions
// over plain data: native/platform.ts keeps them in the engine's stores
// (`saves` for progress, `settings` for options and the profile, `storage`
// for the round in progress). No credentials or private chat are ever saved.

import { fnv1aHex } from '../rules/rng.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * The game's own options. Sound, graphics, language, key and pad bindings,
 * text size, high contrast and reduced motion are the runtime's Options now.
 */
export const DEFAULT_SETTINGS = {
  v: 2,
  muted: false,                                        // the M key: game sound off (the runtime's volumes still apply)
  accessibility: {
    colorPalette: 'default',                           // default|deuteranopia|protanopia|tritanopia
    leftHanded: false, timingAssist: false, haptics: true, domBoard: false,
  },
  camera: { preset: 'classic' },                       // classic|low|top
  telemetryConsent: null,                              // null = not asked, true/false
  theme: 'royal-garden',
  cosmetics: { material: 'marble-ivory', trail: 'trail-petals', surround: 'surround-fountain', flourish: 'flourish-none' },
};

export const DEFAULT_PROFILE = {
  v: 1,
  name: 'Guest Gardener',
  avatar: { color: '#d4af37', icon: 'crown' },
  rating: { duel: 1000, grand: 1000, melee: 1000 },
};

export const DEFAULT_PROGRESS = {
  v: 1,
  journey: {},            // stageId -> { completed, stars, bestPlies, plays }
  lessonsComplete: [],
  lessonsTotal: 8,
  achievements: [],       // unlocked keys
  stats: {
    roundsCompleted: 0, wins: 0, draws: 0, dailyWins: 0, dailyStreak: 0,
    bestDailyStreak: 0, crownsMade: 0, bestChain: 0, masterWins: 0,
    sessionsPlayed: 0, lastDailyDate: null,
  },
  challenges: {},         // id -> { completed, bestScore }
  daily: {},              // dateKey -> { completed, won, score, excluded }
  masteryClaimed: [],     // milestone star thresholds already acknowledged
};

/**
 * Merge a stored payload over defaults one level deep, so a save written before
 * a nested key existed (say `accessibility.haptics`) still gets its default
 * instead of an undefined that the UI would read as "off".
 */
export function mergeDefaults(defaults, stored) {
  const out = clone(defaults);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return out;
  for (const [k, v] of Object.entries(stored)) {
    if (!(k in defaults)) continue;
    const base = out[k];
    if (base && typeof base === 'object' && !Array.isArray(base) && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = { ...base, ...v };
    } else if (v !== undefined && (base === null || v === null || typeof v === typeof base)) {
      out[k] = v;
    }
  }
  return out;
}

export const normalizeSettings = (s) => mergeDefaults(DEFAULT_SETTINGS, s);
export const normalizeProfile = (p) => mergeDefaults(DEFAULT_PROFILE, p);
export const normalizeProgress = (p) => mergeDefaults(DEFAULT_PROGRESS, p);

// ---------------------------------------------------------------------------
// The browser build's documents
// ---------------------------------------------------------------------------

function checksum(payload) {
  return fnv1aHex(JSON.stringify(payload));
}

/**
 * The browser build's cloud save (the JS SDK slot `game:<slug>`, shown by the
 * engine as a foreign save): its text is a versioned document
 * `{ v, id, at, parentId, sum, payload }` whose payload is the progress
 * document. Returns the progress, or null when it is not one (or damaged).
 */
export function fromBrowserCloudSave(text) {
  if (typeof text !== 'string' || !text) return null;
  let doc;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!doc || typeof doc !== 'object' || typeof doc.payload !== 'object' || !doc.payload) return null;
  if (doc.v > 1) return null; // newer than we understand
  const { payload, parentId = null } = doc;
  if (doc.sum !== checksum({ payload, parentId })) return null;
  return normalizeProgress(payload);
}

/**
 * The browser build's per-player settings keys (the SDK's settings KV:
 * audio, graphics, accessibility, camera, theme, cosmetics, gamepad). Returns
 * the game settings a legacy key still means ({ key, value } pairs), or [].
 */
export function migrateLegacySetting(key, value) {
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  switch (key) {
    case 'theme': return typeof value === 'string' ? [{ key: 'theme', value }] : [];
    case 'camera': return obj && typeof obj.preset === 'string' ? [{ key: 'camera', value: { preset: obj.preset } }] : [];
    case 'cosmetics': return obj ? [{ key: 'cosmetics', value: { ...DEFAULT_SETTINGS.cosmetics, ...pick(obj, Object.keys(DEFAULT_SETTINGS.cosmetics), 'string') } }] : [];
    case 'accessibility': {
      if (!obj) return [];
      const a = { ...DEFAULT_SETTINGS.accessibility, ...pick(obj, ['leftHanded', 'timingAssist', 'haptics', 'domBoard'], 'boolean'), ...pick(obj, ['colorPalette'], 'string') };
      return [{ key: 'accessibility', value: a }];
    }
    case 'audio': return obj && typeof obj.muted === 'boolean' ? [{ key: 'muted', value: obj.muted }] : [];
    default: return []; // graphics, gamepad: the runtime's now
  }
}

function pick(obj, keys, type) {
  const out = {};
  for (const k of keys) if (typeof obj[k] === type) out[k] = obj[k];
  return out;
}
