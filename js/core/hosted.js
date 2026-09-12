// Hosted session client over realtime rooms (host-routed).
//
// The HOST seat runs the authoritative rules Session locally (the same engine
// as offline play) and broadcasts serialized snapshots over the room socket;
// GUESTS send their existing action JSON ({type:'move'|...}) as binary frames
// (guest→host), which the host validates through Session.submit and answers
// with a fresh snapshot (host→everyone). Chat and lobby roster ride the same
// channel. The host reports the result via POST /rooms/{id}/result; everyone
// leaves via POST /rooms/{id}/leave. Undo/hints stay unavailable in hosted
// play. This module keeps the exact client surface the UI already uses.

import { Emitter } from './session.js';
import { Session } from './session.js';
import { RULESETS, deserialize, serialize, legalActions, describeAction, terminalReasonText, playerStats } from '../rules/engine.js';

let counter = 0;

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
    this.version = -1;
    this.config = { mode: 'hosted', ruleset: this.ruleset, constraints: {}, players: [] };
    this._socket = null;
    this._session = null;          // host only: authoritative local session
    this._deadlineTimer = null;
  }

  get isHost() { return this.seat === 0; }

  /** Host: create a room and (when listed) open it for quick-join. */
  static async create(platform, { ruleset, name, listed, clockMs, turnDeadlineMs = null }) {
    const def = RULESETS[ruleset] || RULESETS.duel;
    const res = await platform.createRoom({
      teamCount: 1,
      seatsPerTeam: def.playerCount,
      metadata: { game: platform.slug, ruleset, listed: !!listed, clockMs: clockMs ?? null, turnDeadlineMs, hostName: name },
      aiPlayers: [],
    });
    if (!res.ok) return { ok: false, error: res.error };
    const roomId = res.data?.roomId || res.data?.id;
    if (!roomId) return { ok: false, error: 'bad-room-response' };
    if (listed) await platform.openRoom(roomId);
    const client = new HostedSessionClient(platform, {
      roomId,
      seat: 0,
      joinCode: res.data?.joinCode || res.data?.code || null,
      hostName: name,
      ruleset,
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
    const roomId = res.data?.roomId || res.data?.id;
    if (!roomId) return { ok: false, error: 'bad-room-response' };
    const meta = res.data?.metadata || {};
    const client = new HostedSessionClient(platform, {
      roomId,
      seat: typeof res.data?.seat === 'number' ? res.data.seat : 1,
      hostName: meta.hostName || null,
      ruleset: meta.ruleset || 'duel',
      turnDeadlineMs: meta.turnDeadlineMs || null,
      players: [],
    });
    client._guestName = name || null;
    return { ok: true, client };
  }

  /** Guests have no local state to refresh; the socket stream is the truth. */
  async refresh() {
    if (this.isHost) this._broadcastLobby();
    else if (this._guestName && this._socket) this._socket.send({ t: 'hello', name: this._guestName });
    return { ok: true };
  }

  /** Host: start the round — build the local authoritative session. */
  async startGame() {
    if (!this.isHost) return { ok: false, error: 'only the host can start' };
    const def = RULESETS[this.ruleset] || RULESETS.duel;
    const players = [];
    for (let i = 0; i < def.playerCount; i++) {
      const seated = this.players.find((p) => p.seat === i && p.connected);
      if (seated) players.push({ name: seated.name, kind: 'human' });
      else players.push({ name: 'Garden AI', kind: 'ai', aiLevel: 'apprentice' });
    }
    this._session = new Session({
      mode: 'hosted',
      ruleset: this.ruleset,
      players,
      constraints: {},
    });
    this._session.on('state', () => this._broadcastSnapshot());
    this._session.on('over', (over) => this._finish(over));
    this.state = this._session.state;
    this.config.players = players;
    this.phase = 'active';
    this._socket?.send({ t: 'start', ruleset: this.ruleset, players: players.map((p) => p.name) });
    this._armDeadline();
    this._broadcastSnapshot();
    this.emit('state', this.state);
    return { ok: true };
  }

  connect() {
    if (this._socket) return;
    this._socket = this.platform.openRoomSocket(this.roomId, {
      onOpen: () => {
        if (!this.isHost && this._guestName) this._socket.send({ t: 'hello', name: this._guestName });
        if (this.isHost) this._broadcastLobby();
      },
      onMessage: ({ control, msg }) => {
        if (control) return this._onControl(control);
        if (msg) this._onFrame(msg);
      },
      onClose: () => {
        for (const p of this.players) p.connected = false;
        this.emit('players', this.players);
      },
    });
  }

  leave() {
    this._deadlineTimer && clearTimeout(this._deadlineTimer);
    this._deadlineTimer = null;
    this._socket?.close();
    this._socket = null;
    this.platform.leaveRoom(this.roomId).catch(() => {});
  }

  _onControl(control) {
    // Server-side roster/presence pushes.
    if (control.type === 'roster' || control.type === 'participants') {
      const list = control.players || control.participants || [];
      this.players = list.map((p, i) => ({
        seat: typeof p.seat === 'number' ? p.seat : i,
        name: p.name || p.displayName || `Seat ${i + 1}`,
        connected: p.connected !== false,
        rating: p.rating ?? '—',
      }));
      if (this.phase === 'lobby') this.emit('players', this.players);
    }
  }

  _onFrame(msg) {
    switch (msg.t) {
      case 'hello': // host only: a guest announced themselves in the lobby
        if (!this.isHost || this.phase !== 'lobby') return;
        this._upsertGuest(msg);
        this._broadcastLobby();
        break;
      case 'lobby':
        this.players = (msg.players || []).map((p, i) => ({ seat: p.seat ?? i, name: p.name, connected: p.connected !== false, rating: p.rating ?? '—' }));
        if (this.phase === 'lobby') this.emit('players', this.players);
        break;
      case 'start':
        this.phase = 'active';
        break;
      case 'snap':
        this._applySnapshot(msg);
        break;
      case 'input': // host only: a guest's action
        if (this.isHost) this._applyGuestInput(msg);
        break;
      case 'chat':
        if (this.isHost && msg.from == null) {
          // Guest frames arrive guest→host; relay to everyone with attribution.
          const seat = typeof msg.seat === 'number' ? msg.seat : null;
          const name = this.players.find((p) => p.seat === seat)?.name || 'guest';
          this._socket?.send({ t: 'chat', from: name, text: String(msg.text || '').slice(0, 200) });
          return;
        }
        this._pushChat({ from: msg.from || 'table', text: String(msg.text || '').slice(0, 200), at: Date.now() });
        break;
      case 'over':
        if (!this.result && this.state) {
          this.result = this._shapeResult(msg.result || {});
          this.phase = 'over';
          this.emit('over', this.result);
        }
        break;
      default:
        break;
    }
  }

  _upsertGuest(msg) {
    const existing = this.players.find((p) => p.name === msg.name);
    if (!existing) {
      // lowest free seat
      const taken = new Set(this.players.map((p) => p.seat));
      let seat = 1;
      while (taken.has(seat)) seat++;
      this.players.push({ seat, name: msg.name || `Seat ${seat + 1}`, connected: true, rating: '—' });
    } else {
      existing.connected = true;
    }
  }

  _broadcastLobby() {
    this._socket?.send({ t: 'lobby', players: this.players });
    this.emit('players', this.players);
  }

  _broadcastSnapshot() {
    if (!this._session) return;
    this.state = this._session.state;
    this._socket?.send({
      t: 'snap',
      state: serialize(this.state),
      players: this.state.players.map((p) => ({ name: p.name, kind: p.kind })),
    });
  }

  _armDeadline() {
    if (this._deadlineTimer) clearTimeout(this._deadlineTimer);
    this._deadlineTimer = null;
    if (!this.turnDeadlineMs || !this._session || this._session.over) return;
    this._deadlineTimer = setTimeout(() => {
      const turn = this._session.state.turn;
      this._session.submit({ type: 'timeout', player: turn, commandId: `${this.roomId}:deadline:${this._session.state.ply}` }, turn);
      this._armDeadline();
    }, this.turnDeadlineMs);
  }

  _applyGuestInput(msg) {
    if (!this._session || this._session.over) return;
    const seat = typeof msg.seat === 'number' ? msg.seat : null;
    const action = msg.action || {};
    if (!action.commandId) action.commandId = `${this.roomId}:${seat}:${this._session.state.ply}:${counter++}`;
    const res = this._session.submit(action, seat);
    if (!res.ok) {
      this._socket?.send({ t: 'chat', from: 'table', text: `Move rejected: ${res.reason}` });
      return;
    }
    this._armDeadline();
  }

  _finish(over) {
    this.result = this._shapeResult(over);
    this.phase = 'over';
    this._socket?.send({ t: 'over', result: over });
    this.platform.submitRoomResult(this.roomId, {
      winner: over.winner,
      reason: over.reason,
      plies: over.plies,
      breakdowns: over.breakdowns,
    }).catch(() => {});
    this.emit('over', this.result);
  }

  _shapeResult(over) {
    return {
      winner: over.winner ?? null,
      reason: over.reason || 'completed',
      reasonText: this.state ? terminalReasonText(this.state) : (over.reason || ''),
      plies: over.plies ?? this.state?.ply ?? 0,
      breakdowns: over.breakdowns || [],
      ratingChanges: over.ratingChanges || null,
      sessionId: this.roomId,
      assistsUsed: false,
      invalids: over.invalids || {},
      elapsedMs: over.elapsedMs ?? null,
    };
  }

  _applySnapshot(msg) {
    const prevState = this.state;
    const prevPly = prevState?.ply ?? -1;
    if (msg.players) {
      this.players = msg.players.map((p, i) => ({ seat: i, name: p.name, connected: true, rating: '—' }));
    }
    if (msg.state) {
      this.state = typeof msg.state === 'string' ? deserialize(msg.state) : msg.state;
      this.config.ruleset = this.state.ruleset;
      this.config.players = this.state.players.map((p) => ({ name: p.name, kind: p.kind }));
      this.phase = 'active';
    }
    if (this.state && prevState && this.state.ply > prevPly) {
      // replay the new log entries as discrete actions for animation/audio
      const entries = this.state.log.slice(prevPly);
      for (const e of entries) {
        const action = e.t === 'm'
          ? { type: 'move', piece: e.p, path: e.path, captures: e.caps, crowns: !!e.cr, from: null }
          : e.t === 'resign' ? { type: 'resign', player: e.pl }
          : e.t === 'timeout' ? { type: 'timeout', player: e.pl }
          : e.t === 'offer' ? { type: 'offerDraw', player: e.pl }
          : e.t === 'accept' ? { type: 'acceptDraw', player: e.pl }
          : { type: 'declineDraw', player: e.pl };
        if (action.type === 'move') {
          const piece = prevState.pieces[action.piece];
          action.from = piece ? [piece.r, piece.c] : null;
        }
        const description = describeAction(prevState, action);
        this.emit('action', { action, description, remote: true });
      }
      if (this.state.ply - prevPly > 1) {
        this.emit('announce', { text: `While you were away, ${this.state.ply - prevPly} ${this.state.ply - prevPly === 1 ? 'move was' : 'moves were'} played.` });
      }
    }
    this.emit('state', this.state);
  }

  _pushChat(m) {
    this.chatLog.push(m);
    this.emit('chat', m);
  }

  get turn() { return this.state?.turn ?? 0; }
  isMyTurn() { return this.state && this.state.phase === 'active' && this.state.turn === this.seat; }
  currentPlayer() { return this.state?.players[this.state.turn]; }
  isAiTurn() { return false; } // hosted AI seats are driven by the host
  legalTargets() { return this.state ? legalActions(this.state) : []; }
  canUndo() { return false; }
  canHint() { return false; }
  assistsUsed() { return false; }

  async submit(action) {
    if (!this.state) return { ok: false, reason: 'not-connected' };
    if (!action.commandId) action.commandId = `${this.roomId}:${this.seat}:${this.state.ply}:${counter++}`;
    if (this.isHost) {
      // The host applies locally and broadcasts via the session state hook.
      if (!this._session) return { ok: false, reason: 'not-started' };
      const res = this._session.submit(action, this.seat);
      if (!res.ok) {
        this.emit('invalid', { reason: res.reason, message: res.reason, action });
        return { ok: false, reason: res.reason };
      }
      this._armDeadline();
      return { ok: true };
    }
    const sent = this._socket?.send({ t: 'input', seat: this.seat, action });
    if (!sent) {
      this.emit('invalid', { reason: 'not-connected', message: 'not-connected', action });
      return { ok: false, reason: 'not-connected' };
    }
    return { ok: true };
  }

  async sendChat(text) {
    const clean = String(text || '').slice(0, 200);
    if (this.isHost) {
      this._socket?.send({ t: 'chat', from: this.hostName || 'host', text: clean });
      return { ok: true };
    }
    // Guest frames travel guest→host; the host relays them with attribution.
    const sent = this._socket?.send({ t: 'chat', seat: this.seat, text: clean });
    return { ok: !!sent };
  }

  async reportPlayer() {
    // No rooms equivalent for player reports; keep an honest unsupported.
    return { ok: false, error: 'reports are not available on hosted tables' };
  }

  stats() {
    return this.state ? playerStats(this.state) : null;
  }

  pause() { /* hosted clock keeps running per rules */ }
  resume() { /* snapshots resume automatically on the socket */ }
  destroy() { this.leave(); }
}
