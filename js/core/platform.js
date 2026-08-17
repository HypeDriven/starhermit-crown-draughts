// Platform adapter: StarHermit host integration when hosted; clean local
// fallbacks when standalone. Handles server-time sync, token-aware REST with
// retries and rate-limit handling, presence heartbeats, telemetry consent,
// and hosted-session transport (SSE + REST source of truth).

const TELEMETRY_CATEGORIES = new Set(['start', 'tutorial_step', 'round_end', 'retry', 'settings_change', 'error']);

export class Platform {
  constructor() {
    this.mode = 'standalone';        // 'standalone' | 'hosted' | 'dev'
    this.baseUrl = '';
    this.launchToken = null;
    this.accountToken = null;
    this.timeOffsetMs = 0;           // serverNow = Date.now() + offset
    this.timeSyncedAt = 0;
    this.telemetryConsent = false;
    this.telemetryQueue = [];
    this._presenceTimer = null;
    this._listeners = new Set();
  }

  /** Detect host environment. Awaits a ping; never throws. */
  async init() {
    const params = new URLSearchParams(globalThis.location?.search || '');
    this.launchToken = params.get('launch_token') || null;
    if (globalThis.__STARHERMIT__) {
      this.mode = 'hosted';
      this.accountToken = globalThis.__STARHERMIT__.accountToken || null;
    }
    // Same-origin API detection (hosted or dev server)
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch('/api/v1/ping', { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.ok) {
          if (this.mode !== 'hosted') this.mode = 'dev';
          this.baseUrl = '';
          await this.syncTime();
        }
      }
    } catch {
      /* standalone — no API reachable */
    }
    return this.mode;
  }

  get online() { return this.mode === 'hosted' || this.mode === 'dev'; }

  /** Server-synchronized now (round-trip adjusted). */
  serverNow() { return Date.now() + this.timeOffsetMs; }

  async syncTime() {
    try {
      const t0 = Date.now();
      const res = await fetch('/api/v1/time');
      const t1 = Date.now();
      if (!res.ok) return false;
      const body = await res.json();
      const rtt = t1 - t0;
      this.timeOffsetMs = (body.epochMs + rtt / 2) - t1;
      this.timeSyncedAt = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  headers(extra = {}) {
    const h = { 'content-type': 'application/json', ...extra };
    if (this.accountToken) h.authorization = `Bearer ${this.accountToken}`;
    if (this.launchToken) h['x-launch-token'] = this.launchToken;
    return h;
  }

  /**
   * REST call with retries, rate-limit respect, and structured error mapping.
   * Returns { ok, status, data?, error? } — never throws.
   */
  async api(path, { method = 'GET', body = null, token = null, retries = 2 } = {}) {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      let res;
      try {
        res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: this.headers(token ? { authorization: `Bearer ${token}` } : {}),
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

  // --- presence ----------------------------------------------------------------

  startPresence(activity = 'playing') {
    if (!this.online || this._presenceTimer) return;
    const beat = () => this.api('/api/v1/presence', { method: 'POST', body: { activity, at: this.serverNow() }, retries: 0 });
    beat();
    this._presenceTimer = setInterval(beat, 45000);
  }

  stopPresence() {
    if (this._presenceTimer) clearInterval(this._presenceTimer);
    this._presenceTimer = null;
    if (this.online) this.api('/api/v1/presence', { method: 'POST', body: { activity: 'idle' }, retries: 0 });
  }

  // --- telemetry (consent-gated, category-only) -----------------------------------

  setTelemetryConsent(v) {
    this.telemetryConsent = !!v;
    if (!v) this.telemetryQueue.length = 0;
  }

  /** Anonymous funnel event: category + coarse properties only. */
  track(category, props = {}) {
    if (!TELEMETRY_CATEGORIES.has(category)) return;
    if (!this.telemetryConsent) return;
    const clean = {};
    for (const [k, v] of Object.entries(props)) {
      if (typeof v === 'number' || typeof v === 'boolean') clean[k] = v;
      else if (typeof v === 'string' && v.length <= 40 && /^(mode|ruleset|category|tier|reason|screen)/.test(k)) clean[k] = v;
    }
    const event = { category, props: clean, at: new Date(this.serverNow()).toISOString(), session: anonSessionId() };
    this.telemetryQueue.push(event);
    if (this.telemetryQueue.length >= 8) this.flushTelemetry();
  }

  async flushTelemetry() {
    if (!this.telemetryQueue.length) return;
    const batch = this.telemetryQueue.splice(0, this.telemetryQueue.length);
    if (!this.online) return; // kept local only when offline; nothing is sent
    await this.api('/api/v1/telemetry', { method: 'POST', body: { events: batch }, retries: 1 });
  }

  // --- hosted sessions --------------------------------------------------------------

  async createHostedSession(opts) {
    return this.api('/api/v1/sessions', { method: 'POST', body: opts });
  }
  async joinHostedSession(sessionId, opts) {
    return this.api(`/api/v1/sessions/${encodeURIComponent(sessionId)}/join`, { method: 'POST', body: opts });
  }
  async listPublicSessions() {
    return this.api('/api/v1/sessions');
  }
  async getHostedSession(sessionId, token) {
    return this.api(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, { token });
  }
  async submitHostedCommand(sessionId, token, command) {
    return this.api(`/api/v1/sessions/${encodeURIComponent(sessionId)}/commands`, { method: 'POST', body: command, token });
  }
  async sendChat(sessionId, token, text) {
    return this.api(`/api/v1/sessions/${encodeURIComponent(sessionId)}/chat`, { method: 'POST', body: { text }, token, retries: 0 });
  }
  async report(sessionId, token, report) {
    return this.api(`/api/v1/sessions/${encodeURIComponent(sessionId)}/report`, { method: 'POST', body: report, token });
  }
  async getReplay(sessionId, token = null) {
    return this.api(`/api/v1/sessions/${encodeURIComponent(sessionId)}/replay`, { token });
  }

  /**
   * Subscribe to hosted session events. Uses SSE when available, else 2s
   * polling. Returns an unsubscribe function.
   */
  subscribeSession(sessionId, token, onEvent) {
    let stopped = false;
    let es = null;
    let pollTimer = null;
    const startPoll = () => {
      const tick = async () => {
        if (stopped) return;
        const res = await this.getHostedSession(sessionId, token);
        if (res.ok) onEvent({ type: 'snapshot', data: res.data });
        pollTimer = setTimeout(tick, 2000);
      };
      pollTimer = setTimeout(tick, 2000);
    };
    if (typeof EventSource !== 'undefined') {
      const url = `/api/v1/sessions/${encodeURIComponent(sessionId)}/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      es = new EventSource(url);
      es.onmessage = (msg) => {
        try { onEvent(JSON.parse(msg.data)); } catch { /* ignore malformed */ }
      };
      es.onerror = () => {
        // EventSource auto-retries; if it dies hard, fall back to polling.
        if (es.readyState === 2 && !stopped) {
          es.close();
          startPoll();
        }
      };
    } else {
      startPoll();
    }
    return () => {
      stopped = true;
      if (es) es.close();
      if (pollTimer) clearTimeout(pollTimer);
    };
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let _anonId = null;
function anonSessionId() {
  if (!_anonId) {
    _anonId = `anon-${Math.random().toString(36).slice(2, 10)}`;
  }
  return _anonId;
}

export const platform = new Platform();
