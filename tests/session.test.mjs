import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, verifyReplay } from '../js/core/session.js';
import { chooseAction } from '../js/rules/ai.js';
import { legalActions } from '../js/rules/engine.js';
import { createRng } from '../js/rules/rng.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function practiceConfig(over = {}) {
  return {
    mode: 'practice', ruleset: 'duel', seed: 4242,
    players: [{ name: 'Human', kind: 'human' }, { name: 'Novice', kind: 'ai', aiLevel: 'novice' }],
    aiDelayMs: 0,
    ...over,
  };
}

test('golden session: full human-vs-AI game, replay verifies', async () => {
  const s = new Session(practiceConfig());
  const rng = createRng(1);
  const deadline = Date.now() + 90000;
  while (s.phase === 'active' && Date.now() < deadline) {
    if (s.isAiTurn()) {
      await wait(15); // let the AI driver fire
      continue;
    }
    const acts = s.legalTargets();
    const res = s.submit(acts[rng.int(acts.length)], 0);
    assert.ok(res.ok, res.reason);
    await wait(1);
  }
  assert.equal(s.phase, 'over');
  assert.ok(s.over.reason, 'terminal reason recorded');
  assert.ok(s.over.breakdowns[0].total !== undefined);
  const replay = s.replayEnvelope();
  const check = verifyReplay(replay);
  assert.ok(check.ok, check.reason);
  s.destroy();
});

test('snapshot/restore continues the exact game', async () => {
  const s = new Session(practiceConfig());
  const rng = createRng(2);
  const deadline = Date.now() + 30000;
  while (s.state.ply < 10 && s.phase === 'active' && Date.now() < deadline) {
    if (s.isAiTurn()) { await wait(15); continue; }
    s.submit(s.legalTargets()[rng.int(s.legalTargets().length)], 0);
    await wait(1);
  }
  const snap = s.snapshot();
  const plyAtSave = s.state.ply;
  const hashAtSave = s.replayEnvelope().initialHash;
  s.destroy(); // stop the original's timers before restoring
  const { session: restored, away } = Session.restore(snap);
  assert.equal(restored.state.ply, plyAtSave);
  assert.equal(restored.replayEnvelope().initialHash, hashAtSave);
  assert.equal(away.resumedAtPly, plyAtSave);
  // play on from the restore
  const deadline2 = Date.now() + 90000;
  while (restored.phase === 'active' && Date.now() < deadline2) {
    if (restored.isAiTurn()) { await wait(15); continue; }
    restored.submit(restored.legalTargets()[0], 0);
    await wait(1);
  }
  assert.equal(restored.phase, 'over');
  restored.destroy();
});

test('undo and hint are tracked as assists', async () => {
  const s = new Session(practiceConfig());
  s.submit(s.legalTargets()[0], 0);
  const deadline = Date.now() + 15000;
  while (s.isAiTurn() && Date.now() < deadline) await wait(15);
  assert.ok(s.state.ply >= 1);
  const hint = s.hint();
  assert.ok(hint.ok, hint.reason);
  const u = s.undo();
  assert.ok(u.ok);
  assert.ok(s.assistsUsed(), 'assists tracked');
  s.destroy();
});

test('undo is refused where the mode forbids it', () => {
  const s = new Session(practiceConfig({ mode: 'challenge', constraints: { noUndo: true, noHints: true } }));
  s.submit(s.legalTargets()[0], 0);
  assert.equal(s.canUndo(), false);
  assert.equal(s.undo().ok, false);
  assert.equal(s.canHint(), false);
  assert.equal(s.hint().ok, false);
  s.destroy();
});

test('clock expiry produces a timeout terminal state', async () => {
  const s = new Session(practiceConfig({ constraints: { clockMs: 300 } }));
  await wait(900); // human never moves; their 300ms clock drains
  assert.equal(s.phase, 'over');
  assert.equal(s.over.reason, 'timeout');
  assert.equal(s.over.winner, 1);
  s.destroy();
});

test('move-limit challenge fails when the limit passes without a win', async () => {
  const s = new Session(practiceConfig({
    mode: 'challenge',
    goal: { kind: 'win', maxPlies: 4 },
  }));
  for (let i = 0; i < 5 && s.phase === 'active'; i++) {
    if (s.isAiTurn()) { await wait(20); i--; continue; }
    s.submit(s.legalTargets()[0], 0);
    await wait(2);
  }
  assert.equal(s.phase, 'over');
  assert.equal(s.over.reason, 'move-limit-failed');
  s.destroy();
});

test('duplicate command ids are idempotent', () => {
  const s = new Session(practiceConfig());
  const a = s.legalTargets()[0];
  const cmd = { ...a, commandId: 'dup-1' };
  const r1 = s.submit(cmd, 0);
  const r2 = s.submit(cmd, 0);
  assert.ok(r1.ok);
  assert.ok(r2.ok && r2.duplicate);
  assert.equal(s.state.ply, 1);
  s.destroy();
});

test('invalid actions are counted per player and announced', () => {
  const s = new Session(practiceConfig());
  let heard = null;
  s.on('invalid', (ev) => { heard = ev; });
  const bad = { type: 'move', piece: 0, path: [[4, 3]] }; // white piece, illegal target
  const r = s.submit(bad, 0);
  assert.equal(r.ok, false);
  assert.ok(heard?.message);
  assert.equal(s.state.invalids[0], 1);
  s.destroy();
});
