// A stand-in for the StarHermit platform's script host and realtime rooms, for
// node tests: it runs server.js the way the platform does (a fresh context per
// invocation, every ctx and return value through JSON, the sender id attached
// by the host), binds a session to a room when the room starts, and gives each
// player native/platform.ts's roomsAdapter surface for js/core/hosted.js.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = readFileSync(fileURLToPath(new URL('../server.js', import.meta.url)), 'utf8');
const SCRIPT = new vm.Script(SOURCE, { filename: 'server.js' });
const json = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Calls one entry point of server.js in a fresh context, as the platform's sandbox does. */
export function invoke(entry, ctx) {
  const sandbox = {};
  vm.createContext(sandbox);
  SCRIPT.runInContext(sandbox);
  const out = sandbox.game[entry](json(ctx));
  return json(out);
}
/** The script's static declarations (read at publish time). */
export function declarations() {
  const sandbox = {};
  vm.createContext(sandbox);
  SCRIPT.runInContext(sandbox);
  return json({ tickRateHz: sandbox.game.tickRateHz, BOARDS: sandbox.BOARDS });
}

/**
 * One scripted session: state, players' docs, and what the script returned.
 * room: { roomId, metadata, roster } for a room-bound session, else null.
 */
export class ScriptSession {
  constructor({ players, room = null, presence = null, playerStates = {}, now = 1_000_000, random = 0.3 }) {
    this.players = players;          // [{ id, name, elo? }] — the session's humans
    this.room = room;
    this.presence = presence || (room ? Object.fromEntries(players.map((p) => [p.id, { online: true, left: false }])) : null);
    this.playerStates = playerStates;
    this.now = now;
    this.random = random;
    this.state = null;
    this.result = null;
    this.scores = [];
    this.eloUpdates = [];
    this.inbox = new Map();          // userId -> [data]
    this.errors = new Map();         // userId -> [message]
    this.listeners = new Set();      // (to, data) for live sockets
  }
  ctx(extra = {}) {
    const c = {
      now: this.now, random: this.random, sessionId: 'sess-1',
      players: this.players.map((p) => ({ elo: 1200, ...p })),
      sessionState: this.state, playerStates: this.playerStates, ...extra,
    };
    if (this.room) { c.room = this.room; c.presence = this.presence; }
    return c;
  }
  apply(out, from = null) {
    if (!out || !out.ok) {
      if (from) { const l = this.errors.get(from) || []; l.push(out?.error || 'error'); this.errors.set(from, l); }
      for (const fn of this.listeners) fn({ error: out?.error || 'error', to: from ? [from] : [] });
      return out;
    }
    if (out.sessionState !== undefined) this.state = out.sessionState;
    if (out.playerStates) Object.assign(this.playerStates, out.playerStates);
    if (out.scores) this.scores.push(out.scores);
    if (out.eloUpdates) this.eloUpdates.push(out.eloUpdates);
    for (const b of out.broadcast || []) {
      const to = b.to === 'all' ? this.players.map((p) => p.id) : b.to;
      for (const id of to) { const l = this.inbox.get(id) || []; l.push(b.data); this.inbox.set(id, l); }
      for (const fn of this.listeners) fn({ data: b.data, to });
    }
    if (out.result && !this.result) this.result = out.result;
    return out;
  }
  create() { return this.apply(invoke('createSession', this.ctx())); }
  /** A command from `from` (the host attaches the authenticated sender). */
  send(from, data) {
    if (this.result) return { ok: false, error: 'session finished' };
    return this.apply(invoke('onPlayerMessage', this.ctx({ message: { from, data } })), from);
  }
  tick(ms = 1000) {
    this.now += ms;
    if (this.result) return { ok: true };
    return this.apply(invoke('onTick', this.ctx()));
  }
  last(userId, type = 'table') {
    const l = (this.inbox.get(userId) || []).filter((d) => d.type === type);
    return l[l.length - 1] || null;
  }
}

/** Realtime rooms with server.js bound to a started room; `adapter(userId, name)` is roomsAdapter. */
export function fakePlatform() {
  const room = {
    id: 'room-1', participants: [], sockets: new Map(), games: new Map(), metadata: null,
    open: false, status: 'lobby', seats: 2, gameSessionId: null, session: null, result: null,
  };
  const snapshot = () => ({
    players: room.participants.map((p) => ({ seat: p.slot, userId: p.userId, name: p.username, connected: true })),
    status: room.status, gameSessionId: room.gameSessionId,
  });
  const pushRoster = () => {
    const c = { type: 'roster', ...snapshot() };
    for (const s of room.sockets.values()) queueMicrotask(() => s.onMessage?.({ control: json(c) }));
  };
  const start = () => {
    if (room.status === 'playing') return;
    room.status = 'playing';
    const humans = room.participants.filter((p) => p.userId);
    room.session = new ScriptSession({
      players: humans.map((p) => ({ id: p.userId, name: p.username })),
      room: {
        roomId: room.id, metadata: room.metadata,
        roster: room.participants.slice().sort((a, b) => a.slot - b.slot)
          .map((p) => ({ userId: p.userId, name: p.username, team: 0, slot: p.slot, ai: !p.userId })),
      },
    });
    room.session.listeners.add(({ data, to, error }) => {
      for (const [uid, h] of room.games) {
        if (!to.includes(uid)) continue;
        if (error) queueMicrotask(() => h.onError?.(error));
        else { const d = json(data); queueMicrotask(() => h.onMessage?.(d)); }
      }
    });
    const out = room.session.create();
    room.gameSessionId = out && out.ok ? 'sess-1' : null;
    pushRoster();
  };
  const watchResult = () => {
    if (room.session?.result && !room.result) { room.result = room.session.result; room.status = 'closed'; pushRoster(); }
  };
  const adapter = (userId, username) => ({
    slug: 'crown-draughts', hosted: true, online: true, userId,
    async createRoom(config) {
      room.metadata = json(config.metadata);
      room.seats = config.seatsPerTeam;
      room.participants.push({ id: `p-${userId}`, userId, username, slot: 0 });
      return { ok: true, status: 200, data: { roomId: room.id, seat: 0, metadata: room.metadata } };
    },
    async openRoom() { room.open = true; return { ok: true, status: 200 }; },
    async quickJoin() {
      if (!room.open || room.status !== 'lobby') return { ok: false, status: 404 };
      const slot = room.participants.length;
      room.participants.push({ id: `p-${userId}`, userId, username, slot });
      // A room starts by itself once every seat is taken.
      if (room.participants.length >= room.seats) start();
      else pushRoster();
      return { ok: true, status: 200, data: { roomId: room.id, seat: slot, metadata: room.metadata, gameSessionId: room.gameSessionId } };
    },
    async startRoom() {
      if (room.participants[0]?.userId !== userId) return { ok: false, status: 403, error: 'forbidden' };
      start();
      return { ok: true, status: 200, data: { gameSessionId: room.gameSessionId } };
    },
    async leaveRoom() {
      room.participants = room.participants.filter((p) => p.userId !== userId);
      if (room.session?.presence?.[userId]) room.session.presence[userId].left = true;
      return { ok: true, status: 204 };
    },
    openRoomSocket(roomId, h) {
      room.sockets.set(userId, h);
      queueMicrotask(() => { h.onOpen?.(); h.onMessage?.({ control: json({ type: 'roster', ...snapshot() }) }); });
      return { close() { room.sockets.delete(userId); } };
    },
    openGameSocket(sessionId, h) {
      room.games.set(userId, h);
      queueMicrotask(() => h.onOpen?.());
      return {
        send(data) {
          const d = json(data);
          queueMicrotask(() => { room.session.send(userId, d); watchResult(); });
          return true;
        },
        close() { room.games.delete(userId); },
      };
    },
  });
  const tick = (ms) => { room.session?.tick(ms); watchResult(); };
  return { room, adapter, tick };
}
