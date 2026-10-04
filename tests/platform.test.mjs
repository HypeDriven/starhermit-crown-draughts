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

async function boot(hash) {
  const calls = [];
  const store = { save: null, settings: {} };
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, init });
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/api/v1/users/u-12345678/profile')) return json({ nickname: 'Pip' });
    if (url.includes('/api/v1/me/cloud-saves/')) {
      if (method === 'PUT') { store.save = Buffer.from(JSON.parse(init.body).dataBase64, 'base64'); return new Response(null, { status: 204 }); }
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
  assert.deepEqual(store.controls, { pause: ['KeyO'] });
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
