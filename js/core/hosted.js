// Hosted session client: mirrors the Session event surface over the network.
// WebSocket/SSE events give immediate updates; the REST session detail is the
// reconnect source of truth. Undo/hints are unavailable in hosted play.

import { Emitter } from './session.js';
import { deserialize, legalActions, describeAction, terminalReasonText, playerStats } from '../rules/engine.js';

let counter = 0;

export class HostedSessionClient extends Emitter {
  constructor(platform, info) {
    super();
    this.platform = platform;
    this.sessionId = info.sessionId;
    this.token = info.playerToken;
    this.seat = info.seat;
    this.joinCode = info.joinCode || null;
    this.state = null;
    this.phase = 'lobby';
    this.players = [];
    this.chatLog = [];
    this.result = null;
    this.version = -1;
    this.config = {
      mode: 'hosted',
      ruleset: info.ruleset || 'duel',
      constraints: {},
      players: [],
    };
    this._unsub = null;
  }

  static async create(platform, { ruleset, name, listed, clockMs }) {
    const res = await platform.createHostedSession({ ruleset, playerName: name, listed, clockMs });
    if (!res.ok) return { ok: false, error: res.error };
    const client = new HostedSessionClient(platform, res.data);
    return { ok: true, client };
  }

  static async join(platform, { sessionIdOrCode, name, joinCode }) {
    const res = await platform.joinHostedSession(sessionIdOrCode, { name, joinCode });
    if (!res.ok) return { ok: false, error: res.error };
    const client = new HostedSessionClient(platform, { ...res.data, ruleset: null });
    return { ok: true, client };
  }

  async refresh() {
    const res = await this.platform.getHostedSession(this.sessionId, this.token);
    if (!res.ok) return { ok: false, error: res.error };
    this._applySnapshot(res.data, { fresh: true });
    return { ok: true };
  }

  async startGame() {
    const res = await this.platform.api(`/api/v1/sessions/${this.sessionId}/start`, { method: 'POST', token: this.token });
    return res;
  }

  /** Connect the event stream (SSE with polling fallback handled by platform). */
  connect() {
    if (this._unsub) return;
    this._unsub = this.platform.subscribeSession(this.sessionId, this.token, (ev) => {
      if (ev.type === 'update' || ev.type === 'snapshot') {
        if (ev.data) this._applySnapshot(ev.data);
        else this.refresh();
      }
    });
  }

  leave() {
    this._unsub?.();
    this._unsub = null;
  }

  _applySnapshot(data, { fresh = false } = {}) {
    const prevState = this.state;
    const prevPly = prevState?.ply ?? -1;
    this.players = data.players;
    this.phase = data.phase;
    if (data.state) {
      this.state = typeof data.state === 'string' ? deserialize(data.state) : data.state;
      this.config.ruleset = this.state.ruleset;
      this.config.players = this.state.players.map((p) => ({ name: p.name, kind: 'human' }));
    }
    if (data.chat) {
      const newMsgs = data.chat.slice(this.chatLog.length);
      this.chatLog = data.chat;
      for (const m of newMsgs) this.emit('chat', m);
    }
    if (data.phase === 'lobby') {
      this.emit('players', data.players);
      return;
    }
    if (this.state && prevState && this.state.ply > prevPly) {
      // replay the new log entries as discrete actions for animation/audio
      const entries = this.state.log.slice(prevPly);
      let cursor = prevState;
      for (const e of entries) {
        const action = e.t === 'm'
          ? { type: 'move', piece: e.p, path: e.path, captures: e.caps, crowns: !!e.cr, from: null }
          : e.t === 'resign' ? { type: 'resign', player: e.pl }
          : e.t === 'timeout' ? { type: 'timeout', player: e.pl }
          : e.t === 'offer' ? { type: 'offerDraw', player: e.pl }
          : e.t === 'accept' ? { type: 'acceptDraw', player: e.pl }
          : { type: 'declineDraw', player: e.pl };
        if (action.type === 'move') {
          const piece = cursor.pieces[action.piece];
          action.from = [piece.r, piece.c];
        }
        const description = describeAction(cursor, action);
        this.emit('action', { action, description, remote: true });
        // advance cursor cheaply via validation-free apply
        cursor = this.state; // final state known; intermediate only used for text
      }
    }
    if (fresh && prevState && this.state.ply > prevPly) {
      this.emit('announce', { text: `While you were away, ${this.state.ply - prevPly} ${this.state.ply - prevPly === 1 ? 'move was' : 'moves were'} played.` });
    }
    this.emit('state', this.state);
    if (data.phase === 'over' && data.result && !this.result) {
      this.result = {
        winner: data.result.winner,
        reason: data.result.reason,
        reasonText: terminalReasonText(this.state),
        plies: data.result.plies,
        breakdowns: data.result.breakdowns,
        ratingChanges: data.result.ratingChanges,
        sessionId: this.sessionId,
        assistsUsed: false,
        invalids: {},
        elapsedMs: null,
      };
      this.emit('over', this.result);
    }
  }

  get turn() { return this.state?.turn ?? 0; }
  isMyTurn() { return this.state && this.state.phase === 'active' && this.state.turn === this.seat; }
  currentPlayer() { return this.state?.players[this.state.turn]; }
  isAiTurn() { return false; }
  legalTargets() { return this.state ? legalActions(this.state) : []; }
  canUndo() { return false; }
  canHint() { return false; }
  assistsUsed() { return false; }

  async submit(action) {
    if (!this.state) return { ok: false, reason: 'not-connected' };
    const commandId = `${this.sessionId}:${this.seat}:${this.state.ply}:${counter++}`;
    const res = await this.platform.submitHostedCommand(this.sessionId, this.token, { commandId, action });
    if (!res.ok) {
      this.emit('invalid', { reason: res.error, message: res.error, action });
      return { ok: false, reason: res.error };
    }
    return { ok: true };
  }

  async sendChat(text) {
    return this.platform.sendChat(this.sessionId, this.token, text);
  }

  async reportPlayer(playerSeat, reason) {
    return this.platform.report(this.sessionId, this.token, { playerSeat, reason });
  }

  stats() {
    return this.state ? playerStats(this.state) : null;
  }

  pause() { /* hosted clock keeps running per rules */ }
  resume() { this.refresh(); }
  destroy() { this.leave(); }
}
