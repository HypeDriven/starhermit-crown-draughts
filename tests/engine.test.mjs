import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, legalActions, validateAction, apply, applyInPlace, undoInPlace,
  serialize, deserialize, migrateState, hashState, cloneState, playerStats,
  scoreBreakdown, compareResults, eloDelta, describeAction, isPlayable,
  RULESETS, squareName,
} from '../js/rules/engine.js';
import { createRng } from '../js/rules/rng.js';

const p = (owner, r, c, crowned = false) => ({ owner, r, c, crowned });

function custom(ruleset, pieces, turn = 0, seed = 7) {
  return createGame({ ruleset, seed, setup: { pieces, turn } });
}

// ---------------------------------------------------------------------------
test('initial positions: counts and playable squares', () => {
  const duel = createGame({ ruleset: 'duel', seed: 1 });
  assert.equal(duel.pieces.length, 24);
  assert.equal(duel.pieces.filter((x) => x.owner === 0).length, 12);
  assert.equal(duel.pieces.filter((x) => x.owner === 1).length, 12);
  for (const pc of duel.pieces) assert.ok(isPlayable(8, pc.r, pc.c));
  const grand = createGame({ ruleset: 'grand', seed: 1 });
  assert.equal(grand.pieces.length, 40);
  const melee = createGame({ ruleset: 'melee', seed: 1 });
  assert.equal(melee.pieces.length, 24);
  assert.equal(new Set(melee.pieces.map((x) => x.owner)).size, 4);
  const squares = new Set(melee.pieces.map((x) => x.r * 10 + x.c));
  assert.equal(squares.size, 24, 'no overlapping melee pieces');
});

test('duel opening has 7 legal quiet moves, all for player 0', () => {
  const s = createGame({ ruleset: 'duel', seed: 1 });
  const acts = legalActions(s);
  assert.equal(acts.length, 7);
  for (const a of acts) {
    assert.equal(s.pieces[a.piece].owner, 0);
    assert.equal(a.captures.length, 0);
  }
});

test('simple move applies, turn passes, ply increments monotonically', () => {
  let s = createGame({ ruleset: 'duel', seed: 1 });
  const a = legalActions(s)[0];
  const s2 = apply(s, a);
  assert.equal(s2.turn, 1);
  assert.equal(s2.ply, 1);
  assert.equal(s.ply, 0, 'original state untouched (purity)');
  const a2 = legalActions(s2)[0];
  const s3 = apply(s2, a2);
  assert.equal(s3.turn, 0);
  assert.equal(s3.ply, 2);
});

test('mandatory capture: quiet moves absent when a capture exists', () => {
  // white man at (2,1) can jump black man at (3,2) to (4,3)
  const s = custom('duel', [p(0, 2, 1), p(1, 3, 2), p(1, 7, 6)]);
  const acts = legalActions(s);
  assert.equal(acts.length, 1);
  assert.equal(acts[0].captures.length, 1);
  assert.deepEqual(acts[0].path, [[4, 3]]);
  const s2 = apply(s, acts[0]);
  assert.equal(s2.pieces[1].captured, true);
  assert.equal(s2.sinceProgress, 0);
});

test('quiet move attempted during a capture is rejected with must-capture', () => {
  const s = custom('duel', [p(0, 2, 1), p(0, 2, 5), p(1, 3, 2), p(1, 7, 6)]);
  const bad = { type: 'move', piece: 1, path: [[3, 4]] };
  const v = validateAction(s, bad);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'must-capture');
});

test('chain jumps: double jump enumerated as a single maximal chain', () => {
  // white at (2,1); black at (3,2) and (5,4); chain (2,1)->(4,3)->(6,5)
  const s = custom('duel', [p(0, 2, 1), p(1, 3, 2), p(1, 5, 4), p(1, 7, 8 - 2)]);
  const acts = legalActions(s);
  assert.equal(acts.length, 1);
  assert.deepEqual(acts[0].path, [[4, 3], [6, 5]]);
  assert.equal(acts[0].captures.length, 2);
  const s2 = apply(s, acts[0]);
  assert.equal(s2.pieces[1].captured, true);
  assert.equal(s2.pieces[2].captured, true);
});

test('incomplete chain rejected with incomplete-chain', () => {
  const s = custom('duel', [p(0, 2, 1), p(1, 3, 2), p(1, 5, 4), p(1, 7, 6)]);
  const v = validateAction(s, { type: 'move', piece: 0, path: [[4, 3]] });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'incomplete-chain');
});

test('promotion: man crowned on the far edge; crowning ends a chain', () => {
  // white man jumps (6,3) onto row 7; without the crowning rule it could
  // continue over (6,5). The chain must stop and crown.
  const s = custom('duel', [p(0, 5, 2), p(1, 6, 3), p(1, 6, 5), p(1, 0, 7, true)]);
  const acts = legalActions(s);
  const crown = acts.find((a) => a.path[0][0] === 7);
  assert.ok(crown, 'a jump onto the crown row exists');
  assert.equal(crown.crowns, true);
  assert.equal(crown.path.length, 1, 'chain stops at crowning despite available continuation');
  const s2 = apply(s, crown);
  assert.equal(s2.pieces[0].crowned, true);
  assert.equal(s2.turn, 1, 'turn passes after crowning mid-chain');
});

test('crowned pieces move and capture backward', () => {
  const s = custom('duel', [p(0, 4, 3, true), p(1, 1, 0)]);
  const acts = legalActions(s);
  const targets = acts.map((a) => a.path[0].join(',')).sort();
  assert.deepEqual(targets, ['3,2', '3,4', '5,2', '5,4']);
});

test('men capture backward too', () => {
  // white man at (3,2) with black behind at (2,1): can jump to (1,0)
  const s = custom('duel', [p(0, 3, 2), p(1, 2, 1), p(1, 7, 6)]);
  const acts = legalActions(s);
  assert.equal(acts.length, 1);
  assert.deepEqual(acts[0].path, [[1, 0]]);
});

test('win by elimination', () => {
  const s = custom('duel', [p(0, 2, 1), p(1, 3, 2)]);
  const s2 = apply(s, legalActions(s)[0]);
  assert.equal(s2.phase, 'over');
  assert.equal(s2.result.winner, 0);
  assert.equal(s2.result.reason, 'elimination');
  assert.deepEqual(legalActions(s2), []);
});

test('win by immobilization', () => {
  // black man at (1,0): only forward square (0,1) is occupied by a white man;
  // landing behind it is off-board, so no capture exists either.
  const s = custom('duel', [p(0, 0, 1), p(0, 4, 3, true), p(1, 1, 0)], 0);
  const mv = legalActions(s).find((a) => a.piece === 1 && a.path[0].join(',') === '3,4');
  assert.ok(mv, 'white crowned piece has a quiet move');
  const s2 = apply(s, mv);
  assert.equal(s2.phase, 'over');
  assert.equal(s2.result.winner, 0);
  assert.equal(s2.result.reason, 'immobilized');
});

test('draw by move limit', () => {
  const s = custom('duel', [p(0, 4, 3, true), p(1, 7, 6, true)]);
  s.sinceProgress = RULESETS.duel.drawPlies - 1;
  const s2 = apply(s, legalActions(s)[0]);
  assert.equal(s2.phase, 'over');
  assert.equal(s2.result.winner, null);
  assert.equal(s2.result.reason, 'move-limit');
});

test('draw by threefold repetition', () => {
  let s = custom('duel', [p(0, 4, 3, true), p(1, 6, 5, true)]);
  // shuffle both kings back and forth; position repeats on the 3rd occurrence
  const findMove = (st, fromR, fromC, toR, toC) => legalActions(st).find((a) => {
    const pc = st.pieces[a.piece];
    return pc.r === fromR && pc.c === fromC && a.path[0][0] === toR && a.path[0][1] === toC;
  });
  let over = false;
  for (let i = 0; i < 2 && !over; i++) {
    for (const [fr, fc, tr, tc] of [[4, 3, 5, 2], [6, 5, 5, 6], [5, 2, 4, 3], [5, 6, 6, 5]]) {
      const mv = findMove(s, fr, fc, tr, tc);
      assert.ok(mv, `cycle move ${fr},${fc}->${tr},${tc}`);
      s = apply(s, mv);
      if (s.phase === 'over') { over = true; break; }
    }
  }
  assert.ok(over, 'repetition detected');
  assert.equal(s.result.reason, 'repetition');
  assert.equal(s.result.winner, null);
});

test('draw offer / accept / decline flow', () => {
  const s0 = createGame({ ruleset: 'duel', seed: 3 });
  assert.equal(validateAction(s0, { type: 'acceptDraw', player: 1 }).reason, 'no-draw-pending');
  const s = apply(s0, { type: 'offerDraw', player: 0 });
  assert.deepEqual(s.pendingDraw, { by: 0 });
  assert.equal(validateAction(s, { type: 'acceptDraw', player: 0 }).reason, 'not-your-turn');
  assert.equal(validateAction(s, { type: 'offerDraw', player: 0 }).reason, 'draw-already-pending');
  const s2 = apply(s, { type: 'declineDraw', player: 1 });
  assert.equal(s2.pendingDraw, null);
  assert.equal(s2.phase, 'active');
  const s3 = apply(apply(s0, { type: 'offerDraw', player: 0 }), { type: 'acceptDraw', player: 1 });
  assert.equal(s3.phase, 'over');
  assert.equal(s3.result.reason, 'agreement');
});

test('timeout eliminates the timed-out player', () => {
  const s = createGame({ ruleset: 'duel', seed: 3 });
  const s2 = apply(s, { type: 'timeout', player: 1 });
  assert.equal(s2.result.winner, 0);
  assert.equal(s2.result.reason, 'timeout');
});

test('invalid action reasons: turn, piece ownership, game over, unknown', () => {
  const s = createGame({ ruleset: 'duel', seed: 3 });
  const blackPiece = s.pieces.find((x) => x.owner === 1);
  assert.equal(validateAction(s, { type: 'move', piece: blackPiece.id, path: [[4, 3]] }).reason, 'not-your-piece');
  assert.equal(validateAction(s, { type: 'move', piece: 999, path: [[4, 3]] }).reason, 'no-piece');
  assert.equal(validateAction(s, { type: 'frob' }).reason, 'unknown-action');
  assert.equal(validateAction(s, null).reason, 'bad-format');
  assert.equal(validateAction(s, { type: 'move', piece: 0, path: [] }).reason, 'bad-format');
  assert.equal(validateAction(s, { type: 'move', piece: 0, path: [['a', 1]] }).reason, 'bad-format');
  const over = apply(s, { type: 'resign', player: 0 });
  assert.equal(validateAction(over, { type: 'move', piece: blackPiece.id, path: [[4, 3]] }).reason, 'game-over');
});

// ---------------------------------------------------------------------------
// Melee (4-player)
// ---------------------------------------------------------------------------
test('melee: side houses move along columns and promote on far column', () => {
  const s = createGame({ ruleset: 'melee', seed: 5 });
  assert.equal(s.turn, 0);
  // player 1 (west house) moves along +c: from col 0/1 to col +1
  const s1 = apply(s, legalActions(s)[0]); // p0
  const acts1 = legalActions(s1, 1);
  assert.ok(acts1.length > 0);
  for (const a of acts1) {
    const pc = s1.pieces[a.piece];
    assert.equal(a.path[0][1], pc.c + 1, 'west house advances columns');
  }
  // west promotion: piece reaching col 9 crowns
  const custom1 = custom('melee', [p(1, 4, 7), p(0, 4, 3), p(2, 8, 3), p(3, 1, 8)], 1);
  const mv = legalActions(custom1).find((a) => a.path[0][1] === 8);
  const s2 = apply(custom1, mv);
  const s3 = apply(s2, legalActions(s2)[0]); // p2
  const s4 = apply(s3, legalActions(s3)[0]); // p3
  const s5 = apply(s4, legalActions(s4)[0]); // p0
  const mv2 = legalActions(s5).find((a) => a.path[0][1] === 9);
  assert.ok(mv2 && mv2.crowns, 'west house crowns on column 9 (j)');
});

test('melee: elimination removes pieces and rotates turn; last house wins', () => {
  // p1 about to be wiped by p0's capture
  const s = custom('melee', [
    p(0, 2, 3), p(1, 3, 4), p(2, 8, 3), p(3, 5, 8),
  ], 0);
  const s2 = apply(s, legalActions(s)[0]); // p0 jumps p1's only piece
  assert.equal(s2.players[1].eliminated, true);
  assert.equal(s2.turn, 2, 'turn skips eliminated house');
  assert.equal(s2.pieces[1].captured, true);
  // resign p2 then p3 → p0 wins
  const s3 = apply(s2, { type: 'resign', player: 2 });
  const s4 = apply(s3, { type: 'resign', player: 3 });
  assert.equal(s4.phase, 'over');
  assert.equal(s4.result.winner, 0);
  assert.equal(s4.result.reason, 'resignation');
  assert.deepEqual(s4.result.eliminated.sort(), [1, 2, 3]);
});

// ---------------------------------------------------------------------------
// Serialization, hashing, undo
// ---------------------------------------------------------------------------
test('serialize/deserialize round-trip preserves hash', () => {
  let s = createGame({ ruleset: 'duel', seed: 42 });
  const rng = createRng(99);
  for (let i = 0; i < 30 && s.phase === 'active'; i++) {
    const acts = legalActions(s);
    s = apply(s, acts[rng.int(acts.length)]);
  }
  const h1 = hashState(s);
  const s2 = deserialize(serialize(s));
  assert.equal(hashState(s2), h1);
  // log and invalids survive
  assert.equal(s2.log.length, s.log.length);
});

test('migrateState upgrades v0 documents', () => {
  const s = createGame({ ruleset: 'duel', seed: 9 });
  const doc = JSON.parse(serialize(s));
  delete doc.rep;
  delete doc.streams;
  delete doc.pendingDraw;
  doc.v = 0;
  const migrated = migrateState(doc);
  assert.equal(migrated.v, 1);
  const restored = deserialize(JSON.stringify(migrated));
  assert.equal(restored.seed, s.seed);
  assert.ok(restored.streams.rules !== undefined);
  assert.throws(() => migrateState({ v: 77 }), /cannot migrate/);
});

test('applyInPlace/undoInPlace restores the exact state hash', () => {
  const s = createGame({ ruleset: 'duel', seed: 11 });
  const h0 = hashState(s);
  const rng = createRng(5);
  const tokens = [];
  let cur = s;
  for (let i = 0; i < 40 && cur.phase === 'active'; i++) {
    const acts = legalActions(cur);
    const a = acts[rng.int(acts.length)];
    const v = validateAction(cur, a);
    tokens.push(applyInPlace(cur, v.resolved));
  }
  while (tokens.length) undoInPlace(cur, tokens.pop());
  assert.equal(hashState(cur), h0);
});

// ---------------------------------------------------------------------------
// Determinism property: same seed + commands → identical hashes
// ---------------------------------------------------------------------------
test('replay determinism: identical command stream reproduces identical hashes', () => {
  const playOut = (seed) => {
    let s = createGame({ ruleset: 'duel', seed });
    const rng = createRng(seed ^ 0xabc);
    const hashes = [hashState(s)];
    const commands = [];
    for (let i = 0; i < 120 && s.phase === 'active'; i++) {
      const acts = legalActions(s);
      const a = acts[rng.int(acts.length)];
      commands.push(a);
      s = apply(s, a);
      hashes.push(hashState(s));
    }
    return { hashes, commands, result: s.result, log: s.log };
  };
  const a = playOut(1234);
  const b = playOut(1234);
  assert.deepEqual(a.hashes, b.hashes);
  assert.deepEqual(a.commands, b.commands);
  // re-apply recorded commands to a fresh game
  let s = createGame({ ruleset: 'duel', seed: 1234 });
  for (const c of a.commands) s = apply(s, c);
  assert.equal(hashState(s), a.hashes[a.hashes.length - 1]);
});

test('fuzz: malformed commands never throw, always a reason string', () => {
  const s = createGame({ ruleset: 'duel', seed: 1 });
  const rng = createRng(0xfeed);
  const garbage = () => {
    const pick = rng.int(6);
    switch (pick) {
      case 0: return { type: 'move', piece: rng.int(40) - 5, path: [[rng.int(12) - 2, rng.int(12) - 2]] };
      case 1: return { type: 'move', piece: rng.int(24), path: [] };
      case 2: return { type: 'move', piece: rng.int(24), path: [[1, 1], [2, 2], [3, 3], [4, 4]] };
      case 3: return { type: 'resign', player: rng.int(5) - 1 };
      case 4: return { type: 'move', piece: 'x', path: null };
      case 5: return { type: ['weird'] };
      default: return 42;
    }
  };
  for (let i = 0; i < 500; i++) {
    const v = validateAction(s, garbage());
    if (!v.ok) assert.equal(typeof v.reason, 'string');
  }
  // a long random game never hangs and always terminates legally
  let g = createGame({ ruleset: 'duel', seed: 777 });
  let guard = 0;
  while (g.phase === 'active' && guard++ < 400) {
    const acts = legalActions(g);
    assert.ok(acts.length > 0, 'active game always has legal actions');
    g = apply(g, acts[rng.int(acts.length)]);
  }
  assert.ok(g.phase === 'over', 'random game terminates within bound');
  assert.ok(g.result.reason, 'terminal reason present');
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
test('score breakdown: integer components, winner beats loser', () => {
  const s = custom('duel', [p(0, 2, 1), p(1, 3, 2)]);
  const s2 = apply(s, legalActions(s)[0]); // p0 captures the last black piece
  const b0 = scoreBreakdown(s2, 0, { par: 20, invalids: 1 });
  const b1 = scoreBreakdown(s2, 1, {});
  assert.equal(b0.outcome, 2);
  assert.equal(b1.outcome, 0);
  assert.equal(b0.components.captures, 100);
  assert.equal(b0.components.objective, 500);
  assert.equal(b0.components.penalties, -5);
  assert.ok(Number.isInteger(b0.total));
  assert.ok(b0.total > b1.total);
  for (const v of Object.values(b0.components)) assert.ok(Number.isInteger(v));
});

test('compareResults implements the documented tie-break chain', () => {
  const base = { outcome: 2, invalids: 0, elapsedMs: 1000, sessionId: 'b' };
  assert.ok(compareResults(base, { ...base, outcome: 1 }) < 0, 'objective first');
  assert.ok(compareResults(base, { ...base, invalids: 2 }) < 0, 'fewer invalids');
  assert.ok(compareResults(base, { ...base, elapsedMs: 2000 }) < 0, 'faster time');
  assert.ok(compareResults(base, { ...base, sessionId: 'a' }) > 0, 'stable session id last');
  assert.equal(compareResults(base, base), 0);
});

test('eloDelta: expected values', () => {
  assert.equal(eloDelta(1000, 1000, 1), 12);
  assert.equal(eloDelta(1000, 1000, 0), -12);
  assert.equal(eloDelta(1000, 1000, 0.5), 0);
  assert.ok(eloDelta(1500, 1000, 0) < -15);
});

test('squareName and describeAction produce readable text', () => {
  assert.equal(squareName(2, 1), 'b3');
  const s = custom('duel', [p(0, 2, 1), p(1, 3, 2)]);
  const text = describeAction(s, legalActions(s)[0]);
  assert.match(text, /capturing/);
});

test('setup validation rejects illegal positions', () => {
  assert.throws(() => custom('duel', [p(0, 0, 0)]), /unplayable/);
  assert.throws(() => custom('duel', [p(0, 2, 1), p(1, 2, 1)]), /share square/);
  assert.throws(() => custom('duel', [p(0, 7, 2)]), /promotion square/);
});
