// Platform adapter: StarHermit host integration when signed in, clean local
// fallbacks when standalone. A thin layer over window.StarHermit
// (starhermit-sdk.js, loaded as a classic script before the app module),
// which reads the launch token (`#game_token=` / `#access_token=`), strips it,
// renews it, and makes every API call; this class keeps the game's API.
//
// Multiplayer uses realtime rooms (host-routed) through `StarHermit.realtime`:
// create (config: teamCount, seatsPerTeam, metadata, `aiPlayers`), quick-join,
// open, friend invites (`StarHermit.friends()` + `realtime.invite`), incoming
// room invites (`GET /rooms/invites`, `realtime.acceptInvite`), reconnect via
// `GET /rooms/mine`, results via `POST /rooms/{id}/result`, leave via
// `POST /rooms/{id}/leave`. Transport is `realtime.socketUrl(roomId)` (reconnects
// renew the token first; see openRoomSocket): binary
// frames carry a 16-byte sender-participant prefix (stripped on receipt;
// guest→host only, host→everyone), JSON text frames are control messages.
//
// Cloud save is the SDK slot `/api/v1/me/cloud-saves/game:<slug>` (remote
// wins on boot; debounced saves with a pagehide flush). Preferences mirror to
// the settings KV; key bindings to the platform controls. Presence/telemetry
// have no launch-token endpoints (wiki) and are inert no-ops. Standalone makes
// no network calls at all.

const TELEMETRY_CATEGORIES = new Set(['start', 'tutorial_step', 'round_end', 'retry', 'settings_change', 'error']);
const SAVE_DEBOUNCE_MS = 2000;
const PATCH_DEBOUNCE_MS = 400;
const sdk = () => globalThis.StarHermit || null;

export class Platform {
  constructor() {
    this.mode = 'standalone';        // 'hosted' while signed in
    this.profile = null;             // { name } for the signed-in player
    this.sync = 'offline';           // offline | saving | synced (cloud slot)
    this.cloudReady = false;         // set by the app once the start-up cloud load/compare is done
    this.timeOffsetMs = 0;           // serverNow = Date.now() + offset
    this.timeSyncedAt = 0;
    this.telemetryConsent = false;
    this.telemetryQueue = [];
    this._syncListeners = new Set();
    this._authListeners = new Set();
    this._started = false;
    this._patch = null;
    this._patchTimer = null;
    this._patchWaiters = [];
  }

  /** Read the launch token via StarHermit.init(), wire renewal/sign-out and
   *  the pagehide flush, and (signed in) probe the server clock. Never throws. */
  async init() {
    const s = sdk();
    if (!s) return this.mode;
    if (!this._started) {
      this._started = true;
      try { s.init(); } catch { /* malformed launch: stay standalone */ }
      s.on('saved', (ok) => { if (this.hosted) this._setSync(ok ? 'synced' : 'offline'); });
      s.on('auth', (a) => {
        const was = this.hosted;
        this.mode = a && a.signedIn && s.slug ? 'hosted' : 'standalone';
        if (!this.hosted) { this.profile = null; this._setSync('offline'); }
        const reason = (a && a.reason) || null; // 'expired' once renewal is refused
        if (was !== this.hosted) for (const fn of this._authListeners) { try { fn(this.hosted, reason); } catch { /* ok */ } }
      });
      try {
        globalThis.addEventListener?.('pagehide', () => this.flushCloudSave(true));
        globalThis.document?.addEventListener('visibilitychange', () => { if (globalThis.document.hidden) this.flushCloudSave(true); });
      } catch { /* no window events available */ }
    }
    this.mode = s.signedIn && s.slug ? 'hosted' : 'standalone';
    if (this.hosted) {
      this.fetchProfile().catch(() => {});
      await this.syncTime();
    }
    return this.mode;
  }

  get hosted() { return this.mode === 'hosted'; }
  get online() { return this.mode === 'hosted'; } // realtime available
  get userId() { return sdk()?.userId || null; }
  get slug() { return sdk()?.slug || null; }
  get launchToken() { return sdk()?.token || null; }

  onAuth(fn) { if (typeof fn === 'function') this._authListeners.add(fn); }
  canSignIn() { return !!sdk()?.canSignIn(); }
  signIn() { return !!sdk()?.signIn(); }
  inviteLink() { return this.hosted ? sdk()?.inviteLink() || null : null; }
  /** Back to the launcher (or sign-in) for a fresh token. Call from a click. */
  relaunch() { return !!sdk()?.relaunch(); }

  async refreshToken() { const s = sdk(); return s ? !!(await s.refresh()) : false; }

  /* Identity: the profile nickname (SDK: nickname, then "Player <id>"). */
  profileFor(userId) {
    const s = sdk();
    if (!s || !this.hosted || !userId) return Promise.resolve('player');
    return s.profile(String(userId)).then((p) => (p ? p.displayName : 'Player ' + String(userId).slice(0, 6)));
  }

  async fetchProfile() {
    if (!this.hosted) return null;
    const name = String(await this.profileFor(this.userId)).slice(0, 40);
    this.profile = { name };
    return this.profile;
  }

  onSync(fn) { if (typeof fn === 'function') this._syncListeners.add(fn); }
  _setSync(state) {
    if (this.sync === state) return;
    this.sync = state;
    for (const fn of this._syncListeners) {
      try { fn(state); } catch { /* listener errors never break the adapter */ }
    }
  }

  /** Server-synchronized now (round-trip adjusted; local clock standalone). */
  serverNow() { return Date.now() + this.timeOffsetMs; }

  async syncTime() {
    if (!this.hosted) return false;
    try {
      const t0 = Date.now();
      const body = await sdk().api('/api/v1/time');
      const t1 = Date.now();
      const serverMs = Number(body?.epochMs ?? body?.serverTime ?? body?.now);
      if (!Number.isFinite(serverMs)) return false;
      this.timeOffsetMs = (serverMs + (t1 - t0) / 2) - t1;
      this.timeSyncedAt = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  headers(extra = {}) {
    const h = { 'content-type': 'application/json', ...extra };
    if (this.launchToken) h.authorization = `Bearer ${this.launchToken}`;
    return h;
  }

  /**
   * Authenticated REST call through StarHermit.api with retries on network
   * errors and 429. Returns { ok, status, data?, error? } — never throws.
   */
  async api(path, { method = 'GET', body, retries = 2 } = {}) {
    const s = sdk();
    if (!s || !this.hosted) return { ok: false, status: 0, error: 'standalone' };
    for (let attempt = 1; ; attempt++) {
      try {
        const data = await s.api(path, { method, body: body == null ? undefined : body });
        return { ok: true, status: data == null ? 204 : 200, data };
      } catch (e) {
        const status = e && typeof e.status === 'number' ? e.status : 0;
        if ((status === 0 || status === 429) && attempt <= retries) { await sleep(status === 429 ? 1000 * attempt : 300 * attempt); continue; }
        return { ok: false, status, error: status ? (e.message || `http-${status}`) : 'network', data: e && e.body };
      }
    }
  }

  /* Cloud save: the SDK's slot at /api/v1/me/cloud-saves/game:<slug> holds the
   * progress document. Returns the raw doc JSON string or null. */
  async loadCloudSave() {
    const s = sdk();
    if (!s || !this.hosted) return null;
    try {
      const obj = await s.loadJSON();
      if (this.sync === 'offline') this._setSync('synced');
      return obj ? JSON.stringify(obj) : null;
    } catch {
      return null;
    }
  }

  writeCloudSave(docJson) {
    const s = sdk();
    if (!s || !this.hosted) return;
    try { s.saveJSON(JSON.parse(docJson), SAVE_DEBOUNCE_MS); } catch { return; }
    this._setSync('saving');
  }

  async flushCloudSave(keepalive) {
    const s = sdk();
    if (!s || !this.hosted) return false;
    return s.flushSave(keepalive === true);
  }

  /* Settings KV (player preferences), debounced merge. */
  getSettings() {
    const s = sdk();
    return s && this.hosted ? s.getSettings().catch(() => ({})) : Promise.resolve({});
  }
  patchSettings(obj) {
    const s = sdk();
    if (!s || !this.hosted) return Promise.resolve(null);
    this._patch = Object.assign(this._patch || {}, obj);
    if (this._patchTimer) clearTimeout(this._patchTimer);
    return new Promise((resolve) => {
      this._patchWaiters.push(resolve);
      this._patchTimer = setTimeout(() => {
        const body = this._patch, waiters = this._patchWaiters;
        this._patch = null; this._patchTimer = null; this._patchWaiters = [];
        const done = (v) => waiters.forEach((w) => w(v));
        s.patchSettings(body).then(done, () => done(null));
      }, PATCH_DEBOUNCE_MS);
    });
  }

  /* Key bindings (platform controls from starhermit.txt control.* lines). */
  loadBindings(defaults) {
    const copy = () => Object.fromEntries(Object.entries(defaults || {}).map(([k, v]) => [k, v.slice()]));
    const s = sdk();
    if (!s || !this.hosted) return Promise.resolve(copy());
    return s.loadBindings(defaults).catch(copy);
  }
  setControl(action, codes) {
    const s = sdk();
    return s && this.hosted ? s.setControl(action, codes).then(() => true, () => false) : Promise.resolve(false);
  }
  resetControls() {
    const s = sdk();
    return s && this.hosted ? s.resetControls().then(() => true, () => false) : Promise.resolve(false);
  }

  /* Realtime rooms (host-routed multiplayer) via StarHermit.realtime. */

  _rt(fn) {
    const s = sdk();
    if (!s || !this.hosted) return Promise.resolve({ ok: false, status: 0, error: 'standalone' });
    return fn(s.realtime).then((data) => ({ ok: true, status: data == null ? 204 : 200, data }),
      (e) => ({ ok: false, status: e?.status || 0, error: e?.message || 'network' }));
  }
  /** Create a room. config: { teamCount, seatsPerTeam, metadata, aiPlayers }. */
  createRoom(config) { return this._rt((rt) => rt.createRoom(config)); }
  /** Join any open room for this game (404 = none open). */
  async quickJoin() {
    const r = await this._rt((rt) => rt.quickJoin({ seats: 1 }));
    return r.ok && r.data == null ? { ok: false, status: 404, error: 'not-found' } : r; // SDK maps 404 to null
  }
  /** Host: mark the room open so quick-join can find it. */
  openRoom(roomId) { return this._rt((rt) => rt.open(roomId)); }
  /** Host: invite a friend (userId from listFriends). */
  inviteToRoom(roomId, userId) { return this._rt((rt) => rt.invite(roomId, userId)); }
  /** Accept an incoming room invite; resolves like quickJoin. */
  acceptRoomInvite(inviteId) { return this._rt((rt) => rt.acceptInvite(inviteId)); }
  /** [{ userId, username, online, currentGame }] with nicknames. */
  async listFriends() {
    const s = sdk();
    if (!s || !this.hosted) return { ok: false, status: 0, error: 'standalone', data: [] };
    const list = await s.friends();
    const data = await Promise.all((Array.isArray(list) ? list : list?.items || []).map(async (f) => ({
      ...f, name: await this.profileFor(f.userId || f.id),
    })));
    return { ok: true, status: 200, data };
  }
  /** Poll incoming invites (for the guest side). */
  pollInvites() { return this.api('/api/v1/realtime/rooms/invites', { retries: 0 }); }
  /** Reconnect: my rooms. */
  myRooms() { return this.api('/api/v1/realtime/rooms/mine'); }
  leaveRoom(roomId) {
    return this.api(`/api/v1/realtime/rooms/${encodeURIComponent(roomId)}/leave`, { method: 'POST', body: {} });
  }
  submitRoomResult(roomId, result) {
    return this.api(`/api/v1/realtime/rooms/${encodeURIComponent(roomId)}/result`, { method: 'POST', body: { result } });
  }

  /**
   * Open the realtime room socket. Binary frames carry a 16-byte sender
   * participant prefix (stripped here; guest→host only, host→everyone); text
   * frames are JSON control messages from the server. send(msg) emits a JSON
   * binary frame (≤ 8 KB). An unexpected close reconnects with backoff
   * (1 s doubling to 30 s); every reconnect first renews the launch token
   * (StarHermit.renewForReconnect) and rebuilds the URL from the current token,
   * because a refused handshake looks like a plain drop (1006). 'retry' backs
   * off and renews again; 'relaunch' stops for good and calls onAuthLost().
   * Returns { send, close }.
   */
  openRoomSocket(roomId, { onMessage, onOpen, onClose, onAuthLost } = {}) {
    const s = sdk();
    const PREFIX_LEN = 16;
    let ws = null, closed = false, delay = 1000, timer = null;
    const later = (fn) => { timer = setTimeout(fn, delay); delay = Math.min(delay * 2, 30000); };
    const reconnect = () => {
      timer = null;
      if (closed) return;
      Promise.resolve(s.renewForReconnect()).then((r) => {
        if (closed) return;
        if (r === 'renewed') open();
        else if (r === 'retry') later(reconnect);
        else { closed = true; try { onAuthLost?.(); } catch { /* ok */ } }
      }, () => { if (!closed) later(reconnect); });
    };
    const open = () => {
      ws = new WebSocket(s.realtime.socketUrl(roomId)); // reads the current token
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { delay = 1000; try { onOpen?.(); } catch { /* ok */ } };
      ws.onmessage = (ev) => {
        try {
          if (typeof ev.data === 'string') {
            onMessage?.({ control: JSON.parse(ev.data) });
            return;
          }
          const bytes = new Uint8Array(ev.data);
          // Strip the 16-byte sender participant prefix, then parse JSON.
          const msg = JSON.parse(new TextDecoder().decode(bytes.slice(PREFIX_LEN)));
          onMessage?.({ from: bytes.slice(0, PREFIX_LEN), msg });
        } catch { /* ignore malformed frames */ }
      };
      ws.onclose = (ev) => {
        try { onClose?.(ev); } catch { /* ok */ }
        const code = ev && ev.code;
        if (closed || code === 1000 || code === 4403 || code === 4404) return;
        later(reconnect);
      };
      ws.onerror = () => { /* surfaced via onclose */ };
    };
    open(); // first connect: the launch token is fresh, no renewal needed
    return {
      send(msg) {
        try {
          const data = new TextEncoder().encode(JSON.stringify(msg));
          if (data.length > 8192) return false; // 8 KB per-frame cap
          if (ws && ws.readyState === 1) { ws.send(data); return true; }
          return false;
        } catch {
          return false;
        }
      },
      close() {
        closed = true;
        if (timer) { clearTimeout(timer); timer = null; }
        try { ws?.close(1000); } catch { /* ok */ }
      },
    };
  }

  /* Presence and telemetry: no per-game endpoints exist for launch tokens
   * (wiki); these remain inert no-ops so callers need no changes. */

  startPresence() { /* no hosted presence endpoint */ }
  stopPresence() { /* no hosted presence endpoint */ }
  setTelemetryConsent(v) {
    this.telemetryConsent = !!v;
    if (!v) this.telemetryQueue.length = 0;
  }
  track(category, props = {}) {
    if (!TELEMETRY_CATEGORIES.has(category)) return;
    if (!this.telemetryConsent) return;
    // Intentionally not transmitted: no client telemetry endpoint exists.
  }
  async flushTelemetry() { this.telemetryQueue.length = 0; }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export const platform = new Platform();
// storage.js mirrors cloud-save writes through this global (no import cycle).
globalThis.CBPlatform = platform;
