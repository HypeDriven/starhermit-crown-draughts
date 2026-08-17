import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalActions, apply, validateAction, hashState } from '../js/rules/engine.js';
import { chooseAction, AI_LEVELS, hintAction } from '../js/rules/ai.js';
import { createRng } from '../js/rules/rng.js';

function playAiGame(levelA, levelB, seed, maxPlies = 250) {
  let s = createGame({ ruleset: 'duel', seed });
  const rng = createRng(seed ^ 0x77aa);
  let plies = 0;
  while (s.phase === 'active' && plies < maxPlies) {
    const level = s.turn === 0 ? levelA : levelB;
    const choice = chooseAction(s, { level }, rng);
    if (!choice) break;
    assert.ok(validateAction(s, choice.action).ok, 'AI move is legal');
    s = apply(s, choice.action);
    plies += 1;
  }
  return { state: s, plies };
}

test('AI returns a legal action from the opening at every level', () => {
  for (const level of Object.keys(AI_LEVELS)) {
    const s = createGame({ ruleset: 'duel', seed: 5 });
    const choice = chooseAction(s, { level }, createRng(1));
    assert.ok(choice && choice.action);
    assert.ok(validateAction(s, choice.action).ok, `${level} legal`);
  }
});

test('AI is deterministic given the same rng seed', () => {
  const s = createGame({ ruleset: 'duel', seed: 5 });
  const a = chooseAction(s, { level: 'adept' }, createRng(42));
  const b = chooseAction(s, { level: 'adept' }, createRng(42));
  assert.deepEqual(a.action, b.action);
});

test('AI takes a forced win in one', () => {
  // white to move can capture black's last piece
  const s = createGame({
    ruleset: 'duel', seed: 3,
    setup: { pieces: [{ owner: 0, r: 2, c: 1 }, { owner: 1, r: 3, c: 2 }], turn: 0 },
  });
  const choice = chooseAction(s, { level: 'master' }, createRng(9));
  const s2 = apply(s, choice.action);
  assert.equal(s2.phase, 'over');
  assert.equal(s2.result.winner, 0);
});

test('adept beats a random mover', () => {
  let s = createGame({ ruleset: 'duel', seed: 31 });
  const rng = createRng(31);
  let plies = 0;
  while (s.phase === 'active' && plies < 300) {
    if (s.turn === 0) {
      s = apply(s, chooseAction(s, { level: 'adept' }, rng).action);
    } else {
      const acts = legalActions(s);
      s = apply(s, acts[rng.int(acts.length)]);
    }
    plies += 1;
  }
  assert.equal(s.phase, 'over');
  assert.equal(s.result.winner, 0, 'adept defeats random play');
});

test('master does not lose to novice over a full game', () => {
  const { state } = playAiGame('master', 'novice', 77);
  if (state.phase === 'over') {
    assert.notEqual(state.result.winner, 1, 'novice never beats master');
  }
});

test('hintAction returns a legal action', () => {
  const s = createGame({ ruleset: 'duel', seed: 8 });
  const hint = hintAction(s, createRng(3));
  assert.ok(hint);
  assert.ok(validateAction(s, hint.action).ok);
});

test('AI on grand ruleset stays legal for 40 plies', () => {
  let s = createGame({ ruleset: 'grand', seed: 12 });
  const rng = createRng(12);
  for (let i = 0; i < 40 && s.phase === 'active'; i++) {
    const choice = chooseAction(s, { depth: 3, timeMs: 80 }, rng);
    assert.ok(validateAction(s, choice.action).ok);
    s = apply(s, choice.action);
  }
  assert.ok(true);
});

test('state hash is unchanged after a search that times out', () => {
  // Regression: timeout exceptions must not strand applied moves on the stack.
  const s = createGame({ ruleset: 'duel', seed: 21 });
  const h0 = hashState(s);
  for (let i = 0; i < 20; i++) {
    chooseAction(s, { depth: 12, timeMs: 0 }, createRng(i)); // forces timeout paths
    assert.equal(hashState(s), h0, 'search left the state untouched');
  }
});
