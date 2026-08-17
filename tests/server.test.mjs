import test from 'node:test';
import assert from 'node:assert/strict';
import { startDevServer } from '../server.js';
import { verifyReplay } from '../js/core/session.js';
import { legalActions } from '../js/rules/engine.js';

let server;
let base;

test.before(async () => {
  server = await startDevServer({ port: 0, dataFile: '/tmp/cd-test-data.json', quiet: true });
  base = `http://localhost:${server.port}`;
});

test.after(async () => { await server.close(); });

async function api(path, { method = 'GET', body = null, token = null } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : null,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

test('ping and time endpoints', async () => {
  const ping = await api('/api/v1/ping');
  assert.equal(ping.data.ok, true);
  const time = await api('/api/v1/time');
  assert.ok(Math.abs(time.data.epochMs - Date.now()) < 5000);
});

test('static index.html is served', async () => {
  const res = await fetch(base + '/index.html');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Crown Draughts/);
});

test('full hosted duel: create, join, play, reject bad actors, replay verifies', async () => {
  // create (host = seat 0)
  const created = await api('/api/v1/sessions', { method: 'POST', body: { ruleset: 'duel', playerName: 'Host', listed: true } });
  assert.ok(created.data.ok);
  const { sessionId, joinCode, playerToken: hostToken } = created.data;
  assert.equal(created.data.seat, 0);

  // public listing shows it
  const list = await api('/api/v1/sessions');
  assert.ok(list.data.sessions.some((s) => s.id === sessionId));

  // second player joins by code
  const joined = await api(`/api/v1/sessions/${sessionId}/join`, { method: 'POST', body: { name: 'Guest', joinCode } });
  assert.ok(joined.data.ok);
  const guestToken = joined.data.playerToken;
  assert.equal(joined.data.seat, 1);

  // wrong code rejected
  const bad = await api(`/api/v1/sessions/${sessionId}/join`, { method: 'POST', body: { name: 'X', joinCode: 'ZZZZZZ' } });
  assert.equal(bad.status, 400);

  // non-host cannot start
  const noStart = await api(`/api/v1/sessions/${sessionId}/start`, { method: 'POST', token: guestToken });
  assert.equal(noStart.status, 400);
  // host starts
  const started = await api(`/api/v1/sessions/${sessionId}/start`, { method: 'POST', token: hostToken });
  assert.ok(started.data.ok);

  // snapshot: source of truth
  let snap = await api(`/api/v1/sessions/${sessionId}`, { token: hostToken });
  assert.equal(snap.status, 200);
  assert.equal(snap.data.you, 0);
  assert.equal(snap.data.phase, 'active');
  assert.equal(snap.data.state.turn, 0);

  // guest cannot move (not their turn / not their seat)
  let st = snap.data.state;
  const whiteMove = legalActions(st)[0];
  const outOfTurn = await api(`/api/v1/sessions/${sessionId}/commands`, {
    method: 'POST', token: guestToken,
    body: { commandId: 'c-bad', action: whiteMove },
  });
  assert.equal(outOfTurn.status, 400);
  assert.match(outOfTurn.data.error, /not-your/);

  // malformed command rejected
  const malformed = await api(`/api/v1/sessions/${sessionId}/commands`, {
    method: 'POST', token: hostToken,
    body: { commandId: 'c-mal', action: { type: 'move', piece: 999, path: [[0, 0]] } },
  });
  assert.equal(malformed.status, 400);

  // host moves
  const ok1 = await api(`/api/v1/sessions/${sessionId}/commands`, {
    method: 'POST', token: hostToken,
    body: { commandId: 'c-1', action: whiteMove },
  });
  assert.ok(ok1.data.ok);

  // duplicate command id → idempotent ok, no double-apply
  const dup = await api(`/api/v1/sessions/${sessionId}/commands`, {
    method: 'POST', token: hostToken,
    body: { commandId: 'c-1', action: whiteMove },
  });
  assert.ok(dup.data.ok);
  assert.equal(dup.data.duplicate, true);
  snap = await api(`/api/v1/sessions/${sessionId}`, { token: guestToken });
  assert.equal(snap.data.state.ply, 1, 'duplicate did not advance the game');

  // guest moves
  const blackMove = legalActions(snap.data.state)[0];
  const ok2 = await api(`/api/v1/sessions/${sessionId}/commands`, {
    method: 'POST', token: guestToken,
    body: { commandId: 'c-2', action: blackMove },
  });
  assert.ok(ok2.data.ok);

  // chat: works, rate-limited at 10/min
  const chat1 = await api(`/api/v1/sessions/${sessionId}/chat`, { method: 'POST', token: hostToken, body: { text: 'Good luck!' } });
  assert.ok(chat1.data.ok);
  let lastChat = null;
  for (let i = 0; i < 12; i++) {
    lastChat = await api(`/api/v1/sessions/${sessionId}/chat`, { method: 'POST', token: hostToken, body: { text: `msg ${i}` } });
  }
  assert.equal(lastChat.status, 400);
  assert.equal(lastChat.data.error, 'rate-limited');

  // report hook
  const rep = await api(`/api/v1/sessions/${sessionId}/report`, { method: 'POST', token: guestToken, body: { playerSeat: 0, reason: 'spam' } });
  assert.ok(rep.data.ok);

  // resign: host resigns on their turn → guest wins
  const resign = await api(`/api/v1/sessions/${sessionId}/commands`, {
    method: 'POST', token: hostToken,
    body: { commandId: 'c-3', action: { type: 'resign', player: 0 } },
  });
  assert.ok(resign.data.ok);
  assert.ok(resign.data.over);
  assert.equal(resign.data.over.winner, 1);
  assert.ok(resign.data.over.ratingChanges, 'server-authoritative rating change present');

  // game over: further commands rejected
  const after = await api(`/api/v1/sessions/${sessionId}/commands`, {
    method: 'POST', token: guestToken,
    body: { commandId: 'c-4', action: { type: 'resign', player: 1 } },
  });
  assert.equal(after.status, 400);

  // replay verifies end-to-end
  const replay = await api(`/api/v1/sessions/${sessionId}/replay`, { token: guestToken });
  assert.ok(replay.data.ok);
  const check = verifyReplay(replay.data.data);
  assert.ok(check.ok, `replay verifies: ${check.reason || ''}`);
  assert.equal(check.result.winner, 1);
});

test('reconnect: snapshot after several plies matches and carries chat', async () => {
  const created = await api('/api/v1/sessions', { method: 'POST', body: { ruleset: 'duel', playerName: 'A', listed: false } });
  const { sessionId, joinCode, playerToken: ta } = created.data;
  const joined = await api(`/api/v1/sessions/${sessionId}/join`, { method: 'POST', body: { name: 'B', joinCode } });
  const tb = joined.data.playerToken;
  await api(`/api/v1/sessions/${sessionId}/start`, { method: 'POST', token: ta });
  let snap = await api(`/api/v1/sessions/${sessionId}`, { token: ta });
  for (let i = 0; i < 6; i++) {
    const mover = snap.data.state.turn === 0 ? ta : tb;
    const mv = legalActions(snap.data.state)[0];
    const r = await api(`/api/v1/sessions/${sessionId}/commands`, {
      method: 'POST', token: mover,
      body: { commandId: `r-${i}`, action: mv },
    });
    assert.ok(r.data.ok);
    snap = await api(`/api/v1/sessions/${sessionId}`, { token: mover });
  }
  assert.equal(snap.data.state.ply, 6);
  await api(`/api/v1/sessions/${sessionId}/chat`, { method: 'POST', token: ta, body: { text: 'hello again' } });
  const recon = await api(`/api/v1/sessions/${sessionId}`, { token: tb });
  assert.equal(recon.data.state.ply, 6);
  assert.equal(recon.data.chat[recon.data.chat.length - 1].text, 'hello again');
  assert.equal(recon.data.you, 1);
});

test('not-a-member rejected from private session', async () => {
  const created = await api('/api/v1/sessions', { method: 'POST', body: { ruleset: 'duel', playerName: 'Solo' } });
  const { sessionId } = created.data;
  const snap = await api(`/api/v1/sessions/${sessionId}`, { token: 'bogus-token' });
  assert.equal(snap.status, 403);
  assert.equal(snap.data.error, 'not-a-member');
});
