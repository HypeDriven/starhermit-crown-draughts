// Journey mode: 48 authored stages in six chapters. Generated layouts are
// resolved through the engine (and an exact solver for puzzle stages) and
// baked to concrete positions by tools/bake-journey.mjs — the runtime reads
// only the baked, validated data.

import {
  createGame, legalActions, validateSetup, isPlayable, isPromotionSquare,
  playerDef, applyInPlace, undoInPlace, positionKey, RULESETS,
} from '../rules/engine.js';
import { createRng } from '../rules/rng.js';

export const JOURNEY_CHAPTERS = [
  { id: 'ch1', name: 'The Garden Gate', blurb: 'Movement and the first captures.', ai: 'novice' },
  { id: 'ch2', name: 'The Hedges', blurb: 'Chains and the law of capture.', ai: 'apprentice' },
  { id: 'ch3', name: 'The Fountain Court', blurb: 'The race for the crown row.', ai: 'apprentice' },
  { id: 'ch4', name: 'The Rose Walk', blurb: 'Tactics: forced wins and sacrifices.', ai: 'adept' },
  { id: 'ch5', name: 'The Old Walls', blurb: 'Endgames decided by a single square.', ai: 'adept' },
  { id: 'ch6', name: 'The Throne Walk', blurb: 'Mastery trials on the grand court.', ai: 'master' },
];

const S = (chapter, index, name, opts) => ({
  id: `ch${chapter}-s${index}`,
  chapter, index, name,
  ruleset: 'duel',
  setup: 'standard',
  goal: { kind: 'win' },
  par: 60,
  theme: ['royal-garden', 'tide-terrace', 'dusk-conservatory', 'ember-court', 'frost-arbor'][(chapter - 1) % 5],
  mastery: index === 8,
  ...opts,
});

// setup shorthand: { w: [men, crowns], b: [men, crowns], capture?: true }
export const JOURNEY_STAGES = [
  // Chapter 1 — The Garden Gate
  S(1, 1, 'Stone by Stone', { seed: 1101, par: 90, ai: 'novice', tutorial: ['move'], blurb: 'A full court, a patient opponent. Learn the shape of a game.' }),
  S(1, 2, 'First Blood', { seed: 1102, setup: { w: [3, 0], b: [2, 0] }, par: 24, ai: 'novice', tutorial: ['capture'], blurb: 'Three against two. Take the court apart.' }),
  S(1, 3, 'The Open File', { seed: 1103, setup: { w: [4, 0], b: [3, 0] }, par: 30, ai: 'novice', tutorial: ['capture'] }),
  S(1, 4, 'Hedge Corners', { seed: 1104, setup: { w: [4, 0], b: [4, 0] }, par: 36, ai: 'novice' }),
  S(1, 5, 'Two Steps Ahead', { seed: 1105, setup: { w: [5, 0], b: [4, 0] }, par: 40, ai: 'novice' }),
  S(1, 6, 'The Low Wall', { seed: 1106, setup: { w: [6, 0], b: [5, 0] }, par: 48, ai: 'novice' }),
  S(1, 7, 'Garden Muster', { seed: 1107, par: 80, ai: 'novice', blurb: 'A full game. Put the lessons together.' }),
  S(1, 8, 'Gate Mastery', { seed: 1108, par: 70, ai: 'novice', mastery: true, blurb: 'Mastery trial: win a clean full game.' }),

  // Chapter 2 — The Hedges
  S(2, 1, 'Double Take', { seed: 1201, setup: { w: [2, 0], b: [3, 0], capture: true }, goal: { kind: 'win', maxPlies: 5 }, par: 5, ai: 'novice', tutorial: ['chain'], blurb: 'A forced sequence hides in the hedge. Find it.' }),
  S(2, 2, 'The Law Bends', { seed: 1202, setup: { w: [3, 0], b: [4, 0], capture: true }, goal: { kind: 'win', maxPlies: 7 }, par: 7, ai: 'novice', tutorial: ['chain'] }),
  S(2, 3, 'Snare', { seed: 1203, setup: { w: [3, 0], b: [5, 0], capture: true }, goal: { kind: 'win', maxPlies: 7 }, par: 7, ai: 'novice' }),
  S(2, 4, 'Thicket', { seed: 1204, setup: { w: [4, 0], b: [5, 0] }, par: 30, ai: 'novice' }),
  S(2, 5, 'Crossfire', { seed: 1205, setup: { w: [4, 0], b: [6, 0] }, par: 30, ai: 'novice' }),
  S(2, 6, 'The Long Chain', { seed: 1206, setup: { w: [5, 0], b: [6, 0], capture: true }, goal: { kind: 'win', maxPlies: 9 }, par: 9, ai: 'novice' }),
  S(2, 7, 'Hedge Maze', { seed: 1207, setup: { w: [6, 0], b: [6, 0] }, par: 44, ai: 'apprentice' }),
  S(2, 8, 'Hedge Mastery', { seed: 1208, par: 75, ai: 'apprentice', mastery: true }),

  // Chapter 3 — The Fountain Court
  S(3, 1, 'First Crown', { seed: 1301, setup: { w: [2, 1], b: [3, 0] }, par: 20, ai: 'novice', tutorial: ['promotion'] }),
  S(3, 2, 'The Coronet', { seed: 1302, setup: { w: [3, 1], b: [4, 0] }, par: 26, ai: 'novice', tutorial: ['promotion'] }),
  S(3, 3, 'Rising Water', { seed: 1303, setup: { w: [4, 1], b: [5, 0] }, par: 30, ai: 'novice' }),
  S(3, 4, 'Crown Race', { seed: 1304, setup: { w: [5, 0], b: [5, 0] }, par: 30, ai: 'apprentice' }),
  S(3, 5, 'Two Coronets', { seed: 1305, setup: { w: [4, 2], b: [5, 0] }, par: 30, ai: 'apprentice' }),
  S(3, 6, "The Jet d'Eau", { seed: 1306, setup: { w: [5, 1], b: [6, 0] }, par: 34, ai: 'apprentice' }),
  S(3, 7, 'Basin Edge', { seed: 1307, setup: { w: [6, 1], b: [7, 0] }, par: 40, ai: 'apprentice' }),
  S(3, 8, 'Fountain Mastery', { seed: 1308, par: 70, ai: 'apprentice', mastery: true }),

  // Chapter 4 — The Rose Walk
  S(4, 1, 'Thorn', { seed: 1401, setup: { w: [3, 0], b: [4, 0], capture: true }, goal: { kind: 'win', maxPlies: 5 }, par: 5, ai: 'apprentice' }),
  S(4, 2, 'Briar', { seed: 1402, setup: { w: [3, 1], b: [4, 0], capture: true }, goal: { kind: 'win', maxPlies: 7 }, par: 7, ai: 'apprentice' }),
  S(4, 3, 'The Offering', { seed: 1403, setup: { w: [4, 0], b: [5, 0], capture: true }, goal: { kind: 'win', maxPlies: 7 }, par: 7, ai: 'apprentice', blurb: 'Give a piece to take the game.' }),
  S(4, 4, 'Red on White', { seed: 1404, setup: { w: [4, 1], b: [5, 0], capture: true }, goal: { kind: 'win', maxPlies: 9 }, par: 9, ai: 'apprentice' }),
  S(4, 5, 'Espalier', { seed: 1405, setup: { w: [5, 1], b: [6, 0] }, par: 30, ai: 'apprentice' }),
  S(4, 6, 'Thorned Path', { seed: 2406, setup: { w: [5, 0], b: [6, 0], capture: true }, goal: { kind: 'win', maxPlies: 9 }, par: 9, ai: 'apprentice' }),
  S(4, 7, 'Full Bloom', { seed: 1407, setup: { w: [7, 0], b: [7, 0] }, par: 40, ai: 'adept' }),
  S(4, 8, 'Rose Mastery', { seed: 1408, par: 70, ai: 'adept', mastery: true }),

  // Chapter 5 — The Old Walls
  S(5, 1, 'Rampart', { seed: 1501, setup: { w: [2, 1], b: [2, 1] }, par: 24, ai: 'adept' }),
  S(5, 2, 'Arrow Slit', { seed: 1502, setup: { w: [1, 2], b: [2, 1] }, par: 20, ai: 'adept' }),
  S(5, 3, 'The Bastion', { seed: 1503, setup: { w: [2, 2], b: [3, 1] }, par: 26, ai: 'adept' }),
  S(5, 4, 'Crenellation', { seed: 1504, setup: { w: [3, 1], b: [3, 1] }, par: 28, ai: 'adept' }),
  S(5, 5, 'Siege', { seed: 1505, setup: { w: [3, 2], b: [4, 1] }, par: 30, ai: 'adept' }),
  S(5, 6, 'The Keep', { seed: 1506, setup: { w: [2, 2], b: [2, 2] }, par: 26, ai: 'adept' }),
  S(5, 7, 'Last Stones', { seed: 1507, setup: { w: [4, 1], b: [4, 1] }, par: 34, ai: 'adept' }),
  S(5, 8, 'Wall Mastery', { seed: 1508, par: 65, ai: 'adept', mastery: true }),

  // Chapter 6 — The Throne Walk
  S(6, 1, 'Antechamber', { seed: 1601, ruleset: 'grand', par: 110, ai: 'apprentice' }),
  S(6, 2, 'The Carpet', { seed: 1602, ruleset: 'grand', setup: { w: [6, 0], b: [6, 0] }, par: 60, ai: 'apprentice' }),
  S(6, 3, 'Petitioners', { seed: 1603, par: 70, ai: 'adept' }),
  S(6, 4, 'The Scepter', { seed: 1604, ruleset: 'grand', setup: { w: [4, 2], b: [5, 1] }, par: 50, ai: 'adept' }),
  S(6, 5, 'Heirs', { seed: 1605, setup: { w: [6, 2], b: [6, 2] }, par: 40, ai: 'adept' }),
  S(6, 6, 'The Regent', { seed: 1606, par: 80, ai: 'master', blurb: 'The Master of the court gives no quarter.' }),
  S(6, 7, 'The Abdication', { seed: 1607, setup: { w: [4, 1], b: [6, 0], capture: true }, goal: { kind: 'win', maxPlies: 9 }, par: 9, ai: 'master' }),
  S(6, 8, 'The Throne Walk', { seed: 1608, ruleset: 'grand', par: 120, ai: 'master', mastery: true, blurb: 'Final trial: the grand court, the Master, and the stone crown.' }),
];

export function stageById(id) {
  return JOURNEY_STAGES.find((s) => s.id === id) || null;
}

// ---------------------------------------------------------------------------
// Layout generation (deterministic; baked for shipping content)
// ---------------------------------------------------------------------------

function placementRows(ruleset, owner, crowned) {
  const size = RULESETS[ruleset].size;
  const rows = [];
  for (let r = 0; r < size; r++) rows.push(r);
  const lo = crowned ? 0 : 0;
  const hi = crowned ? size - 1 : Math.floor(size / 2) - 1;
  const loB = crowned ? 0 : Math.floor(size / 2);
  const hiB = size - 1;
  if (owner === 0) return rows.slice(lo, hi + 1);
  return rows.slice(loB, hiB + 1);
}

/**
 * Resolve a stage's setup into a concrete, engine-legal position.
 * Deterministic in (def.seed, attempt). For puzzle stages (goal.maxPlies),
 * the caller should prefer attempts the solver accepts — see resolveStage.
 */
export function generateStageSetup(def, attempt = 0) {
  if (def.setup === 'standard' || !def.setup) return null;
  const size = RULESETS[def.ruleset].size;
  const rng = createRng((def.seed * 2654435761 + attempt * 7919) >>> 0);
  const pieces = [];
  const used = new Set();
  const place = (owner, crowned) => {
    const rows = placementRows(def.ruleset, owner, crowned);
    for (let t = 0; t < 80; t++) {
      const r = rows[rng.int(rows.length)];
      const c = rng.int(size);
      if (!isPlayable(size, r, c) || used.has(r * size + c)) continue;
      if (!crowned && isPromotionSquare(playerDef(RULESETS[def.ruleset], owner), size, r, c)) continue;
      used.add(r * size + c);
      pieces.push({ owner, r, c, crowned });
      return true;
    }
    return false;
  };
  const [wm, wc] = def.setup.w;
  const [bm, bc] = def.setup.b;
  for (let i = 0; i < wm; i++) if (!place(0, false)) return null;
  for (let i = 0; i < wc; i++) if (!place(0, true)) return null;
  for (let i = 0; i < bm; i++) if (!place(1, false)) return null;
  for (let i = 0; i < bc; i++) if (!place(1, true)) return null;
  const setup = { pieces, turn: 0 };
  const probe = createGame({ ruleset: def.ruleset, seed: def.seed, setup });
  if (validateSetup(probe)) return null;
  const acts = legalActions(probe);
  if (acts.length === 0) return null;
  if (def.setup.capture && acts[0].captures.length === 0) return null;
  return setup;
}

// ---------------------------------------------------------------------------
// Exact solver for "win in N plies" puzzle stages
// ---------------------------------------------------------------------------

export const SOLVER_BUDGET = 400000;

class SolverBudget extends Error {}

/**
 * Can the side to move force a win within `plies` plies?
 * Returns { win, plies?, solutions? } — solutions counts winning first moves.
 */
export function solveForcedWin(initialState, plies) {
  const memo = new Map();
  let budget = SOLVER_BUDGET;

  // fw(s, n): side to move forces a win within n plies from s.
  function fw(s, n) {
    if (n <= 0) return false;
    if (--budget <= 0) throw new SolverBudget('solver budget exceeded');
    const key = `${positionKey(s)}|${n}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let res = false;
    for (const a of legalActions(s)) {
      const t = applyInPlace(s, a);
      let ok;
      try {
        if (s.phase === 'over') {
          ok = s.result.winner === t.prevTurn;
        } else {
          ok = true;
          // every opponent reply must still lose for them
          for (const o of legalActions(s)) {
            const t2 = applyInPlace(s, o);
            let sub;
            try {
              if (s.phase === 'over') sub = false; // opponent won or drew — not our win
              else sub = fw(s, n - 2);
            } finally {
              undoInPlace(s, t2);
            }
            if (!sub) { ok = false; break; }
          }
        }
      } finally {
        undoInPlace(s, t);
      }
      if (ok) { res = true; break; }
    }
    memo.set(key, res);
    return res;
  }

  try {
    for (let n = 1; n <= plies; n += 1) {
      if (fw(initialState, n)) {
        // count distinct winning first moves at the tightest bound
        let solutions = 0;
        for (const a of legalActions(initialState)) {
          const t = applyInPlace(initialState, a);
          let ok;
          try {
            if (initialState.phase === 'over') ok = initialState.result.winner === t.prevTurn;
            else {
              ok = true;
              for (const o of legalActions(initialState)) {
                const t2 = applyInPlace(initialState, o);
                let sub;
                try {
                  if (initialState.phase === 'over') sub = false;
                  else sub = fw(initialState, n - 2);
                } finally {
                  undoInPlace(initialState, t2);
                }
                if (!sub) { ok = false; break; }
              }
            }
          } finally {
            undoInPlace(initialState, t);
          }
          if (ok) solutions += 1;
        }
        return { win: true, plies: n, solutions };
      }
    }
    return { win: false };
  } catch (e) {
    if (e instanceof SolverBudget) return { win: false, unknown: true };
    throw e;
  }
}

/**
 * Fully resolve a stage: pick the first generated attempt that is legal and,
 * for puzzle stages, provably a forced win within the limit with a unique
 * first move (unless the stage explicitly accepts multiple solution classes).
 */
export function resolveStage(def, maxAttempts = 400) {
  if (def.setup === 'standard' || !def.setup) {
    return { def, setup: null, proof: null };
  }
  const isPuzzle = def.goal?.kind === 'win' && Number.isFinite(def.goal.maxPlies);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const setup = generateStageSetup(def, attempt);
    if (!setup) continue;
    if (!isPuzzle) return { def, setup, proof: null };
    const state = createGame({ ruleset: def.ruleset, seed: def.seed, setup });
    const proof = solveForcedWin(state, def.goal.maxPlies);
    if (!proof.win) continue;
    if (!def.allowMultipleSolutions && proof.solutions !== 1) continue;
    return { def, setup, proof };
  }
  throw new Error(`could not resolve stage ${def.id} within ${maxAttempts} attempts`);
}
