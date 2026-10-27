// Hosted tables (js/core/hosted.js) over a fake realtime room with the
// surface native/platform.ts's roomsAdapter gives it: the host creates and
// opens a room, a guest quick-joins, the platform's roster seats them, the
// host starts, both play a whole duel through the room's relay (guest frames
// reach only the host, the host's reach everyone, each tagged with the
// sender's participant id), and both see the same result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HostedSessionClient } from '../js/core/hosted.js';
import { legalActions } from '../js/rules/engine.js';

function fakeHub() {
  const room = { id: 'room-1', participants: [], sockets: new Map(), metadata: null, open: false };
  const roster = () => {
    const players = room.participants.map((p) => ({ seat: p.slot, name: p.username, connected: true }));
    const ids = Object.fromEntries(room.participants.map((p) => [p.id, p.slot]));
    for (const s of room.sockets.values()) s.onMessage?.({ control: { type: 'roster', players, ids } });
  };
  const adapter = (userId, username) => {
    let pid = null;
    return {
      slug: 'crown-draughts', hosted: true, online: true,
      async createRoom(config) {
        room.metadata = config.metadata;
        pid = 'p-host';
        room.participants.push({ id: pid, userId, username, slot: 0 });
        return { ok: true, status: 200, data: { roomId: room.id, seat: 0, metadata: room.metadata } };
      },
      async openRoom() { room.open = true; return { ok: true, status: 200 }; },
      async quickJoin() {
        if (!room.open) return { ok: false, status: 404 };
        pid = `p-${userId}`;
        room.participants.push({ id: pid, userId, username, slot: room.participants.length });
        queueMicrotask(roster);
        return { ok: true, status: 200, data: { roomId: room.id, seat: room.participants.length - 1, metadata: room.metadata } };
      },
      async leaveRoom() { return { ok: true, status: 204 }; },
      async submitRoomResult() { return { ok: true, status: 204 }; },
      openRoomSocket(roomId, handlers) {
        room.sockets.set(pid, handlers);
        const me = pid;
        queueMicrotask(() => { handlers.onOpen?.(); roster(); });
        return {
          send(msg) {
            const text = JSON.stringify(msg);
            // A guest's frames reach only the host; the host's reach everyone else.
            for (const [id, s] of room.sockets) {
              if (id === me) continue;
              if (me !== 'p-host' && id !== 'p-host') continue;
              queueMicrotask(() => s.onMessage?.({ from: me, msg: JSON.parse(text) }));
            }
            return true;
          },
          close() { room.sockets.delete(me); },
        };
      },
    };
  };
  return { room, adapter };
}
const settle = () => new Promise((r) => setTimeout(r, 5));

test('a hosted duel plays to its end through the room relay', async () => {
  const hub = fakeHub();
  const made = await HostedSessionClient.create(hub.adapter('u-host', 'host'), { ruleset: 'duel', name: 'Hostess', listed: true, clockMs: null });
  assert.ok(made.ok);
  const host = made.client;
  host.connect();
  const joined = await HostedSessionClient.join(hub.adapter('u-guest', 'guest'), { name: 'Visitor' });
  assert.ok(joined.ok);
  const guest = joined.client;
  assert.equal(guest.seat, 1);
  guest.connect();
  await settle();
  await guest.refresh();
  await settle();
  assert.deepEqual(host.players.map((p) => [p.seat, p.name]), [[0, 'Hostess'], [1, 'Visitor']]);
  let hostOver = null, guestOver = null;
  host.on('over', (o) => { hostOver = o; });
  guest.on('over', (o) => { guestOver = o; });
  const res = await host.startGame();
  assert.ok(res.ok);
  await settle();
  assert.equal(guest.phase, 'active');
  assert.equal(guest.state.ply, 0);
  for (let i = 0; i < 400 && !hostOver; i++) {
    const side = host.state.turn === 0 ? host : guest;
    const acts = legalActions(side.state);
    const r = await side.submit({ ...acts[acts.length - 1] });
    assert.ok(r.ok, `ply ${i}`);
    await settle();
    assert.equal(guest.state.ply, host.state.ply, 'the guest follows the host');
  }
  await settle();
  assert.ok(hostOver, 'the host finished the round');
  assert.ok(guestOver, 'the guest heard the result');
  assert.equal(guestOver.winner, hostOver.winner);
});

test('a guest cannot move for the host: the platform names the sender', async () => {
  const hub = fakeHub();
  const host = (await HostedSessionClient.create(hub.adapter('u-host', 'host'), { ruleset: 'duel', name: 'H', listed: true })).client;
  host.connect();
  const guest = (await HostedSessionClient.join(hub.adapter('u-guest', 'guest'), { name: 'G' })).client;
  guest.connect();
  await settle();
  await host.startGame();
  await settle();
  // The guest claims seat 0 in its payload; the host trusts the platform's sender id (seat 1).
  const act = legalActions(guest.state)[0];
  hub.room.sockets.get('p-host').onMessage({ from: 'p-u-guest', msg: { t: 'input', seat: 0, action: act } });
  await settle();
  assert.equal(host.state.ply, 0, 'the forged move was refused');
});
