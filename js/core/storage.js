// Persistence: settings, profile, progression, snapshots, leaderboards.
// Versioned, checksummed documents; conflict detection keeps both snapshots
// and asks the player when neither is a strict descendant. No credentials or
// private chat are ever placed in saves.

import { fnv1aHex } from '../rules/rng.js';

const PREFIX = 'crown-draughts:';
const SAVE_VERSION = 1;

// In-memory fallback when localStorage is unavailable (private mode, tests).
const memory = new Map();
const backend = (() => {
  try {
    const k = `${PREFIX}probe`;
    globalThis.localStorage?.setItem(k, '1');
    globalThis.localStorage?.removeItem(k);
    return globalThis.localStorage;
  } catch {
    return {
      getItem: (k) => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => memory.set(k, String(v)),
      removeItem: (k) => memory.delete(k),
    };
  }
})();

function readRaw(key) {
  try { return backend.getItem(PREFIX + key); } catch { return null; }
}
function writeRaw(key, value) {
  try { backend.setItem(PREFIX + key, value); return true; } catch { return false; }
}
function removeRaw(key) {
  try { backend.removeItem(PREFIX + key); } catch { /* ignore */ }
}

function checksum(payload) {
  return fnv1aHex(JSON.stringify(payload));
}

function wrap(payload, parentId = null) {
  const body = { payload, parentId };
  return {
    v: SAVE_VERSION,
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
    at: new Date().toISOString(),
    parentId,
    sum: checksum(body),
    ...body,
  };
}

function unwrap(doc) {
  if (!doc || typeof doc !== 'object') return null;
  if (doc.v > SAVE_VERSION) return null; // newer than we understand — do not clobber
  const { payload, parentId } = doc;
  if (doc.sum !== checksum({ payload, parentId })) return null; // corrupted
  return doc;
}

function readDoc(key) {
  const raw = readRaw(key);
  if (!raw) return null;
  try { return unwrap(JSON.parse(raw)); } catch { return null; }
}

function writeDoc(key, payload, parentId = null) {
  const doc = wrap(payload, parentId);
  writeRaw(key, JSON.stringify(doc));
  return doc;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS = {
  v: 1,
  audio: { music: 0.7, effects: 0.9, ambience: 0.6, voice: 0.8, muted: false, voiceCues: false },
  graphics: { tier: 'auto', renderScale: 1.0 },       // tier: auto|high|medium|low
  accessibility: {
    reducedMotion: false, highContrast: false, colorPalette: 'default', // default|deuteranopia|protanopia|tritanopia
    largeText: false, leftHanded: false, holdToConfirm: false, timingAssist: false,
    haptics: true, domBoard: false,
  },
  camera: { preset: 'classic' },                       // classic|low|top
  bindings: null,                                      // keyboard overrides {action: code}
  gamepad: null,                                       // gamepad overrides {action: buttonIndex}
  tutorialSeen: {},
  telemetryConsent: null,                              // null = not asked, true/false
  theme: 'royal-garden',
  cosmetics: { material: 'marble-ivory', trail: 'trail-petals', surround: 'surround-fountain', flourish: 'flourish-none' },
};

export const DEFAULT_PROFILE = {
  v: 1,
  name: 'Guest Gardener',
  avatar: { color: '#d4af37', icon: 'crown' },
  rating: { duel: 1000, grand: 1000, melee: 1000 },
  hosted: false,
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function loadSettings() {
  const doc = readDoc('settings');
  return doc ? { ...structuredClone(DEFAULT_SETTINGS), ...doc.payload } : structuredClone(DEFAULT_SETTINGS);
}
export function saveSettings(settings) {
  const prev = readDoc('settings');
  return writeDoc('settings', settings, prev?.id || null);
}

export function loadProfile() {
  const doc = readDoc('profile');
  return doc ? { ...structuredClone(DEFAULT_PROFILE), ...doc.payload } : structuredClone(DEFAULT_PROFILE);
}
export function saveProfile(profile) {
  const prev = readDoc('profile');
  return writeDoc('profile', profile, prev?.id || null);
}

export function loadProgress() {
  const doc = readDoc('progress');
  return doc ? { ...structuredClone(DEFAULT_PROGRESS), ...doc.payload } : structuredClone(DEFAULT_PROGRESS);
}
export function saveProgress(progress) {
  const prev = readDoc('progress');
  return writeDoc('progress', progress, prev?.id || null);
}

/** Raw document access for cloud-save conflict handling. */
export function loadProgressDoc() {
  return readDoc('progress');
}
export function adoptProgressDoc(doc) {
  writeRaw('progress', JSON.stringify(doc));
}

// --- Cloud-save emulation ---------------------------------------------------
// The "cloud" document mirrors progress with an ancestor chain. When the game
// is hosted, the platform adapter syncs this document to the host; offline it
// stays local. Conflict detection works the same either way.

export function loadCloudSave() {
  return readDoc('cloudsave');
}
export function writeCloudSave(progress, parentId) {
  return writeDoc('cloudsave', progress, parentId);
}

/**
 * Compare local and cloud saves. Returns
 *  { status: 'same' | 'local-ahead' | 'cloud-ahead' | 'conflict', local, cloud }
 * Conflict means neither document is a strict descendant of the other — the
 * player must choose, and both snapshots are preserved.
 */
export function compareSaves(localDoc, cloudDoc) {
  if (!localDoc && !cloudDoc) return { status: 'same', local: null, cloud: null };
  if (!cloudDoc) return { status: 'local-ahead', local: localDoc, cloud: null };
  if (!localDoc) return { status: 'cloud-ahead', local: null, cloud: cloudDoc };
  if (localDoc.id === cloudDoc.id) return { status: 'same', local: localDoc, cloud: cloudDoc };
  if (JSON.stringify(localDoc.payload) === JSON.stringify(cloudDoc.payload)) {
    return { status: 'same', local: localDoc, cloud: cloudDoc };
  }
  if (localDoc.parentId === cloudDoc.id || isDescendant(localDoc, cloudDoc)) {
    return { status: 'local-ahead', local: localDoc, cloud: cloudDoc };
  }
  if (cloudDoc.parentId === localDoc.id || isDescendant(cloudDoc, localDoc)) {
    return { status: 'cloud-ahead', local: localDoc, cloud: cloudDoc };
  }
  return { status: 'conflict', local: localDoc, cloud: cloudDoc };
}

function isDescendant(doc, ancestor) {
  // Walk parentId chain of doc looking for ancestor.id (chains are short).
  let cur = doc;
  let guard = 0;
  while (cur && guard++ < 64) {
    if (cur.parentId === ancestor.id) return true;
    cur = cur.parentId ? readDoc(`archive:${cur.parentId}`) : null;
  }
  return false;
}

/** Preserve a losing snapshot under an archive key so nothing is ever lost. */
export function archiveSave(doc) {
  if (doc) writeRaw(`archive:${doc.id}`, JSON.stringify(doc));
}

// --- In-progress session snapshot (last safe local snapshot) ----------------

export function saveSessionSnapshot(snapshot) {
  return writeDoc('snapshot', snapshot);
}
export function loadSessionSnapshot() {
  return readDoc('snapshot')?.payload || null;
}
export function clearSessionSnapshot() {
  removeRaw('snapshot');
}

// --- Local leaderboard entries (daily/practice bests) ------------------------

export function loadLocalBoards() {
  return readDoc('boards')?.payload || { daily: [], practice: [] };
}
export function saveLocalBoards(boards) {
  const prev = readDoc('boards');
  return writeDoc('boards', boards, prev?.id || null);
}

/** Test-only: wipe everything. */
export function _clearAll() {
  for (const k of ['settings', 'profile', 'progress', 'cloudsave', 'snapshot', 'boards']) removeRaw(k);
  memory.clear();
}
