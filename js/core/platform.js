// Platform adapter: StarHermit host integration when hosted (launch token in
// the URL fragment), clean local fallbacks when standalone.
//
// Token lifecycle: `#game_token=<jwt>` (optional `&session_id=`) is read once
// and stripped from the URL; the JWT's `sub` + `game_scope` (never hard-coded)
// identify the player and this game. Every REST call sends the token as
// `Authorization: Bearer`; it re-mints every 45 min via
// `POST /api/v1/games/{slug}/launch-token` (60 s retry after a failure).
// Hosted mode activates whenever a token exists.
//
// Multiplayer uses realtime rooms (host-routed): `POST /api/v1/realtime/rooms`
// (config: teamCount, seatsPerTeam, metadata, `aiPlayers` for AI seats),
// `POST /rooms/quick-join`, `POST /rooms/{id}/open`, friend invites via
// `GET /api/v1/me/friends` + `POST /rooms/{id}/invites`, `GET /rooms/invites`
// polling, reconnect via `GET /rooms/mine`, results via
// `POST /rooms/{id}/result`, leave via `POST /rooms/{id}/leave`. Transport is
// `ws(s)://<host>/ws/v1/realtime?roomId=<id>&access_token=<token>`: binary
// frames carry a 16-byte sender-participant prefix (stripped on receipt;
// guest→host only, host→everyone), JSON text frames are control messages.
//
// Cloud save is the real platform slot `GET/PUT /api/v1/me/cloud-saves/{slug}`
// (zip+base64, one slot; remote wins on boot; debounced saves with a
// pagehide flush). Presence/telemetry have no launch-token endpoints (wiki)
// and are inert no-ops — calling them would only surface console errors.
// Tokens are kept in memory only — never persisted.

const TELEMETRY_CATEGORIES = new Set(['start', 'tutorial_step', 'round_end', 'retry', 'settings_change', 'error']);
const REFRESH_MS = 45 * 60 * 1000; // token lives 60 min; re-mint at 45
const RETRY_MS = 60 * 1000;
const SAVE_DEBOUNCE_MS = 2000;

// Minimal ZIP writer/reader (stored entries only, no compression).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0);
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
function unzipFirstEntry(zipBytes) {
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export class Platform {
  constructor() {
    this.mode = 'standalone';        // 'hosted' when a launch token was read
    this.launchToken = null;         // memory only
    this.userId = null;              // JWT sub
    this.slug = null;                // JWT game_scope — never hard-coded
    this.profile = null;             // { name } for the signed-in player
    this.sync = 'offline';           // offline | saving | synced (cloud slot)
    this.timeOffsetMs = 0;           // serverNow = Date.now() + offset
    this.timeSyncedAt = 0;
    this.telemetryConsent = false;
    this.telemetryQueue = [];
    this._refreshTimer = null;
    this._retryTimer = null;
    this._saveTimer = null;
    this._pendingSave = null;
    this._profileNames = {};
    this._syncListeners = new Set();
  }

  /** Read the launch token (fragment, stripped), decode sub/game_scope, start
   *  the 45-min refresh, and probe the server clock. Never throws. */
  async init() {
    this.launchToken = this._readLaunchToken();
    if (this.launchToken) {
      const claims = this._decodeJwt(this.launchToken);
      if (!claims) this.launchToken = null;
      else {
        if (typeof claims.sub === 'string' && claims.sub) this.userId = claims.sub;
        if (typeof claims.game_scope === 'string' && claims.game_scope) this.slug = claims.game_scope;
        if (!this.userId || !this.slug) this.launchToken = null; // unusable token
      }
    }
    this.mode = this.launchToken ? 'hosted' : 'standalone';
    if (this.mode === 'hosted') {
      this._scheduleRefresh();
      try {
        globalThis.addEventListener('pagehide', () => this.flushCloudSave());
        globalThis.document?.addEventListener('visibilitychange', () => { if (globalThis.document.hidden) this.flushCloudSave(); });
      } catch { /* no window events available */ }
      this.fetchProfile().catch(() => {});
    }
    await this.syncTime();
    return this.mode;
  }

  get hosted() { return this.mode === 'hosted'; }
  get online() { return this.mode === 'hosted'; } // realtime available

  _readLaunchToken() {
    try {
      const h = new URLSearchParams(String(globalThis.location?.hash || '').replace(/^#/, ''));
      const t = h.get('game_token');
      if (t) {
        h.delete('game_token');
        h.delete('session_id');
        const rest = h.toString();
        globalThis.history?.replaceState(null, '',
          globalThis.location.pathname + globalThis.location.search + (rest ? '#' + rest : ''));
        return t;
      }
      const q = new URLSearchParams(globalThis.location?.search || '');
      return q.get('game_token') || q.get('token') || q.get('launch_token') || null;
    } catch {
      return null;
    }
  }

  _decodeJwt(t) {
    try {
      const seg = String(t).split('.')[1];
      if (!seg) return null;
      let b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
      b64 += '='.repeat((4 - (b64.length % 4)) % 4);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  }

  /* Token refresh: scoped tokens may re-mint via the game's launch-token
   * route. Retry a failed re-mint after ~60 s. */
  _scheduleRefresh() {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    this._refreshTimer = setInterval(() => this.refreshToken(), REFRESH_MS);
  }
  async refreshToken() {
    if (!this.launchToken || !this.slug) return false;
    try {
      const res = await fetch(`/api/v1/games/${encodeURIComponent(this.slug)}/launch-token`, {
        method: 'POST', headers: this.headers(), body: '{}',
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && typeof data.token === 'string' && data.token) {
        this.launchToken = data.token; // memory only
        const claims = this._decodeJwt(this.launchToken);
        if (claims && claims.sub) this.userId = claims.sub;
        if (claims && claims.game_scope) this.slug = claims.game_scope;
        return true;
      }
    } catch { /* fall through to retry */ }
    if (!this._retryTimer) {
      this._retryTimer = setTimeout(() => { this._retryTimer = null; this.refreshToken(); }, RETRY_MS);
    }
    return false;
  }

  /* Identity: the profile nickname is the only profile read a game-scoped
   * token may make. Never /api/v1/me, never usernames. Cached per id. */
  profileFor(userId) {
    if (!userId || typeof userId !== 'string') return Promise.resolve('player');
    if (this._profileNames[userId]) return this._profileNames[userId];
    const p = fetch(`/api/v1/users/${encodeURIComponent(userId)}/profile`, { headers: this.headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && typeof j.nickname === 'string' && j.nickname ? j.nickname : null))
      .then((n) => n || ('Player ' + userId.slice(0, 8)))
      .catch(() => 'Player ' + userId.slice(0, 8));
    this._profileNames[userId] = p;
    return p;
  }

  async fetchProfile() {
    if (!this.userId) return null;
    const name = (await this.profileFor(this.userId)).slice(0, 40);
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

  /** Server-synchronized now (round-trip adjusted). */
  serverNow() { return Date.now() + this.timeOffsetMs; }

  async syncTime() {
    try {
      const t0 = Date.now();
      const res = await fetch('/api/v1/time', { headers: this.headers() });
      const t1 = Date.now();
      if (!res.ok) return false;
      const body = await res.json();
      const serverMs = Number(body.epochMs ?? body.serverTime ?? body.now);
      if (!Number.isFinite(serverMs)) return false;
      const rtt = t1 - t0;
      this.timeOffsetMs = (serverMs + rtt / 2) - t1;
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
   * REST call with retries, rate-limit respect, and structured error mapping.
   * Returns { ok, status, data?, error? } — never throws.
   */
  async api(path, { method = 'GET', body = null, retries = 2 } = {}) {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      let res;
      try {
        res = await fetch(path, {
          method,
          headers: this.headers(),
          body: body ? JSON.stringify(body) : null,
        });
      } catch (e) {
        if (attempt > retries) return { ok: false, status: 0, error: 'network' };
        await sleep(300 * attempt);
        continue;
      }
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after')) || 1;
        if (attempt > retries + 1) return { ok: false, status: 429, error: 'rate-limited' };
        await sleep(Math.min(retryAfter, 8) * 1000);
        continue;
      }
      let data = null;
      try { data = await res.json(); } catch { /* empty body */ }
      if (!res.ok) {
        return { ok: false, status: res.status, error: data?.error || `http-${res.status}`, data };
      }
      return { ok: true, status: res.status, data };
    }
  }

  /* Cloud save: ONE zip+base64 slot at /api/v1/me/cloud-saves/{slug} for the
   * progress document. Remote wins on boot; saves debounce ~2 s and flush on
   * pagehide/hidden with keepalive. Returns the raw doc JSON string or null. */
  async loadCloudSave() {
    if (!this.hosted || !this.slug) return null;
    try {
      const res = await fetch(`/api/v1/me/cloud-saves/${encodeURIComponent(this.slug)}`, { headers: this.headers() });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`http-${res.status}`);
      const buf = await res.arrayBuffer();
      if (!buf || !buf.byteLength) return null;
      return new TextDecoder().decode(unzipFirstEntry(new Uint8Array(buf)));
    } catch {
      return null;
    }
  }

  writeCloudSave(docJson) {
    if (!this.hosted || !this.slug) return;
    this._pendingSave = docJson;
    this._setSync('saving');
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flushCloudSave(), SAVE_DEBOUNCE_MS);
  }

  async flushCloudSave() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (!this.hosted || !this.slug || this._pendingSave == null) return false;
    const docJson = this._pendingSave;
    this._pendingSave = null;
    let body;
    try {
      body = { dataBase64: bytesToBase64(zipStore('save.json', new TextEncoder().encode(docJson))) };
    } catch {
      return false;
    }
    try {
      const res = await fetch(`/api/v1/me/cloud-saves/${encodeURIComponent(this.slug)}`, {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify(body),
        keepalive: true,
      });
      if (res.ok) { this._setSync('synced'); return true; }
      this._pendingSave = this._pendingSave == null ? docJson : this._pendingSave;
      this._setSync('offline');
      return false;
    } catch {
      this._pendingSave = this._pendingSave == null ? docJson : this._pendingSave;
      this._setSync('offline');
      return false;
    }
  }

  /* Realtime rooms (host-routed multiplayer). */

  /** Create a room. config: { teamCount, seatsPerTeam, metadata, aiPlayers }. */
  createRoom(config) {
    return this.api('/api/v1/realtime/rooms', { method: 'POST', body: config });
  }
  /** Join any open room for this game (404 = none open). */
  quickJoin() {
    return this.api('/api/v1/realtime/rooms/quick-join', { method: 'POST', body: { gameSlug: this.slug, seats: 1 } });
  }
  /** Host: mark the room open so quick-join can find it. */
  openRoom(roomId) {
    return this.api(`/api/v1/realtime/rooms/${encodeURIComponent(roomId)}/open`, { method: 'POST', body: {} });
  }
  /** Host: invite a friend (userId from listFriends). */
  inviteToRoom(roomId, userId) {
    return this.api(`/api/v1/realtime/rooms/${encodeURIComponent(roomId)}/invites`, { method: 'POST', body: { userId } });
  }
  listFriends() {
    return this.api('/api/v1/me/friends');
  }
  /** Poll incoming invites (for the guest side). */
  pollInvites() {
    return this.api('/api/v1/realtime/rooms/invites');
  }
  /** Reconnect: my rooms. */
  myRooms() {
    return this.api('/api/v1/realtime/rooms/mine');
  }
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
   * binary frame (≤ 8 KB). Returns { send, close }.
   */
  openRoomSocket(roomId, { onMessage, onOpen, onClose } = {}) {
    const proto = globalThis.location?.protocol === 'https:' ? 'wss:' : 'ws:';
    const qs = new URLSearchParams({ roomId });
    if (this.launchToken) qs.set('access_token', this.launchToken);
    const ws = new WebSocket(`${proto}//${globalThis.location.host}/ws/v1/realtime?${qs.toString()}`);
    ws.binaryType = 'arraybuffer';
    const PREFIX_LEN = 16;
    ws.onopen = () => { try { onOpen?.(); } catch { /* ok */ } };
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
    ws.onclose = (ev) => { try { onClose?.(ev); } catch { /* ok */ } };
    ws.onerror = () => { /* surfaced via onclose */ };
    return {
      send(msg) {
        try {
          const data = new TextEncoder().encode(JSON.stringify(msg));
          if (data.length > 8192) return false; // 8 KB per-frame cap
          if (ws.readyState === 1) { ws.send(data); return true; }
          return false;
        } catch {
          return false;
        }
      },
      close() { try { ws.close(); } catch { /* ok */ } },
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
