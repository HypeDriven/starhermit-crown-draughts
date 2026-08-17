// Offline content validators. Prove basic legality, reachable goals, bounded
// duration, and absence of soft locks. Puzzle content additionally requires a
// unique solution class unless the definition explicitly accepts multiples.

import { createGame, legalActions, apply, RULESETS } from '../rules/engine.js';
import { chooseAction } from '../rules/ai.js';
import { createRng } from '../rules/rng.js';
import { resolveStage } from './journey.js';

/**
 * Bounded self-play playout: proves a position terminates with a terminal
 * reason within `maxPlies`. Returns { ok, plies, reason, winner }.
 */
export function playoutProof(state, maxPlies = 320, seed = 1) {
  let s = state;
  const rng = createRng(seed);
  let plies = 0;
  while (s.phase === 'active' && plies < maxPlies) {
    const choice = chooseAction(s, { depth: 2, timeMs: 40, noise: 30, blunder: 0.05 }, rng);
    if (!choice) break;
    s = apply(s, choice.action);
    plies += 1;
  }
  return {
    ok: s.phase === 'over',
    plies,
    reason: s.result?.reason || null,
    winner: s.result?.winner ?? null,
  };
}

/**
 * Validate one resolved stage/challenge definition.
 * resolved: { def, setup, proof } from resolveStage().
 */
export function validateResolved(resolved) {
  const { def, setup, proof } = resolved;
  const issues = [];
  if (!def.id || !Number.isFinite(def.seed)) issues.push('missing id or seed');
  if (!RULESETS[def.ruleset]) issues.push(`unknown ruleset ${def.ruleset}`);
  let state;
  try {
    state = createGame({
      ruleset: def.ruleset, seed: def.seed,
      setup: setup || undefined,
      players: [{ name: 'W' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
    });
  } catch (e) {
    issues.push(`illegal setup: ${e.message}`);
    return { id: def.id, ok: false, issues };
  }
  // Soft-lock check: side to move must have a legal action.
  if (state.phase === 'active' && legalActions(state).length === 0) {
    issues.push('soft lock: side to move has no legal action');
  }
  // Puzzle stages: unique (or explicitly accepted) forced-win proof.
  if (def.goal?.kind === 'win' && Number.isFinite(def.goal.maxPlies)) {
    if (!proof || !proof.win) issues.push(`no forced win within ${def.goal.maxPlies} plies`);
    else {
      if (!def.allowMultipleSolutions && proof.solutions !== 1) {
        issues.push(`puzzle has ${proof.solutions} winning first moves (requires 1)`);
      }
      if (def.par < proof.plies) issues.push(`par ${def.par} below minimal solution ${proof.plies}`);
    }
  }
  // Bounded duration: self-play must terminate. Grand/melee courts run longer.
  const bound = state.ruleset === 'duel' ? 320 : 700;
  const play = playoutProof(state, bound, def.seed ^ 0x5bd1e995);
  if (!play.ok) issues.push(`playout did not terminate within ${bound} plies`);
  return { id: def.id, ok: issues.length === 0, issues, playout: play, proof: proof || null };
}

/** Validate every journey stage. Slow — used by tests and the bake tool. */
export function validateJourney(stages, onProgress = null) {
  const report = [];
  for (const def of stages) {
    const resolved = resolveStage(def);
    const res = validateResolved(resolved);
    report.push(res);
    if (onProgress) onProgress(res);
  }
  return report;
}
