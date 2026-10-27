// Hosted tables (js/core/hosted.js) end to end over tests/fake-platform.mjs:
// realtime rooms for the lobby and server.js, run as the platform runs it, as
// the referee of the room-bound session. The host creates and opens a room, a
// guest quick-joins, the full room starts by itself, both play a whole duel
// over the game socket, and the script — never a client — decides and records
// the result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HostedSessionClient } from '../js/core/hosted.js';
import { legalActions } from '../js/rules/engine.js';
import { fakePlatform } from './fake-platform.mjs';

const settle = () => new Promise((r) => setTimeout(r, 2));

async function duel() {
  const hub = fakePlatform();
  const made = await HostedSessionClient.create(hub.adapter('u-host', 'host'), { ruleset: 'duel', name: 'Hostess', listed: true, clockMs: null });
  assert.ok(made.ok);
  const host = made.client;
  host.connect();
  await settle();
  assert.equal(host.phase, 'lobby');
  const joined = await HostedSessionClient.join(hub.adapter('u-guest', 'guest'), { name: 'Visitor' });
  assert.ok(joined.ok);
  const guest = joined.client;
  guest.connect();
  for (let i = 0; i < 10; i++) await settle();
  return { hub, host, guest };
}

test('a hosted duel plays to its end and the script records the result', async () => {
  const { hub, host, guest } = await duel();
  assert.equal(hub.room.status, 'playing', 'the full room started by itself');
  assert.ok(host.sessionId && guest.sessionId === host.sessionId);
  assert.equal(host.phase, 'active');
  assert.equal(guest.phase, 'active');
  assert.equal(host.seat, 0);
  assert.equal(guest.seat, 1);
  assert.deepEqual(guest.players.map((p) => p.name), ['host', 'guest']);
  let hostOver = null, guestOver = null, remote = 0;
  host.on('over', (o) => { hostOver = o; });
  guest.on('over', (o) => { guestOver = o; });
  guest.on('action', (ev) => { if (ev.remote) remote++; });
  let plies = 0;
  for (let i = 0; i < 400 && !hostOver; i++) {
    const side = host.state.turn === 0 ? host : guest;
    const acts = legalActions(side.state);
    const r = await side.submit({ ...acts[acts.length - 1] });
    assert.ok(r.ok, `ply ${i}`);
    plies++;
    for (let k = 0; k < 4; k++) await settle();
    assert.equal(guest.state.ply, host.state.ply, 'both follow the script');
  }
  await settle();
  assert.ok(hostOver && guestOver, 'both heard the ending');
  assert.equal(guestOver.winner, hostOver.winner);
  assert.ok(hostOver.recorded);
  assert.ok(remote > 0 && remote <= plies, 'the host\'s moves arrive as remote actions');
  const result = hub.room.result;
  assert.ok(result, 'the script returned the result (the room closes with it)');
  assert.equal(result.winner, hostOver.winner);
  assert.equal(result.plies, plies);
  if (result.winner !== null) {
    const w = result.winner === 0 ? 'u-host' : 'u-guest';
    assert.equal(hub.room.session.scores[0]['hosted-wins'][w], 1);
  }
});

test('the script refuses what the client would not send: out of turn, forged seat, forged result', async () => {
  const { hub, guest } = await duel();
  const invalid = [];
  guest.on('invalid', (e) => invalid.push(e.reason));
  // Locally checked first: it is the host's turn.
  const act = legalActions(guest.state)[0];
  assert.equal((await guest.submit({ ...act })).ok, false);
  assert.deepEqual(invalid, ['not-your-turn']);
  // Straight onto the socket, claiming the host's seat and a result.
  // (the platform attaches the sender id; seats and players in the payload mean nothing).
  const send = (data) => hub.room.session.send('u-guest', data);
  assert.equal(send({ type: 'act', seat: 0, player: 0, action: { type: 'move', piece: act.piece, path: act.path } }).ok, false);
  assert.equal(send({ type: 'result', winner: 1, scores: { 'hosted-wins': 99 } }).ok, false);
  assert.equal(hub.room.session.state.game.ply, 0);
  assert.equal(hub.room.result, null);
});

test('an underfilled table: the host starts it and the script plays the empty seats', async () => {
  const hub = fakePlatform();
  const host = (await HostedSessionClient.create(hub.adapter('u-host', 'host'), { ruleset: 'melee', name: 'H', listed: false })).client;
  host.connect();
  await settle();
  const res = await host.startGame();
  assert.ok(res.ok);
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(host.phase, 'active');
  assert.deepEqual(host.players.map((p) => p.ai), [false, true, true, true]);
  const acts = legalActions(host.state);
  assert.ok((await host.submit({ ...acts[0] })).ok);
  await settle(); await settle();
  let aiMoves = 0;
  host.on('action', (ev) => { if (ev.remote) aiMoves++; });
  for (let i = 0; i < 3; i++) { hub.tick(1000); await settle(); await settle(); }
  assert.equal(aiMoves, 3, 'three AI houses moved, one per tick');
  assert.equal(host.state.turn, 0);
});

test('a guest who leaves mid-round forfeits it', async () => {
  const { hub, host, guest } = await duel();
  let over = null;
  host.on('over', (o) => { over = o; });
  guest.leave();
  await settle();
  hub.tick(1000);
  for (let i = 0; i < 4; i++) await settle();
  assert.ok(over);
  assert.equal(over.winner, 0);
  assert.equal(over.reason, 'resignation');
});

test('a room that starts without the script\'s session is unavailable, never played host-side', async () => {
  const hub = fakePlatform();
  const host = (await HostedSessionClient.create(hub.adapter('u-host', 'host'), { ruleset: 'duel', name: 'H', listed: false })).client;
  host.connect();
  await settle();
  hub.room.session = null;
  const adapter = host.platform;
  adapter.startRoom = async () => { hub.room.status = 'playing'; return { ok: true, status: 200, data: { gameSessionId: null } }; };
  let unavailable = null;
  host.on('unavailable', (code) => { unavailable = code; });
  const res = await host.startGame();
  assert.equal(res.ok, false);
  assert.equal(unavailable, 'no-session');
  assert.equal(host.phase, 'lobby');
  assert.equal(host.state, null);
});
