// Crown Draughts — authoritative game script and standalone dev harness.
//
// StarHermit packaging declares `server=server.js`: the exported
// `createAuthoritativeEngine()` is the sandboxed game script — pure session
// logic over the shared rules engine, with injected clock and persistence.
// Run `node server.js --dev` to also serve the client and a same-origin
// /api/v1 transport (REST source of truth + SSE events), which enables real
// hosted play between browsers with reconnect and authoritative results.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createGame, apply, serialize, deserialize, hashState, validateAction,
  scoreBreakdown, eloDelta, RULESETS,
} from './js/rules/engine.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DATA_FILE = join(ROOT, '.dev-data.json');
const MAX_PAYLOAD = 4096;
const MAX_COMMANDS_PER_10S = 12;
const CHAT_PER_MINUTE = 10;
const CHAT_MAX_LEN = 240;
const LOBBY_TTL_MS = 30 * 60 * 1000;
const AWAY_GRACE_MS = 45 * 1000;
const ABANDON_MS = 5 * 60 * 1000;

const token = () => randomBytes(18).toString('base64url');
const shortCode = () => randomBytes(4).toString('hex').toUpperCase().slice(0, 6);

// ---------------------------------------------------------------------------
// Authoritative engine (platform-sandbox shape: injected now/persist)
// ---------------------------------------------------------------------------

export function createAuthoritativeEngine({ now = () => Date.now(), persist = null } = {}) {
  const sessions = new Map();   // id -> session record
  const ratings = new Map();    // lowercase name -> rating

  function ratingFor(name) {
    const k = String(name || '').toLowerCase();
    if (!ratings.has(k)) ratings.set(k, 1000);
    return ratings.get(k);
  }

  function sanitize(sess, seatIdx) {
    return {
      id: sess.id,
      ruleset: sess.ruleset,
      seed: sess.seed,
      you: seatIdx,
      players: sess.seats.map((s, i) => ({
        seat: i, name: s.name, connected: s.connected, away: s.away,
        rating: ratingFor(s.name),
      })),
      state: sess.state,            // full engine state — no hidden information in draughts
      version: sess.version,
      clocks: sess.clocks ? liveClocks(sess) : null,
      turnDeadlineAt: sess.turnDeadlineAt,
      phase: sess.result ? 'over' : (sess.started ? 'active' : 'lobby'),
      result: sess.result,
      chat: sess.chat.slice(-50),
      createdAt: sess.createdAt,
    };
  }

  function liveClocks(sess) {
    if (!sess.clocks) return null;
    const out = sess.clocks.slice();
    if (sess.started && !sess.result && sess.state.phase === 'active') {
      out[sess.state.turn] = Math.max(0, out[sess.state.turn] - (now() - sess.turnStartedAt));
    }
    return out;
  }

  function chargeClock(sess) {
    if (!sess.clocks) return;
    const elapsed = now() - sess.turnStartedAt;
    sess.clocks[sess.state.turn] = Math.max(0, sess.clocks[sess.state.turn] - elapsed);
    sess.turnStartedAt = now();
  }

  function bump(sess) {
    sess.version += 1;
    sess.touchedAt = now();
    if (persist) persist(api.exportData());
    for (const fn of sess.listeners) {
      try { fn({ type: 'update', version: sess.version }); } catch { /* listener gone */ }
    }
  }

  function finishIfOver(sess) {
    if (sess.state.phase !== 'over' || sess.result) return;
    const r = sess.state.result;
    const breakdowns = sess.seats.map((_, i) => scoreBreakdown(sess.state, i, { par: sess.par }));
    const ratingChanges = {};
    if (sess.seats.length === 2 && !sess.unranked) {
      const [a, b] = sess.seats;
      const ra = ratingFor(a.name);
      const rb = ratingFor(b.name);
      const scoreA = r.winner === null ? 0.5 : r.winner === 0 ? 1 : 0;
      const d = eloDelta(ra, rb, scoreA);
      ratings.set(a.name.toLowerCase(), ra + d);
      ratings.set(b.name.toLowerCase(), rb - d);
      ratingChanges[a.name] = d;
      ratingChanges[b.name] = -d;
    }
    sess.result = {
      winner: r.winner,
      reason: r.reason,
      plies: sess.state.ply,
      breakdowns,
      ratingChanges,
      endedAt: new Date(now()).toISOString(),
    };
  }

  const api = {
    createSession({ ruleset = 'duel', playerName = 'Host', listed = false, clockMs = null, turnDeadlineMs = null, seed = null } = {}) {
      if (!RULESETS[ruleset]) return { ok: false, error: 'unknown-ruleset' };
      const id = token().slice(0, 12);
      const sess = {
        id,
        joinCode: shortCode(),
        listed: !!listed,
        unranked: false,
        ruleset,
        seed: seed ?? (randomBytes(4).readUInt32BE(0) >>> 0),
        par: null,
        seats: [],
        state: null,
        commands: [],
        hashes: [],
        seenCommandIds: [],
        rateWindows: new Map(),
        clocks: null, // initialized at start when clockMs is set
        clockMs,
        turnDeadlineMs,
        turnStartedAt: 0,
        turnDeadlineAt: null,
        chat: [],
        createdAt: new Date(now()).toISOString(),
        touchedAt: now(),
        started: false,
        result: null,
        version: 0,
        listeners: new Set(),
        chatWindows: new Map(),
      };
      sessions.set(id, sess);
      const join = api.joinSession(id, { name: playerName });
      if (!join.ok) return join;
      return { ok: true, sessionId: id, joinCode: sess.joinCode, playerToken: join.playerToken, seat: join.seat };
    },

    listPublic() {
      const out = [];
      for (const s of sessions.values()) {
        if (!s.listed || s.started || s.result) continue;
        out.push({
          id: s.id, ruleset: s.ruleset, seats: s.seats.length,
          capacity: RULESETS[s.ruleset].playerCount,
          hostRating: ratingFor(s.seats[0]?.name),
          createdAt: s.createdAt,
        });
      }
      // nearest-rating-friendly ordering is the caller's job; stable by age here
      out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return out;
    },

    findByJoinCode(code) {
      for (const s of sessions.values()) {
        if (s.joinCode === String(code || '').toUpperCase() && !s.result) return s;
      }
      return null;
    },

    joinSession(id, { name = 'Guest', joinCode = null } = {}) {
      const sess = sessions.get(id) || api.findByJoinCode(id);
      if (!sess) return { ok: false, error: 'no-such-session' };
      if (sess.result) return { ok: false, error: 'session-over' };
      const capacity = RULESETS[sess.ruleset].playerCount;
      if (sess.seats.length >= capacity) return { ok: false, error: 'session-full' };
      if (sess.started) return { ok: false, error: 'already-started' };
      if (!sess.listed && sess.joinCode !== String(joinCode || sess.joinCode).toUpperCase() && sess.seats.length > 0) {
        return { ok: false, error: 'bad-join-code' };
      }
      const seat = sess.seats.length;
      const playerToken = token();
      sess.seats.push({
        name: String(name).slice(0, 24) || `Player ${seat + 1}`,
        token: playerToken, connected: true, away: false, lastSeen: now(),
        awaySince: null,
      });
      bump(sess);
      return { ok: true, sessionId: sess.id, seat, playerToken };
    },

    startSession(id, byToken) {
      const sess = sessions.get(id);
      if (!sess) return { ok: false, error: 'no-such-session' };
      const seat = sess.seats.findIndex((s) => s.token === byToken);
      if (seat !== 0) return { ok: false, error: 'only-host-starts' };
      const capacity = RULESETS[sess.ruleset].playerCount;
      if (sess.seats.length < 2) return { ok: false, error: 'need-more-players' };
      if (sess.started) return { ok: true };
      const players = sess.seats.map((s) => ({ name: s.name, kind: 'human' }));
      // every engine seat must have a human commander in hosted play
      if (sess.seats.length !== capacity) return { ok: false, error: 'session-not-full' };
      sess.state = createGame({ ruleset: sess.ruleset, seed: sess.seed, players });
      sess.hashes = [hashState(sess.state)];
      sess.started = true;
      sess.turnStartedAt = now();
      if (sess.clockMs) sess.clocks = sess.seats.map(() => sess.clockMs);
      if (sess.turnDeadlineMs) sess.turnDeadlineAt = now() + sess.turnDeadlineMs;
      bump(sess);
      return { ok: true };
    },

    getSession(id, byToken) {
      const sess = sessions.get(id);
      if (!sess) return { ok: false, error: 'no-such-session' };
      const seat = sess.seats.findIndex((s) => s.token === byToken);
      if (seat < 0) return { ok: false, error: 'not-a-member' };
      sess.seats[seat].lastSeen = now();
      return { ok: true, data: sanitize(sess, seat) };
    },

    submitCommand(id, byToken, body) {
      const sess = sessions.get(id);
      if (!sess) return { ok: false, error: 'no-such-session' };
      const seat = sess.seats.findIndex((s) => s.token === byToken);
      if (seat < 0) return { ok: false, error: 'not-a-member' };
      if (!sess.started) return { ok: false, error: 'not-started' };
      if (sess.result) return { ok: false, error: 'session-over' };
      const size = JSON.stringify(body || {}).length;
      if (size > MAX_PAYLOAD) return { ok: false, error: 'payload-too-large' };
      // rate limit
      const win = sess.rateWindows.get(seat) || [];
      const cutoff = now() - 10000;
      const fresh = win.filter((t) => t > cutoff);
      if (fresh.length >= MAX_COMMANDS_PER_10S) return { ok: false, error: 'rate-limited' };
      fresh.push(now());
      sess.rateWindows.set(seat, fresh);
      // idempotent dedupe by command id
      const commandId = String(body.commandId || '');
      if (!commandId) return { ok: false, error: 'missing-command-id' };
      if (sess.seenCommandIds.includes(commandId)) {
        return { ok: true, duplicate: true, version: sess.version };
      }
      const action = body.action;
      // turn binding: only the side to move may move/resign/offer
      const actor = action?.type === 'move' ? sess.state.pieces[action.piece]?.owner : action?.player;
      if (['move', 'resign', 'offerDraw'].includes(action?.type) && actor !== sess.state.turn) {
        return { ok: false, error: 'not-your-turn' };
      }
      if (actor !== seat && ['move', 'resign', 'offerDraw', 'acceptDraw', 'declineDraw'].includes(action?.type)) {
        return { ok: false, error: 'not-your-seat' };
      }
      chargeClock(sess);
      const check = validateAction(sess.state, action);
      if (!check.ok) return { ok: false, error: check.reason };
      sess.seenCommandIds.push(commandId);
      sess.state = apply(sess.state, check.resolved || action);
      sess.commands.push({ id: commandId, action: check.resolved || action });
      sess.hashes.push(hashState(sess.state));
      if (sess.turnDeadlineMs) sess.turnDeadlineAt = now() + sess.turnDeadlineMs;
      finishIfOver(sess);
      bump(sess);
      return { ok: true, version: sess.version, over: sess.result || null };
    },

    chat(id, byToken, text) {
      const sess = sessions.get(id);
      if (!sess) return { ok: false, error: 'no-such-session' };
      const seat = sess.seats.findIndex((s) => s.token === byToken);
      if (seat < 0) return { ok: false, error: 'not-a-member' };
      const msg = String(text || '').slice(0, CHAT_MAX_LEN).trim();
      if (!msg) return { ok: false, error: 'empty-message' };
      const win = sess.chatWindows.get(seat) || [];
      const cutoff = now() - 60000;
      const fresh = win.filter((t) => t > cutoff);
      if (fresh.length >= CHAT_PER_MINUTE) return { ok: false, error: 'rate-limited' };
      fresh.push(now());
      sess.chatWindows.set(seat, fresh);
      const entry = { id: token().slice(0, 8), from: seat, name: sess.seats[seat].name, text: msg, at: new Date(now()).toISOString() };
      sess.chat.push(entry);
      if (sess.chat.length > 200) sess.chat.shift();
      bump(sess);
      return { ok: true, entry };
    },

    report(id, byToken, { messageId = null, playerSeat = null, reason = 'unspecified' } = {}) {
      const sess = sessions.get(id);
      if (!sess) return { ok: false, error: 'no-such-session' };
      const seat = sess.seats.findIndex((s) => s.token === byToken);
      if (seat < 0) return { ok: false, error: 'not-a-member' };
      sess.reports = sess.reports || [];
      sess.reports.push({ by: seat, messageId, playerSeat, reason: String(reason).slice(0, 80), at: new Date(now()).toISOString() });
      return { ok: true };
    },

    replay(id, byToken) {
      const sess = sessions.get(id);
      if (!sess) return { ok: false, error: 'no-such-session' };
      const seat = sess.seats.findIndex((s) => s.token === byToken);
      if (seat < 0 && !sess.listed) return { ok: false, error: 'not-a-member' };
      return {
        ok: true,
        data: {
          schema: 1, ruleset: sess.ruleset, seed: sess.seed,
          players: sess.seats.map((s) => ({ name: s.name, kind: 'human' })),
          initialHash: sess.hashes[0] || null,
          commands: sess.commands,
          hashes: sess.hashes,
          result: sess.result,
        },
      };
    },

    presence(id, byToken, connected) {
      const sess = sessions.get(id);
      if (!sess) return;
      const seat = sess.seats.findIndex((s) => s.token === byToken);
      if (seat < 0) return;
      const s = sess.seats[seat];
      s.lastSeen = now();
      if (typeof connected === 'boolean') {
        s.connected = connected;
        if (connected) { s.away = false; s.awaySince = null; }
        else if (!s.away) { s.away = true; s.awaySince = now(); }
      }
    },

    subscribe(id, byToken, listener) {
      const sess = sessions.get(id);
      if (!sess) return null;
      const seat = sess.seats.findIndex((s) => s.token === byToken);
      if (seat < 0) return null;
      sess.listeners.add(listener);
      api.presence(id, byToken, true);
      return () => {
        sess.listeners.delete(listener);
        api.presence(id, byToken, false);
      };
    },

    /** Housekeeping: lobby expiry, away flags, abandonment, deadlines. */
    tick() {
      const t = now();
      for (const sess of sessions.values()) {
        if (sess.result) continue;
        if (!sess.started) {
          if (t - sess.touchedAt > LOBBY_TTL_MS) sessions.delete(sess.id);
          continue;
        }
        // away detection
        for (const s of sess.seats) {
          if (s.connected && t - s.lastSeen > AWAY_GRACE_MS) {
            s.connected = false; s.away = true; s.awaySince = t;
            bump(sess);
          }
        }
        // turn deadline
        if (sess.turnDeadlineAt && t > sess.turnDeadlineAt) {
          chargeClock(sess);
          const v = validateAction(sess.state, { type: 'timeout', player: sess.state.turn });
          if (v.ok) {
            sess.state = apply(sess.state, { type: 'timeout', player: sess.state.turn });
            sess.commands.push({ id: `server-timeout-${sess.state.ply}`, action: { type: 'timeout', player: sess.state.turn } });
            sess.hashes.push(hashState(sess.state));
            finishIfOver(sess);
          }
          sess.turnDeadlineAt = sess.result ? null : t + sess.turnDeadlineMs;
          bump(sess);
        }
        // abandonment: everyone else gone too long → remaining player wins
        const gone = sess.seats.filter((s) => s.awaySince && t - s.awaySince > ABANDON_MS);
        if (gone.length && sess.state.phase === 'active') {
          const remaining = sess.seats.filter((s) => !(s.awaySince && t - s.awaySince > ABANDON_MS));
          if (remaining.length === 1 && sess.seats.length === 2) {
            const winnerSeat = sess.seats.indexOf(remaining[0]);
            sess.state.phase = 'over';
            sess.state.result = { winner: winnerSeat, reason: 'abandoned', ply: sess.state.ply, eliminated: [] };
            finishIfOver(sess);
            bump(sess);
          }
        }
      }
    },

    exportData() {
      const arr = [];
      for (const s of sessions.values()) {
        arr.push({
          ...s,
          listeners: undefined,
          rateWindows: [...s.rateWindows.entries()],
          chatWindows: [...s.chatWindows.entries()],
        });
      }
      return { sessions: arr, ratings: [...ratings.entries()] };
    },

    importData(data) {
      if (!data) return;
      for (const [k, v] of data.ratings || []) ratings.set(k, v);
      for (const s of data.sessions || []) {
        sessions.set(s.id, {
          ...s,
          listeners: new Set(),
          rateWindows: new Map(s.rateWindows || []),
          chatWindows: new Map(s.chatWindows || []),
        });
      }
    },

    _sessions: sessions,
    _ratings: ratings,
  };
  return api;
}

// ---------------------------------------------------------------------------
// Dev harness: static files + /api/v1 + SSE
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export async function startDevServer({ port = 8080, dataFile = DATA_FILE, quiet = false } = {}) {
  const engine = createAuthoritativeEngine({
    persist: (data) => {
      writeFile(dataFile, JSON.stringify(data)).catch(() => {});
    },
  });
  if (existsSync(dataFile)) {
    try {
      engine.importData(JSON.parse(await readFile(dataFile, 'utf8')));
    } catch { /* corrupted dev data — start fresh */ }
  }
  const tickTimer = setInterval(() => engine.tick(), 1000);
  tickTimer.unref?.();

  const send = (res, status, body, headers = {}) => {
    const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(payload);
  };

  const readBody = (req) => new Promise((resolve) => {
    let data = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 65536) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return resolve(null);
      try { resolve(JSON.parse(data || '{}')); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });

  const authOf = (req, url) => {
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) return h.slice(7);
    return url.searchParams.get('token') || null;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    if (path.startsWith('/api/v1/')) {
      const sub = path.slice('/api/v1'.length);
      if (sub === '/ping') return send(res, 200, { ok: true, name: 'Crown Draughts', mode: 'dev' });
      if (sub === '/time') return send(res, 200, { now: new Date().toISOString(), epochMs: Date.now() });
      if (sub === '/telemetry' && req.method === 'POST') {
        await readBody(req);
        return send(res, 204, '');
      }
      if (sub === '/presence' && req.method === 'POST') {
        await readBody(req);
        return send(res, 204, '');
      }
      if (sub === '/sessions' && req.method === 'GET') {
        return send(res, 200, { sessions: engine.listPublic() });
      }
      if (sub === '/sessions' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body) return send(res, 400, { error: 'bad-json' });
        const out = engine.createSession(body);
        return send(res, out.ok ? 200 : 400, out);
      }
      const mJoin = sub.match(/^\/sessions\/([^/]+)\/join$/);
      if (mJoin && req.method === 'POST') {
        const body = await readBody(req);
        if (!body) return send(res, 400, { error: 'bad-json' });
        const out = engine.joinSession(decodeURIComponent(mJoin[1]), body);
        return send(res, out.ok ? 200 : 400, out);
      }
      const mStart = sub.match(/^\/sessions\/([^/]+)\/start$/);
      if (mStart && req.method === 'POST') {
        const out = engine.startSession(decodeURIComponent(mStart[1]), authOf(req, url));
        return send(res, out.ok ? 200 : 400, out);
      }
      const mCmd = sub.match(/^\/sessions\/([^/]+)\/commands$/);
      if (mCmd && req.method === 'POST') {
        const body = await readBody(req);
        if (!body) return send(res, 400, { error: 'bad-json' });
        const out = engine.submitCommand(decodeURIComponent(mCmd[1]), authOf(req, url), body);
        return send(res, out.ok ? 200 : 400, out);
      }
      const mChat = sub.match(/^\/sessions\/([^/]+)\/chat$/);
      if (mChat && req.method === 'POST') {
        const body = await readBody(req);
        if (!body) return send(res, 400, { error: 'bad-json' });
        const out = engine.chat(decodeURIComponent(mChat[1]), authOf(req, url), body?.text);
        return send(res, out.ok ? 200 : 400, out);
      }
      const mReport = sub.match(/^\/sessions\/([^/]+)\/report$/);
      if (mReport && req.method === 'POST') {
        const body = await readBody(req);
        const out = engine.report(decodeURIComponent(mReport[1]), authOf(req, url), body || {});
        return send(res, out.ok ? 200 : 400, out);
      }
      const mReplay = sub.match(/^\/sessions\/([^/]+)\/replay$/);
      if (mReplay && req.method === 'GET') {
        const out = engine.replay(decodeURIComponent(mReplay[1]), authOf(req, url));
        return send(res, out.ok ? 200 : 403, out);
      }
      const mEvents = sub.match(/^\/sessions\/([^/]+)\/events$/);
      if (mEvents && req.method === 'GET') {
        const id = decodeURIComponent(mEvents[1]);
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
        const listener = (ev) => {
          const view = engine.getSession(id, authOf(req, url));
          res.write(`data: ${JSON.stringify({ type: ev.type, version: ev.version, data: view.ok ? view.data : null })}\n\n`);
        };
        const unsub = engine.subscribe(id, authOf(req, url), listener);
        if (!unsub) { res.end(); return; }
        const hb = setInterval(() => res.write(`: hb\n\n`), 25000);
        req.on('close', () => { clearInterval(hb); unsub(); });
        return;
      }
      const mGet = sub.match(/^\/sessions\/([^/]+)$/);
      if (mGet && req.method === 'GET') {
        const out = engine.getSession(decodeURIComponent(mGet[1]), authOf(req, url));
        return send(res, out.ok ? 200 : 403, out.ok ? out.data : out);
      }
      return send(res, 404, { error: 'not-found' });
    }

    // static files
    let rel = decodeURIComponent(path);
    if (rel === '/') rel = '/index.html';
    const filePath = normalize(join(ROOT, rel));
    if (!filePath.startsWith(ROOT)) return send(res, 403, { error: 'forbidden' });
    try {
      const data = await readFile(filePath);
      send(res, 200, data, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
    } catch {
      send(res, 404, { error: 'not-found' });
    }
  });

  await new Promise((resolve) => server.listen(port, resolve));
  const actualPort = server.address().port;
  if (!quiet) console.log(`Crown Draughts dev server: http://localhost:${actualPort}`);
  return {
    port: actualPort,
    engine,
    close: () => new Promise((r) => {
      clearInterval(tickTimer);
      server.closeAllConnections?.();
      server.close(r);
    }),
  };
}

if (process.argv.includes('--dev') || process.argv[1]?.endsWith('server.js') && !process.argv.includes('--no-serve')) {
  const portIdx = process.argv.indexOf('--port');
  const port = portIdx > 0 ? Number(process.argv[portIdx + 1]) : Number(process.env.PORT || 8080);
  startDevServer({ port });
}
