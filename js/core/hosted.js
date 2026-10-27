// Hosted session client: a realtime room for the lobby, the game's server
// script for the round.
//
// The room (one team, a seat per house) is the lobby: the host creates it
// (and opens it when listed), guests quick-join or accept an invite, and the
// room's roster seats them. When the room starts — the host's Start, or by
// itself once every seat is taken — the platform binds a session to it and
// server.js referees the round: every client opens that session's game socket
// and sends its commands ({ type: 'act', action }); the script validates each
// one against the rules for the seat the platform says sent it, plays the
// empty seats, and broadcasts the table ({ type: 'table', … }: the seats and
// the move log), which every client replays through the same rules engine.
// The script alone decides and records the result. No client is the
// authority, and a round never runs without the script: a room that starts
// without a bound session is unavailable. Undo/hints stay unavailable in
// hosted play. `platform` is native/platform.ts's roomsAdapter.

import { Emitter } from './session.js';
import {
  RULESETS, createGame, legalActions, applyInPlace, cloneState, validateAction,
  describeAction, terminalReasonText, playerStats, translateText as tr,
} from '../rules/engine.js';

const LETTER_TYPES = { r: 'resign', t: 'timeout', o: 'offerDraw', a: 'acceptDraw', d: 'declineDraw' };

function samePath(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  return true;
}

/** One entry of server.js's move log as the action the rules applied; null when it does not fit. */
export function decodeEntry(state, m) {
  if (Array.isArray(m)) {
    const piece = m[0];
    const path = [];
    for (let i = 1; i + 1 < m.length; i += 2) path.push([m[i], m[i + 1]]);
    const action = legalActions(state).find((a) => a.piece === piece && samePath(a.path, path));
    return action || null;
  }
  if (typeof m === 'string' && LETTER_TYPES[m[0]]) {
    const player = Number(m.slice(1));
    if (!Number.isInteger(player) || !state.players[player]) return null;
    return { type: LETTER_TYPES[m[0]], player };
  }
  return null;
}

/** The game a table message describes: its seats' fresh game with the log replayed. */
export function replayTable(msg, upTo = Infinity) {
  const state = createGame({
    ruleset: msg.ruleset, seed: msg.seed,
    players: msg.seats.map((s) => ({ name: s.name, kind: s.ai ? 'ai' : 'human' })),
  });
  const moves = msg.moves || [];
  for (let i = 0; i < moves.length && i < upTo; i++) {
    const action = decodeEntry(state, moves[i]);
    if (!action) throw new Error(`table log entry ${i} does not fit the rules`);
    applyInPlace(state, action);
  }
  return state;
}

export class HostedSessionClient extends Emitter {
  constructor(platform, info) {
    super();
    this.platform = platform;
    this.roomId = info.roomId;
    this.seat = info.seat ?? 0;
    this.joinCode = info.joinCode || null;
    this.hostName = info.hostName || null;
    this.ruleset = info.ruleset || 'duel';
    this.turnDeadlineMs = info.turnDeadlineMs || null;
    this.players = info.players || [];
    this.state = null;
    this.phase = 'lobby';
    this.chatLog = [];
    this.result = null;
    this.sessionId = null;
    this.deadlineAt = null;
    this.config = { mode: 'hosted', ruleset: this.ruleset, constraints: {}, players: [] };
    this._room = null;             // the room's socket (lobby roster)
    this._game = null;             // the bound session's game socket
    this._moves = [];              // the table's log as last received
    this._resync = false;          // the next table message answers a reconnect
    this._starting = false;
    this._host = info.host === true;
  }

  get isHost() { return this._host; }

  /** Host: create a room and (when listed) open it for quick-join. */
  static async create(platform, { ruleset, name, listed, clockMs, turnDeadlineMs = null }) {
    const def = RULESETS[ruleset] || RULESETS.duel;
    const res = await platform.createRoom({
      teamCount: 1,
      seatsPerTeam: def.playerCount,
      metadata: { game: platform.slug, ruleset: def.id, listed: !!listed, clockMs: clockMs ?? null, turnDeadlineMs, hostName: name },
      aiPlayers: [],
    });
    if (!res.ok) return { ok: false, error: res.error };
    const roomId = res.data?.roomId || res.data?.id;
    if (!roomId) return { ok: false, error: 'bad-room-response' };
    if (listed) await platform.openRoom(roomId);
    const client = new HostedSessionClient(platform, {
      roomId,
      host: true,
      seat: 0,
      joinCode: res.data?.joinCode || res.data?.code || null,
      hostName: name,
      ruleset: def.id,
      turnDeadlineMs,
      players: [{ seat: 0, name, connected: true, rating: '—' }],
    });
    return { ok: true, client };
  }

  /** Guest: quick-join any open room for this game. */
  static async join(platform, { name } = {}) {
    const res = await platform.quickJoin();
    if (!res.ok) {
      return { ok: false, error: res.status === 404 ? 'no-open-tables' : (res.error || 'could-not-join') };
    }
    return HostedSessionClient.fromRoom(platform, res, { name });
  }

  /** Guest: accept a friend's table invite (realtime room invite). */
  static async acceptInvite(platform, inviteId, { name } = {}) {
    const res = await platform.acceptRoomInvite(inviteId);
    if (!res.ok || !res.data) return { ok: false, error: res.error || 'could-not-join' };
    return HostedSessionClient.fromRoom(platform, res, { name });
  }

  /** Guest client from a join/accept response ({ roomId|id, seat, metadata }). */
  static fromRoom(platform, res, { name } = {}) {
    const roomId = res.data?.roomId || res.data?.id;
    if (!roomId) return { ok: false, error: 'bad-room-response' };
    const meta = res.data?.metadata || {};
    const client = new HostedSessionClient(platform, {
      roomId,
      seat: typeof res.data?.seat === 'number' ? res.data.seat : 1,
      hostName: meta.hostName || null,
      ruleset: RULESETS[meta.ruleset] ? meta.ruleset : 'duel',
      turnDeadlineMs: meta.turnDeadlineMs || null,
      players: [],
    });
    client._guestName = name || null;
    // A join that filled the last seat started the room: its session is bound already.
    if (res.data?.gameSessionId) client._pendingSession = res.data.gameSessionId;
    return { ok: true, client };
  }

  /** The lobby's seats again; once playing, the table from the script. */
  async refresh() {
    if (this._game) this._game.send({ type: 'sync' });
    else this.emit('players', this.players);
    return { ok: true };
  }

  /** Host: start the room; the platform binds the script's session to it. */
  async startGame() {
    if (!this.isHost) return { ok: false, error: 'only the host can start' };
    if (this.sessionId) return { ok: true };
    if (this._starting) return { ok: true };
    this._starting = true;
    const res = await this.platform.startRoom(this.roomId);
    this._starting = false;
    if (!res.ok) return { ok: false, error: res.error || 'could-not-start' };
    const sid = res.data?.gameSessionId;
    if (!sid) {
      // The script could not create the round: never play it without the referee.
      this.emit('unavailable', 'no-session');
      return { ok: false, error: 'no-session' };
    }
    this._bindSession(sid);
    return { ok: true };
  }

  connect() {
    if (this._room) return;
    this._room = this.platform.openRoomSocket(this.roomId, {
      onOpen: () => {},
      onMessage: ({ control }) => { if (control) this._onRoster(control); },
      onClose: () => {
        if (this.phase !== 'lobby') return;
        for (const p of this.players) p.connected = false;
        this.emit('players', this.players);
      },
      // Token renewal refused on reconnect: the table is gone for good.
      onAuthLost: () => this.emit('authLost'),
      onTermsRequired: () => this.emit('termsRequired'),
      onUnavailable: (code) => { if (!this.sessionId) this.emit('unavailable', code); },
    });
    if (this._pendingSession) this._bindSession(this._pendingSession);
  }

  leave() {
    this._game?.close();
    this._game = null;
    this._room?.close();
    this._room = null;
    // Leaving a round in play forfeits it (the script sees the seat left).
    this.platform.leaveRoom(this.roomId).catch(() => {});
  }

  _onRoster(control) {
    if (control.type !== 'roster') return;
    if (control.gameSessionId && !this.sessionId) this._bindSession(control.gameSessionId);
    else if (control.status === 'playing' && !control.gameSessionId && !this.sessionId) {
      this.emit('unavailable', 'no-session');
      return;
    } else if (control.status === 'closed' && this.phase === 'lobby') {
      this.emit('unavailable', 'closed');
      return;
    }
    if (this.phase !== 'lobby') return;
    const list = control.players || [];
    const me = this.platform.userId ?? null;
    if (me != null) {
      const mine = list.find((p) => p.userId === me);
      if (mine && typeof mine.seat === 'number') this.seat = mine.seat;
    }
    this.players = list.map((p, i) => ({
      seat: typeof p.seat === 'number' ? p.seat : i,
      name: p.name || `Seat ${i + 1}`,
      connected: p.connected !== false,
      rating: p.rating ?? '—',
    }));
    this.emit('players', this.players);
  }

  _bindSession(sessionId) {
    if (this._game) return;
    this.sessionId = sessionId;
    this._game = this.platform.openGameSocket(sessionId, {
      onOpen: () => {
        this._resync = !!this.state;
        this._game?.send({ type: 'sync' });
      },
      onMessage: (data) => this._onGame(data),
      onError: (message) => this._onError(message),
      onAuthLost: () => this.emit('authLost'),
      onTermsRequired: () => this.emit('termsRequired'),
      onUnavailable: (code) => { if (!this.result) this.emit('unavailable', code); },
    });
  }

  _onGame(data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'table') this._applyTable(data);
    else if (data.type === 'chat') this._pushChat({ from: String(data.name || 'table'), text: String(data.text || '').slice(0, 200), at: Date.now() });
  }

  _onError(message) {
    // The script refused a command: say why (its reasons are the rules' own).
    const reason = String(message || 'rejected');
    this.emit('invalid', { reason, message: reason });
  }

  _applyTable(msg) {
    if (!Array.isArray(msg.seats) || !RULESETS[msg.ruleset]) return;
    const prev = this.state;
    const prevPly = prev && prev.ruleset === msg.ruleset ? this._moves.length : 0;
    let next;
    try { next = replayTable(msg); } catch (e) {
      console.warn(`hosted table: ${e.message}`);
      this._game?.send({ type: 'sync' });
      return;
    }
    const me = this.platform.userId ?? null;
    const mine = me != null ? msg.seats.findIndex((s) => s.userId === me) : -1;
    if (mine >= 0) this.seat = mine;
    this.players = msg.seats.map((s, i) => ({ seat: i, name: s.name, connected: true, rating: '—', ai: !!s.ai }));
    this.ruleset = msg.ruleset;
    this.config.ruleset = msg.ruleset;
    this.config.players = next.players.map((p) => ({ name: p.name, kind: p.kind }));
    this.deadlineAt = msg.deadlineAt ?? null;
    const moves = msg.moves || [];
    const fresh = !prev || moves.length < prevPly;
    this._moves = moves;
    this.state = next;
    this.phase = next.phase === 'active' && !msg.over ? 'active' : 'over';
    if (!fresh && moves.length > prevPly) {
      // Replay the new log entries as discrete actions for animation and audio.
      let before = replayTable(msg, prevPly);
      for (let i = prevPly; i < moves.length; i++) {
        const action = decodeEntry(before, moves[i]);
        const snapshot = cloneState(before);
        const by = action.type === 'move' ? before.pieces[action.piece].owner : action.player;
        if (action.type === 'move') {
          const piece = before.pieces[action.piece];
          action.from = [piece.r, piece.c];
        }
        const description = describeAction(snapshot, action);
        applyInPlace(before, action);
        this.emit('action', { action, description, remote: by !== this.seat, before: snapshot, after: cloneState(before) });
      }
      if (this._resync) {
        this.emit('announce', { text: tr('While you were away, {n} moves were played.', { n: moves.length - prevPly }) });
      }
    }
    this._resync = false;
    this.emit('state', this.state);
    if (msg.over && !this.result) {
      this.result = this._shapeResult(msg.over);
      this.phase = 'over';
      this.emit('over', this.result);
    }
  }

  _shapeResult(over) {
    const ratings = Array.isArray(over.ratings) ? over.ratings : null;
    return {
      winner: over.winner ?? null,
      reason: over.reason || 'completed',
      reasonText: this.state && this.state.result ? terminalReasonText(this.state) : (over.reason || ''),
      plies: over.plies ?? this.state?.ply ?? 0,
      breakdowns: over.breakdowns || [],
      ratingChanges: ratings ? ratings.map((r) => r.after - r.before) : null,
      ratings,
      recorded: !!over.recorded,
      sessionId: this.sessionId || this.roomId,
      assistsUsed: false,
      invalids: {},
      elapsedMs: over.elapsedMs ?? null,
    };
  }

  _pushChat(m) {
    this.chatLog.push(m);
    this.emit('chat', m);
  }

  get turn() { return this.state?.turn ?? 0; }
  isMyTurn() { return !!this.state && this.phase === 'active' && this.state.phase === 'active' && this.state.turn === this.seat; }
  currentPlayer() { return this.state?.players[this.state.turn]; }
  isAiTurn() { return false; } // the script plays the AI seats
  legalTargets() { return this.state ? legalActions(this.state) : []; }
  canUndo() { return false; }
  canHint() { return false; }
  assistsUsed() { return false; }

  /** Sends the local seat's command to the script (checked against the rules here first). */
  async submit(action) {
    if (!this.state || !this._game) return { ok: false, reason: 'not-connected' };
    if (this.phase !== 'active') return { ok: false, reason: 'game-over' };
    let wire;
    if (action.type === 'move') wire = { type: 'move', piece: action.piece, path: action.path };
    else wire = { type: action.type };
    const local = { ...wire, player: this.seat };
    const ownTurn = ['move', 'resign', 'offerDraw'].includes(wire.type);
    const check = ownTurn && this.state.turn !== this.seat ? { ok: false, reason: 'not-your-turn' } : validateAction(this.state, local);
    if (!check.ok) {
      this.emit('invalid', { reason: check.reason, message: check.reason, action });
      return { ok: false, reason: check.reason };
    }
    if (!this._game.send({ type: 'act', action: wire })) {
      this.emit('invalid', { reason: 'not-connected', message: 'not-connected', action });
      return { ok: false, reason: 'not-connected' };
    }
    return { ok: true };
  }

  async sendChat(text) {
    const clean = String(text || '').slice(0, 200);
    if (!this._game) return { ok: false, error: 'not-connected' };
    return { ok: !!this._game.send({ type: 'chat', text: clean }) };
  }

  async reportPlayer() {
    // No rooms equivalent for player reports; keep an honest unsupported.
    return { ok: false, error: 'reports are not available on hosted tables' };
  }

  stats() {
    return this.state ? playerStats(this.state) : null;
  }

  pause() { /* the script keeps the table's clock */ }
  resume() { /* the game socket resyncs by itself */ }
  destroy() { this.leave(); }
}
