// Deterministic alpha-beta AI for two-player rulesets.
//
// Search is fully deterministic given (state, level, rng seed): equal-scoring
// moves are ordered by a stable key and randomness comes only from the
// injected seeded rng, so replays and daily challenges are reproducible.

import { legalActions, validateAction, applyInPlace, undoInPlace, RULESETS } from './engine.js';
import { createRng } from './rng.js';

const WIN = 100000;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const AI_LEVELS = {
  novice: {
    id: 'novice', name: 'Novice', depth: 2, timeMs: 120, noise: 70, blunder: 0.22, rating: 800,
    blurb: 'Learning the ropes. A gentle first opponent.',
  },
  apprentice: {
    id: 'apprentice', name: 'Apprentice', depth: 4, timeMs: 300, noise: 28, blunder: 0.07, rating: 1050,
    blurb: 'Sees simple tactics and short chains.',
  },
  adept: {
    id: 'adept', name: 'Adept', depth: 6, timeMs: 650, noise: 8, blunder: 0.02, rating: 1350,
    blurb: 'Plans several moves ahead. A real contest.',
  },
  master: {
    id: 'master', name: 'Master', depth: 9, timeMs: 1300, noise: 0, blunder: 0, rating: 1650,
    blurb: 'Deep search, no mercy. Beat this and the court is yours.',
  },
};

/** Static evaluation from the perspective of the side to move (2-player). */
export function evaluate(state) {
  const me = state.turn;
  const opp = state.players.length === 2 ? 1 - me : (me + 1) % state.players.length;
  const size = state.size;
  const mid = (size - 1) / 2;
  let s = 0;
  for (const p of state.pieces) {
    if (p.captured) continue;
    const mine = p.owner === me;
    if (p.owner !== me && p.owner !== opp) continue; // melee: nearest rival only
    const sign = mine ? 1 : -1;
    s += sign * (p.crowned ? 290 : 100);
    const def = state.players[p.owner];
    if (!p.crowned) {
      const coord = def.axis === 'r' ? p.r : p.c;
      const prog = def.dir === 1 ? coord : size - 1 - coord;
      s += sign * prog * 5;
      const homeCoord = def.dir === 1 ? 0 : size - 1;
      if (coord === homeCoord) s += sign * 6; // back-rank guard
    }
    const dcen = Math.abs(p.r - mid) + Math.abs(p.c - mid);
    if (dcen <= 3) s += sign * 4;
  }
  return s;
}

function orderMoves(state, actions) {
  for (const a of actions) {
    let k = a.captures.length * 1000;
    if (a.crowns) k += 500;
    const last = a.path[a.path.length - 1];
    k -= last[0] * state.size + last[1]; // stable tie-break
    a._k = k;
  }
  actions.sort((x, y) => y._k - x._k);
  return actions;
}

function terminalScore(state, mover, ply) {
  const r = state.result;
  if (!r || r.winner === null) return 0;
  return r.winner === mover ? WIN - ply : -WIN + ply;
}

function negamax(state, depth, alpha, beta, ply, deadline) {
  const actions = orderMoves(state, legalActions(state));
  if (actions.length === 0) return -WIN + ply; // unreachable in a live state; defensive
  let best = -Infinity;
  for (const a of actions) {
    if ((ply & 3) === 0 && now() > deadline) throw Timeout;
    const token = applyInPlace(state, a);
    let score;
    try {
      if (state.phase === 'over') {
        score = terminalScore(state, token.prevTurn, ply);
      } else if (depth <= 1) {
        score = -quiesce(state, -beta, -alpha, ply + 1, deadline);
      } else {
        score = -negamax(state, depth - 1, -beta, -alpha, ply + 1, deadline);
      }
    } finally {
      undoInPlace(state, token);
    }
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

const QDEPTH_MAX = 10;
function quiesce(state, alpha, beta, ply, deadline) {
  const stand = evaluate(state);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (ply >= QDEPTH_MAX) return stand;
  const actions = legalActions(state);
  const captures = actions.filter((a) => a.captures.length > 0);
  if (captures.length === 0) return stand;
  orderMoves(state, captures);
  for (const a of captures) {
    if (now() > deadline) throw Timeout;
    const token = applyInPlace(state, a);
    let score;
    try {
      if (state.phase === 'over') score = terminalScore(state, token.prevTurn, ply);
      else score = -quiesce(state, -beta, -alpha, ply + 1, deadline);
    } finally {
      undoInPlace(state, token);
    }
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

const Timeout = Symbol('search-timeout');
// Exported for tests/debugging of the search core.
export const _internals = { negamax, quiesce, evaluate, orderMoves };

/**
 * Choose an action. opts: { level | depth, timeMs, noise, blunder }, rng seeded
 * by the caller. Returns { action, score, depth } or null when no move exists.
 */
export function chooseAction(state, opts = {}, rng = createRng(1)) {
  const level = typeof opts.level === 'string' ? AI_LEVELS[opts.level] : null;
  const maxDepth = opts.depth ?? level?.depth ?? 4;
  const timeMs = opts.timeMs ?? level?.timeMs ?? 300;
  const noise = opts.noise ?? level?.noise ?? 0;
  const blunder = opts.blunder ?? level?.blunder ?? 0;

  const legal = legalActions(state);
  if (legal.length === 0) return null;
  if (legal.length === 1) return { action: legal[0], score: 0, depth: 0 };

  // Deliberate blunder for gentler levels: play a random legal move.
  if (blunder > 0 && rng.next() < blunder) {
    return { action: legal[rng.int(legal.length)], score: 0, depth: 0, blunder: true };
  }

  const deadline = now() + timeMs;
  const scored = new Map();
  let bestDepth = 0;
  const rootMoves = orderMoves(state, legal.slice());
  try {
    for (let d = 1; d <= maxDepth; d++) {
      const roundScores = new Map();
      for (const a of rootMoves) {
        if (now() > deadline && d > 1) throw Timeout;
        const token = applyInPlace(state, a);
        let score;
        try {
          // Full window at the root: recorded scores must be exact, never
          // fail-soft bounds, or losing moves can clamp to alpha and win selection.
          if (state.phase === 'over') score = terminalScore(state, token.prevTurn, 1);
          else if (d <= 1) score = -quiesce(state, -Infinity, Infinity, 1, deadline);
          else score = -negamax(state, d - 1, -Infinity, Infinity, 1, deadline);
        } finally {
          undoInPlace(state, token);
        }
        roundScores.set(a, score);
      }
      for (const [a, s] of roundScores) scored.set(a, s);
      bestDepth = d;
      // re-order root moves by latest scores for better pruning next iteration
      rootMoves.sort((x, y) => (scored.get(y) ?? 0) - (scored.get(x) ?? 0));
      if ([...roundScores.values()].some((s) => s >= WIN - 50)) break; // forced win found
    }
  } catch (e) {
    if (e !== Timeout) throw e;
  }

  let best = null;
  let bestScore = -Infinity;
  for (const [a, s0] of scored) {
    const s = s0 + (noise ? Math.round((rng.next() * 2 - 1) * noise) : 0);
    if (s > bestScore) { bestScore = s; best = a; }
  }
  if (opts.debugScores) {
    opts.debugScores([...scored.entries()].map(([a, s]) => ({ move: a, score: s })));
  }
  return { action: best, score: bestScore, depth: bestDepth };
}

/** A quick, strong suggestion for the hint button and lessons. */
export function hintAction(state, rng = createRng(7)) {
  return chooseAction(state, { depth: 5, timeMs: 400, noise: 0, blunder: 0 }, rng);
}

/** Validate that chooseAction never returns an illegal action. */
export function assertLegalChoice(state, opts, rng) {
  const choice = chooseAction(state, opts, rng);
  if (!choice) return null;
  const v = validateAction(state, choice.action);
  if (!v.ok) throw new Error(`AI produced illegal action: ${v.reason}`);
  return choice;
}
