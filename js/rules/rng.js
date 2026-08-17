// Seeded randomness and hashing utilities.
// Separate streams are used for rules, content decoration, and audiovisual
// variants so cosmetic randomness can never influence rules outcomes.

/** mulberry32 — small, fast, deterministic PRNG. Returns floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.state = () => a >>> 0;
  next.setState = (s) => { a = s >>> 0; };
  return next;
}

/** FNV-1a 32-bit hash of a string. Returns an unsigned integer. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** FNV-1a rendered as 8 hex characters — used for state hashes in replays. */
export function fnv1aHex(str) {
  return fnv1a(str).toString(16).padStart(8, '0');
}

/** Derive a numeric seed from an arbitrary string (e.g. a UTC date). */
export function seedFromString(str) {
  return fnv1a(String(str));
}

/** A convenient RNG object with integer and pick helpers. */
export function createRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    state: () => next.state(),
    setState: (s) => next.setState(s),
    int: (n) => Math.floor(next() * n),
    range: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    fork: (salt) => createRng((next.state() ^ fnv1a(String(salt))) >>> 0),
  };
}
