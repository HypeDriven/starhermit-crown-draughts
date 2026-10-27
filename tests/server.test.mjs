// server.js, the game's authoritative script, run as the platform runs it
// (tests/fake-platform.mjs: a fresh context per invocation, JSON in and out):
// it referees a hosted duel from the room's roster to its recorded result,
// rejects illegal, out-of-turn, forged and unseated commands and any
// client-sent result, plays empty seats, forfeits leavers, keeps the turn
// deadline, and still posts solo totals for practice sessions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ScriptSession, declarations } from './fake-platform.mjs';
import { legalActions, scoreBreakdown } from '../js/rules/engine.js';
import { replayTable } from '../js/core/hosted.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';

function table({ ruleset = 'duel', humans = [A, B], metadata = {}, playerStates = {} } = {}) {
  const roster = humans.map((id, i) => ({ userId: id, name: `P${i}`, team: 0, slot: i, ai: false }));
  const s = new ScriptSession({
    players: humans.map((id, i) => ({ id, name: `P${i}` })),
    room: { roomId: 'room-1', metadata: { ruleset, ...metadata }, roster },
    playerStates,
  });
  const out = s.create();
  assert.ok(out.ok, 'createSession');
  return s;
}
const game = (s) => s.state.game;
const seatUser = (s, seat) => s.state.seats[seat].userId;
const moveOf = (a) => ({ type: 'move', piece: a.piece, path: a.path });

test('the RULES block is the current js/rules and the boards match leaderboards.json', () => {
  execFileSync(process.execPath, ['tools/build-server.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' });
  const boards = JSON.parse(readFileSync(ROOT + 'leaderboards.json', 'utf8'));
  const d = declarations();
  assert.deepEqual(d.BOARDS, boards);
  assert.equal(d.tickRateHz, 1);
  const manifest = readFileSync(ROOT + 'starhermit.txt', 'utf8');
  assert.match(manifest, /^server=server\.js$/m);
});

test('a hosted duel is refereed to its end and the script records the result', () => {
  const s = table({ playerStates: { [A]: { elo: 1300, hostedWins: 4 } } });
  assert.equal(s.state.mode, 'table');
  assert.deepEqual(s.state.seats.map((x) => [x.userId, x.ai]), [[A, false], [B, false]]);
  const first = s.last(A);
  assert.equal(first.ply, 0);
  assert.deepEqual(s.last(B), first, 'both players hear the table');
  let plies = 0;
  while (!s.result) {
    const g = game(s);
    const acts = legalActions(g);
    const out = s.send(seatUser(s, g.turn), { type: 'act', action: moveOf(acts[acts.length - 1]) });
    assert.ok(out.ok, `ply ${plies}: ${out.error}`);
    plies++;
    assert.ok(plies < 400);
  }
  const g = game(s);
  assert.equal(g.phase, 'over');
  const r = s.result;
  assert.equal(r.kind, g.result.winner === null ? 'draw' : 'win');
  assert.equal(r.winner, g.result.winner);
  assert.equal(r.reason, g.result.reason);
  assert.equal(r.plies, plies);
  assert.equal(r.ranked, true);
  assert.deepEqual(r.seats.map((x) => x.userId), [A, B]);
  // The clients' last table carries the ending, and replaying its log gives the same game.
  const t = s.last(B);
  assert.ok(t.over && t.over.recorded);
  assert.equal(t.over.winner, r.winner);
  const replay = replayTable(t);
  assert.equal(replay.ply, g.ply);
  assert.deepEqual(replay.result.winner, g.result.winner);
  assert.equal(t.over.breakdowns[0].total, scoreBreakdown(g, 0, { elapsedMs: r.elapsedMs }).total);
  // Ratings and the hosted-wins board.
  const elo = s.eloUpdates[0];
  assert.ok(elo && typeof elo[A] === 'number' && typeof elo[B] === 'number');
  if (r.winner !== null) {
    const w = seatUser(s, r.winner), l = seatUser(s, 1 - r.winner);
    assert.ok(elo[w] > (w === A ? 1300 : 1200) && elo[l] < (l === A ? 1300 : 1200));
    assert.deepEqual(Object.keys(s.scores[0]), ['hosted-wins']);
    assert.equal(s.scores[0]['hosted-wins'][w], w === A ? 5 : 1);
    assert.equal(s.playerStates[l].hostedLosses, 1);
  }
  // A finished round takes no more commands.
  assert.equal(s.send(A, { type: 'act', action: { type: 'resign' } }).ok, false);
});

test('illegal, out-of-turn, forged and unseated commands are rejected', () => {
  const s = table();
  const g = game(s);
  assert.equal(g.turn, 0);
  const mover = seatUser(s, 0), other = seatUser(s, 1);
  const legal = legalActions(g);
  const reject = (from, data, reason) => {
    const before = JSON.stringify(s.state);
    const out = s.send(from, data);
    assert.equal(out.ok, false, JSON.stringify(data));
    if (reason) assert.equal(out.error, reason);
    assert.equal(JSON.stringify(s.state), before, 'state unchanged');
  };
  // Not the sender's turn, even naming the mover's seat or piece.
  reject(other, { type: 'act', action: moveOf(legal[0]) }, 'not-your-turn');
  reject(other, { type: 'act', action: { ...moveOf(legal[0]), player: 0, seat: 0 } }, 'not-your-turn');
  // An opponent's piece.
  const theirs = g.pieces.find((p) => p.owner === 1 && !p.captured);
  reject(mover, { type: 'act', action: { type: 'move', piece: theirs.id, path: [[theirs.r - 1, theirs.c - 1]] } });
  // A square it cannot reach, a malformed path, a missing action.
  const mine = legal[0];
  reject(mover, { type: 'act', action: { type: 'move', piece: mine.piece, path: [[mine.path[0][0] + 2, mine.path[0][1]]] } });
  reject(mover, { type: 'act', action: { type: 'move', piece: mine.piece, path: 'e3' } }, 'bad-format');
  reject(mover, { type: 'act' }, 'bad-format');
  // Clients cannot claim the clock, an unknown action, or the result.
  reject(other, { type: 'act', action: { type: 'timeout', player: 0 } }, 'unknown-action');
  reject(mover, { type: 'act', action: { type: 'win' } }, 'unknown-action');
  reject(mover, { type: 'result', scores: { 'high-score': 20000, 'hosted-wins': 999 } }, 'unknown-command');
  reject(mover, { type: 'over', winner: 0 }, 'unknown-command');
  // Someone not seated at the table.
  reject(C, { type: 'act', action: moveOf(legal[0]) }, 'not-seated');
  reject(C, { type: 'chat', text: 'hi' }, 'not-seated');
  // Answering a draw no one offered.
  reject(other, { type: 'act', action: { type: 'acceptDraw' } }, 'no-draw-pending');
  assert.equal(s.result, null);
  assert.equal(s.scores.length, 0);
  // A forged `player` does not resign someone else: the sender's own seat resigns.
  const out = s.send(mover, { type: 'act', action: { type: 'resign', player: 1 } });
  assert.ok(out.ok);
  assert.equal(s.result.winner, 1);
  assert.equal(s.result.reason, 'resignation');
  assert.equal(s.result.winnerUserId, other);
});

test('chat is attributed by the platform, trimmed and capped', () => {
  const s = table();
  assert.ok(s.send(B, { type: 'chat', text: `  ${'x'.repeat(300)}\n` }).ok);
  const m = s.last(A, 'chat');
  assert.equal(m.seat, 1);
  assert.equal(m.name, 'P1');
  assert.equal(m.text.length, 200);
  assert.equal(s.send(B, { type: 'chat', text: '   ' }).ok, false);
});

test('sync answers only the sender', () => {
  const s = table();
  s.inbox.clear();
  assert.ok(s.send(B, { type: 'sync' }).ok);
  assert.ok(s.last(B));
  assert.equal(s.last(A), null);
});

test('empty seats are played by the script on its tick; a lone human is unranked', () => {
  const s = table({ ruleset: 'melee', humans: [A] });
  assert.deepEqual(s.state.seats.map((x) => x.ai), [false, true, true, true]);
  for (let i = 0; i < 2000 && !s.result; i++) {
    const g = game(s);
    if (s.state.seats[g.turn].ai) { s.tick(1000); continue; }
    const acts = legalActions(g);
    assert.ok(s.send(A, { type: 'act', action: moveOf(acts[0]) }).ok);
  }
  assert.ok(s.result, 'the melee ended');
  assert.equal(s.result.ranked, false);
  assert.equal(s.scores.length, 0);
  assert.equal(s.eloUpdates.length, 0);
});

test('the AI waits for its delay and answers a draw offer at once', () => {
  const s = table({ humans: [A] });
  assert.equal(game(s).turn, 0);
  assert.ok(s.send(A, { type: 'act', action: moveOf(legalActions(game(s))[0]) }).ok);
  assert.equal(game(s).ply, 1);
  s.tick(100);
  assert.equal(game(s).ply, 1, 'not before its delay');
  s.tick(1000);
  assert.equal(game(s).ply, 2, 'the AI moved');
  assert.ok(s.send(A, { type: 'act', action: { type: 'offerDraw' } }).ok);
  const g = game(s);
  assert.equal(g.pendingDraw, null, 'answered');
  assert.ok(['accept', 'decline'].includes(g.log[g.log.length - 1].t));
});

test('a player who leaves the room forfeits; everyone leaving abandons the round', () => {
  const s = table();
  s.presence[B].left = true;
  s.tick(1000);
  assert.equal(s.result.winner, 0);
  assert.equal(s.result.reason, 'resignation');
  assert.equal(s.result.seats[1].left, true);
  assert.ok(s.scores[0]['hosted-wins'][A] >= 1);

  const t = table();
  t.presence[A].left = true;
  t.presence[B].left = true;
  t.tick(1000);
  assert.equal(t.result.kind, 'abandoned');
  assert.equal(t.result.ranked, false);
  assert.equal(t.scores.length, 0);
  assert.equal(t.eloUpdates.length, 0);
});

test('the turn deadline times out the player to move (clamped to at least 30 s)', () => {
  const s = table({ metadata: { turnDeadlineMs: 5 } });
  assert.equal(s.state.deadlineMs, 30000);
  assert.equal(s.last(A).deadlineAt, s.now + 30000);
  s.tick(29000);
  assert.equal(s.result, null);
  s.tick(1000);
  assert.equal(s.result.reason, 'timeout');
  assert.equal(s.result.winner, 1);
  const none = table();
  none.tick(3_600_000);
  assert.equal(none.result, null, 'no deadline without one in the metadata');
});

test('an unknown ruleset falls back to the duel; roster order seats the houses', () => {
  const s = table({ ruleset: 'chess', humans: [B, A] });
  assert.equal(s.state.ruleset, 'duel');
  assert.deepEqual(s.state.seats.map((x) => x.userId), [B, A]);
});

test('practice sessions post a range-checked solo total (and nothing else)', () => {
  const s = new ScriptSession({ players: [{ id: A, name: 'P' }, { id: 'ai', name: 'House', ai: true }] });
  assert.ok(s.create().ok);
  assert.equal(s.state.mode, 'score');
  const out = s.send(A, { type: 'result', scores: { 'high-score': 2020, 'hosted-wins': 50 } });
  assert.ok(out.ok);
  assert.deepEqual(s.scores[0], { 'high-score': { [A]: 2020 } });
  assert.deepEqual(s.last(A, 'result-ack').accepted, ['high-score']);
  assert.ok(s.result);
  for (const bad of [-1, 20001, 12.5, '900', null]) {
    const t = new ScriptSession({ players: [{ id: A, name: 'P' }] });
    t.create();
    t.send(A, { type: 'result', scores: { 'high-score': bad } });
    assert.deepEqual(t.scores[0], {}, `refused ${bad}`);
  }
  const u = new ScriptSession({ players: [{ id: A, name: 'P' }] });
  u.create();
  assert.equal(u.send(A, { type: 'act', action: { type: 'resign' } }).ok, false);
});
