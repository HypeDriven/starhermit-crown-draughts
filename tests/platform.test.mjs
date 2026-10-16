// Crown Draughts — StarHermit adapter unit tests (node --test).
// Loads starhermit-sdk.js (classic script) and the js/core/platform.js module
// against a stubbed window, fetch and launch hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SDK_SRC = readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8');
const SLUG = 'crown-draughts';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64u({ alg: 'none' })}.${b64u({ sub: 'u-12345678', game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
// Clear the SDK's renewal timer so the test process can exit.
test.afterEach(() => { globalThis.StarHermit?.signOut(); });

async function boot(hash, { renew } = {}) {
  const calls = [];
  const store = { save: null, settings: {}, version: 0, etag: null };
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, init });
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/api/v1/users/u-12345678/profile')) return json({ nickname: 'Pip' });
    if (url.includes('/api/v1/me/cloud-saves/')) {
      // Conditional writes: the SDK sends If-Match with the ETag it last saw;
      // a newer save from "another device" (store.etag bumped) answers 412.
      if (url.endsWith('/info')) return json({ exists: !!store.save, etag: store.etag || null });
      if (method === 'PUT') {
        const ifMatch = init.headers?.['If-Match'];
        if (ifMatch && ifMatch !== store.etag) return new Response(JSON.stringify({ error: 'precondition_failed', etag: store.etag }), { status: 412, headers: { 'Content-Type': 'application/json' } });
        store.save = Buffer.from(JSON.parse(init.body).dataBase64, 'base64');
        store.etag = '"v' + (++store.version) + '"';
        return json({ etag: store.etag });
      }
      return store.save ? new Response(store.save, { status: 200 }) : new Response('', { status: 404 });
    }
    if (url.endsWith(`/api/v1/games/${SLUG}/settings`)) {
      if (method === 'PATCH') Object.assign(store.settings, JSON.parse(init.body).settings);
      return json({ settings: store.settings });
    }
    if (url.endsWith(`/api/v1/games/${SLUG}/controls`)) {
      if (method === 'PUT') { store.controls = JSON.parse(init.body).bindings; return json({ ok: true }); }
      return json({ actions: [{ action: 'hint', codes: ['F2'] }] });
    }
    if (url.endsWith('/api/v1/realtime/rooms') && method === 'POST') { store.room = JSON.parse(init.body); return json({ roomId: 'r1' }); }
    if (url.endsWith('/api/v1/realtime/rooms/quick-join')) return new Response('', { status: 404 });
    if (url.endsWith('/api/v1/realtime/rooms/r1/invites')) { store.invite = JSON.parse(init.body); return json({ id: 'i1' }); }
    if (url.endsWith('/api/v1/me/friends')) return json([{ userId: 'u-12345678', online: true }]);
    if (url.endsWith('/api/v1/time')) return json({ now: 1234 });
    if (renew && url.endsWith(`/api/v1/games/${SLUG}/launch-token`) && method === 'POST') return renew();
    return new Response('', { status: 404 });
  };
  const location = { hash, search: '', pathname: '/', hostname: 'localhost', href: 'http://localhost/' + hash, origin: 'http://localhost' };
  globalThis.window = {
    location,
    history: { state: null, replaceState(_s, _t, url) { const i = url.indexOf('#'); location.hash = i >= 0 ? url.slice(i) : ''; } },
    addEventListener() {},
  };
  globalThis.document = { hidden: false, addEventListener() {} };
  vm.runInThisContext(SDK_SRC);               // defines globalThis.StarHermit
  window.StarHermit = globalThis.StarHermit;
  const { Platform } = await import('../js/core/platform.js');
  return { P: new Platform(), calls, store };
}

test('launch token: read from the fragment, stripped, slug from claims', async () => {
  const { P } = await boot('#game_token=' + JWT + '&session_id=s1');
  assert.equal(await P.init(), 'hosted');
  assert.equal(P.slug, SLUG);
  assert.equal(P.userId, 'u-12345678');
  assert.equal(window.location.hash, '');
  assert.equal(P.headers().authorization, 'Bearer ' + JWT);
});

test('profile name comes from the profile nickname', async () => {
  const { P } = await boot('#game_token=' + JWT);
  await P.init();
  assert.deepEqual(await P.fetchProfile(), { name: 'Pip' });
});

test('cloud save round-trips through /api/v1/me/cloud-saves/game:<slug>', async () => {
  const { P, calls } = await boot('#game_token=' + JWT);
  await P.init();
  const doc = JSON.stringify({ v: 1, id: 'a', payload: { journey: {} } });
  P.writeCloudSave(doc);
  assert.equal(P.sync, 'saving');
  assert.equal(await P.flushCloudSave(true), true);
  const put = calls.find((c) => c.method === 'PUT');
  assert.ok(put.url.endsWith('/api/v1/me/cloud-saves/' + encodeURIComponent('game:' + SLUG)), put.url);
  assert.equal(put.init.keepalive, true);
  assert.equal(P.sync, 'synced');
  assert.equal(await P.loadCloudSave(), doc);
});

test('settings patch, controls and invite link', async () => {
  const { P, calls, store } = await boot('#game_token=' + JWT);
  await P.init();
  await Promise.all([P.patchSettings({ theme: 'winter' }), P.patchSettings({ audio: { music: 0.1 } })]);
  assert.deepEqual(store.settings, { theme: 'winter', audio: { music: 0.1 } });
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 1, 'patches are debounced into one');
  assert.deepEqual(await P.loadBindings({ hint: ['KeyH'], pause: ['KeyP'] }), { hint: ['F2'], pause: ['KeyP'] });
  assert.equal(await P.setControl('pause', ['KeyO']), true);
  // The SDK re-reads the stored bindings and writes the full set back.
  assert.deepEqual(store.controls, { hint: ['F2'], pause: ['KeyO'] });
  assert.match(P.inviteLink(), /game-invite\/u-12345678\/crown-draughts$/);
});

test('realtime rooms go through StarHermit.realtime', async () => {
  const { P, store } = await boot('#game_token=' + JWT);
  await P.init();
  const r = await P.createRoom({ teamCount: 1, seatsPerTeam: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.data.roomId, 'r1');
  assert.equal(store.room.gameSlug, SLUG);
  const q = await P.quickJoin();
  assert.equal(q.ok, false);
  assert.equal(q.status, 404);
  const f = await P.listFriends();
  assert.deepEqual(f.data, [{ userId: 'u-12345678', online: true, name: 'Pip' }]);
  assert.equal((await P.inviteToRoom('r1', 'u-2')).ok, true);
  assert.deepEqual(store.invite, { toUserId: 'u-2' });
  assert.match(globalThis.StarHermit.realtime.socketUrl('r1'), /^ws:\/\/localhost\/ws\/v1\/realtime\?roomId=r1&access_token=/);
});

test('standalone: no token means no fetch at all', async () => {
  const { P, calls } = await boot('');
  assert.equal(await P.init(), 'standalone');
  assert.equal(P.canSignIn(), false);
  assert.equal(P.inviteLink(), null);
  assert.equal(await P.fetchProfile(), null);
  assert.equal(await P.loadCloudSave(), null);
  P.writeCloudSave('{"v":1}');
  await P.flushCloudSave(true);
  await P.patchSettings({ a: 1 });
  assert.deepEqual(await P.getSettings(), {});
  assert.deepEqual(await P.loadBindings({ pause: ['KeyP'] }), { pause: ['KeyP'] });
  assert.equal((await P.createRoom({})).ok, false);
  assert.equal(await P.syncTime(), false);
  assert.deepEqual(P.headers(), { 'content-type': 'application/json' });
  assert.equal(calls.length, 0);
});

// Realtime reconnect: a refused handshake (expired token) closes as 1006 just
// like a network drop, so every reconnect renews the launch token first and
// rebuilds the URL from the current token.
const JWT2 = `${b64u({ alg: 'none' })}.${b64u({ sub: 'u-12345678', game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 7200, n: 2 })}.sig`;
async function bootSockets(renewals) {
  const renewCalls = [];
  const env = await boot('#game_token=' + JWT, {
    renew() {
      const r = renewals[renewCalls.length] || 'ok';
      renewCalls.push(r);
      if (r === 'ok') return new Response(JSON.stringify({ token: JWT2 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (r === 'terms') return new Response(JSON.stringify({ error: 'terms_acceptance_required' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      return new Response('', { status: r === 'refused' ? 401 : 503 });
    },
  });
  const sockets = [];
  globalThis.WebSocket = class { constructor(url) { this.url = url; this.readyState = 0; sockets.push(this); } send() {} close() { this.readyState = 3; } };
  await env.P.init();
  return { ...env, sockets, renewCalls };
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const drop = (ws) => { ws.readyState = 3; ws.onclose({ code: 1006 }); };

test('reconnect renews the token first and opens with the new one', async (t) => {
  const { P, sockets, renewCalls } = await bootSockets(['ok']);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sock = P.openRoomSocket('r1', {});
  assert.equal(sockets.length, 1);
  assert.equal(renewCalls.length, 0, 'first connect needs no renewal');
  assert.match(sockets[0].url, new RegExp('access_token=' + JWT.replace(/\./g, '\\.')));
  drop(sockets[0]);
  t.mock.timers.tick(1000);
  await settle();
  assert.deepEqual(renewCalls, ['ok']);
  assert.equal(sockets.length, 2);
  assert.match(sockets[1].url, new RegExp('access_token=' + JWT2.replace(/\./g, '\\.')));
  sock.close();
});

test("reconnect on 'retry' backs off without reopening the old URL", async (t) => {
  const { P, sockets, renewCalls } = await bootSockets(['down', 'ok']);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sock = P.openRoomSocket('r1', {});
  drop(sockets[0]);
  t.mock.timers.tick(1000);
  await settle();
  assert.deepEqual(renewCalls, ['down']);
  assert.equal(sockets.length, 1, 'no socket reopened on retry');
  t.mock.timers.tick(2000); // backoff doubled
  await settle();
  assert.deepEqual(renewCalls, ['down', 'ok']);
  assert.equal(sockets.length, 2);
  assert.ok(sockets[1].url.includes(JWT2));
  sock.close();
});

test("reconnect on 'relaunch' stops and surfaces the session-expired UI", async (t) => {
  const { P, sockets, renewCalls } = await bootSockets(['refused']);
  const { HostedSessionClient } = await import('../js/core/hosted.js');
  const reasons = [];
  P.onAuth((signedIn, reason) => reasons.push([signedIn, reason]));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new HostedSessionClient(P, { roomId: 'r1', seat: 0 });
  let authLost = 0;
  client.on('authLost', () => authLost++);
  client.connect();
  drop(sockets[0]);
  t.mock.timers.tick(1000);
  await settle();
  assert.deepEqual(renewCalls, ['refused']);
  assert.equal(authLost, 1, 'hosted client tells the app (which shows "Back to StarHermit")');
  assert.deepEqual(reasons, [[false, 'expired']], 'app hears the expired sign-out');
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(sockets.length, 1, 'never reconnects after relaunch');
  assert.equal(renewCalls.length, 1);
});

test("reconnect on 'terms-required' stops like auth loss and asks for StarHermit", async (t) => {
  const { P, sockets, renewCalls } = await bootSockets(['terms']);
  const { HostedSessionClient } = await import('../js/core/hosted.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new HostedSessionClient(P, { roomId: 'r1', seat: 0 });
  let terms = 0, authLost = 0;
  client.on('termsRequired', () => terms++);
  client.on('authLost', () => authLost++);
  client.connect();
  drop(sockets[0]);
  t.mock.timers.tick(1000);
  await settle();
  assert.deepEqual(renewCalls, ['terms']);
  assert.equal(terms, 1, 'the app shows the terms dialog with "Back to StarHermit"');
  assert.equal(authLost, 0);
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(sockets.length, 1, 'the reconnect loop has ended');
});

test('a room that is gone (4404) ends the reconnect loop with a visible notice', async (t) => {
  const { P, sockets, renewCalls } = await bootSockets([]);
  const { HostedSessionClient } = await import('../js/core/hosted.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new HostedSessionClient(P, { roomId: 'r1', seat: 0 });
  const codes = [];
  client.on('unavailable', (code) => codes.push(code));
  client.connect();
  sockets[0].readyState = 3; sockets[0].onclose({ code: 4404 });
  t.mock.timers.tick(60000);
  await settle();
  assert.deepEqual(codes, [4404]);
  assert.equal(sockets.length, 1);
  assert.equal(renewCalls.length, 0);
});

test('a lost cloud write (412) is reported as a save conflict', async () => {
  const { P, store } = await boot('#game_token=' + JWT);
  await P.init();
  let conflicts = 0;
  P.onSaveConflict(() => conflicts++);
  assert.equal(await P.loadCloudSave(), null);
  P.writeCloudSave(JSON.stringify({ v: 1, id: 'a', payload: {} }));
  assert.equal(await P.flushCloudSave(true), true);
  store.etag = '"elsewhere"'; // another device saved since
  P.writeCloudSave(JSON.stringify({ v: 1, id: 'b', payload: {} }));
  assert.equal(await P.flushCloudSave(true), false);
  assert.equal(conflicts, 1);
  assert.equal(P.saveConflicted(), true);
  await P.loadCloudSave();
  assert.equal(P.saveConflicted(), false, 'reloading lifts the block');
});

test('mergeProgress keeps the better side of every record', async () => {
  const { mergeProgress } = await import('../js/core/progress.js');
  const remote = {
    journey: { 'ch1-s1': { completed: true, stars: 2, bestPlies: 40, plays: 3 } },
    lessonsComplete: ['first-steps'], achievements: ['first_completion'], masteryClaimed: [5],
    challenges: { thin: { completed: true, bestScore: 900 } },
    daily: { '2026-10-10': { completed: true, won: true, score: 700, excluded: false } },
    stats: { roundsCompleted: 9, wins: 4, dailyStreak: 3, bestDailyStreak: 3, lastDailyDate: '2026-10-10', bestChain: 2 },
  };
  const local = {
    journey: { 'ch1-s1': { completed: false, stars: 0, bestPlies: null, plays: 5 }, 'ch1-s2': { completed: true, stars: 1, bestPlies: 20, plays: 1 } },
    lessonsComplete: ['taking'], achievements: ['first_crown'], masteryClaimed: [],
    challenges: { thin: { completed: false, bestScore: 0 }, blitz: { completed: true, bestScore: 300 } },
    daily: { '2026-10-09': { completed: true, won: false, score: 100, excluded: false } },
    stats: { roundsCompleted: 12, wins: 3, dailyStreak: 0, bestDailyStreak: 5, lastDailyDate: '2026-10-09', bestChain: 4 },
  };
  const m = mergeProgress(remote, local);
  assert.deepEqual(m.journey['ch1-s1'], { completed: true, stars: 2, bestPlies: 40, plays: 5 });
  assert.equal(m.journey['ch1-s2'].completed, true);
  assert.deepEqual(m.lessonsComplete.sort(), ['first-steps', 'taking']);
  assert.deepEqual(m.achievements.sort(), ['first_completion', 'first_crown']);
  assert.deepEqual(m.masteryClaimed, [5]);
  assert.deepEqual(m.challenges.thin, { completed: true, bestScore: 900 });
  assert.equal(m.challenges.blitz.bestScore, 300);
  assert.deepEqual(Object.keys(m.daily).sort(), ['2026-10-09', '2026-10-10']);
  assert.equal(m.stats.roundsCompleted, 12);
  assert.equal(m.stats.wins, 4);
  assert.equal(m.stats.bestChain, 4);
  assert.equal(m.stats.lastDailyDate, '2026-10-10');
  assert.equal(m.stats.dailyStreak, 3, 'streak follows the later daily');
  assert.equal(m.stats.bestDailyStreak, 5);
});

test('session-expired and terms strings exist in every locale', async () => {
  const { PLATFORM_STRINGS } = await import('../js/ui/platform-i18n.js');
  for (const [loc, T] of Object.entries(PLATFORM_STRINGS)) {
    for (const k of ['expiredTitle', 'expiredBody', 'termsTitle', 'termsBody', 'relaunch', 'keepPlaying', 'relaunchFailed']) assert.ok(T[k], `${loc}.${k}`);
  }
});

test('relaunch goes through StarHermit.relaunch', async () => {
  const { P } = await boot('#game_token=' + JWT);
  await P.init();
  let called = 0;
  globalThis.StarHermit.relaunch = () => { called++; return true; };
  assert.equal(P.relaunch(), true);
  assert.equal(called, 1);
});
