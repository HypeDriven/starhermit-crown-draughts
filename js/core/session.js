// Session: owns one live round. All rules mutation goes through validated
// commands; consumers receive immutable snapshots plus events. Handles the AI
// driver, clocks, undo, hints, draw offers, snapshots for resume/reconnect,
// replay envelopes, and goal evaluation for the mode layers.

import {
  createGame, apply, serialize, deserialize, hashState, legalActions,
  validateAction, scoreBreakdown, describeAction, terminalReasonText,
  ENGINE_VERSION, INVALID_REASON_TEXT,
} from '../rules/engine.js';
import { chooseAction, hintAction, AI_LEVELS, evaluate } from '../rules/ai.js';
import { createRng } from '../rules/rng.js';
import { CONTENT_SCHEMA_VERSION } from '../content/index.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Emitter {
  constructor() { this.map = new Map(); }
  on(event, fn) {
    if (!this.map.has(event)) this.map.set(event, new Set());
    this.map.get(event).add(fn);
    return () => this.map.get(event)?.delete(fn);
  }
  emit(event, ...args) {
    for (const fn of this.map.get(event) || []) {
      try { fn(...args); } catch (e) { console.error(`listener error on ${event}:`, e); }
    }
  }
}

let commandCounter = 0;

export class Session extends Emitter {
  /**
   * config: { mode, ruleset, seed, setup?, players:[{name,kind,aiLevel?}],
   *           contentId?, goal?, par?, constraints?, ranked?, theme?, lessonStep? }
   */
  constructor(config) {
    super();
    this.config = config;
    this.id = `s-${Date.now().toString(36)}-${(commandCounter++).toString(36)}`;
    this.state = createGame({
      ruleset: config.ruleset,
      seed: config.seed,
      setup: config.setup || undefined,
      players: config.players,
      contentId: config.contentId,
      contentVersion: CONTENT_SCHEMA_VERSION,
      createdAtUtc: new Date().toISOString(),
    });
    this.commands = [];              // ordered applied commands {id, action}
    this.hashes = [hashState(this.state)];
    this.initialHash = this.hashes[0];
    this.seenCommandIds = new Set();
    this.undoStack = [];             // serialized prior states
    this.assists = { hints: 0, undos: 0 };
    this.startedAt = Date.now();
    this.activeMs = 0;               // excludes paused time
    this.lastResume = now();
    this.paused = false;
    this.over = null;                // result object once finished
    this.clock = null;               // per-player remaining ms when constrained
    this._clockTimer = null;
    this._aiTimer = null;
    this._aiThinking = false;
    if (config.constraints?.clockMs) {
      this.clock = this.state.players.map(() => config.constraints.clockMs);
      this._startClock();
    }
    this._maybeDriveAi();
  }

  // --- queries ---------------------------------------------------------------

  get turn() { return this.state.turn; }
  get phase() { return this.state.phase; }
  currentPlayer() { return this.state.players[this.state.turn]; }
  isAiTurn() { return this.phase === 'active' && this.currentPlayer()?.kind === 'ai'; }
  assistsUsed() { return this.assists.hints > 0 || this.assists.undos > 0; }
  elapsedMs() {
    return this.activeMs + (this.paused ? 0 : now() - this.lastResume);
  }
  legalTargets() { return legalActions(this.state); }

  // --- command pipeline -------------------------------------------------------

  /**
   * Submit a command. `seat` identifies the local player acting (for hosted
   * games the server enforces seat binding; locally we enforce turn binding).
   * Returns { ok, reason?, description? }.
   */
  submit(action, seat = null) {
    if (this.over) return { ok: false, reason: 'game-over' };
    const commandId = action.commandId || `${this.id}:${this.commands.length}:${Math.floor(now())}`;
    if (this.seenCommandIds.has(commandId)) {
      return { ok: true, duplicate: true }; // idempotent re-delivery
    }
    // Seat binding: a local human may only act for the side to move.
    if (seat != null && this.state.players[seat] && this.state.players[seat].kind !== 'ai') {
      const owner = action.type === 'move' ? this.state.pieces[action.piece]?.owner : action.player;
      if (owner !== undefined && owner !== seat) return { ok: false, reason: 'not-your-turn' };
      if (this.state.turn !== seat && ['move', 'resign', 'offerDraw'].includes(action.type)) {
        return { ok: false, reason: 'not-your-turn' };
      }
    }
    const check = validateAction(this.state, action);
    if (!check.ok) {
      this.state.invalids[this.state.turn] = (this.state.invalids[this.state.turn] || 0) + 1;
      this.emit('invalid', { reason: check.reason, message: INVALID_REASON_TEXT[check.reason] || check.reason, action });
      return { ok: false, reason: check.reason };
    }
    const before = this.state;
    this.undoStack.push(serialize(before));
    if (this.undoStack.length > 400) this.undoStack.shift();
    this.seenCommandIds.add(commandId);
    this.state = apply(this.state, check.resolved || action);
    const entry = { id: commandId, action: check.resolved || action };
    this.commands.push(entry);
    this.hashes.push(hashState(this.state));
    const description = describeAction(before, entry.action);
    this.emit('action', { action: entry.action, description, before, after: this.state });
    this.emit('state', this.state);
    this._saveSnapshot();
    if (this.state.phase === 'over') {
      this._finish();
    } else {
      this._maybeAnswerDrawOffer(entry.action, before);
      this._checkMoveLimit();
      this._maybeDriveAi();
    }
    return { ok: true, description };
  }

  _checkMoveLimit() {
    const maxPlies = this.config.goal?.maxPlies;
    if (!maxPlies || this.state.phase !== 'active') return;
    if (this.state.ply >= maxPlies) {
      // The human side failed to win within the limit.
      this._forceEnd(null, 'move-limit-failed');
    }
  }

  _forceEnd(winner, reason) {
    this.state.phase = 'over';
    this.state.result = {
      winner, reason, ply: this.state.ply,
      eliminated: this.state.players.filter((p) => p.eliminated).map((p) => p.id),
      stats: null,
    };
    this._finish();
  }

  // --- AI ---------------------------------------------------------------------

  _maybeDriveAi() {
    if (this.paused || this.over) return;
    if (!this.isAiTurn()) return;
    if (this._aiTimer) return;
    const player = this.currentPlayer();
    const level = AI_LEVELS[player.aiLevel] ? player.aiLevel : 'apprentice';
    this._aiThinking = true;
    this.emit('ai-thinking', { player: player.id });
    // Small delay so the human perceives the turn change; search runs async.
    const delay = this.config.aiDelayMs ?? (350 + Math.floor(Math.random() * 300));
    this._aiTimer = setTimeout(() => {
      this._aiTimer = null;
      if (this.paused || this.over || !this.isAiTurn()) { this._aiThinking = false; return; }
      const rng = createRng((this.state.streams.rules ^ (this.state.ply * 0x9e3779b9)) >>> 0);
      const t0 = now();
      const choice = chooseAction(this.state, { level }, rng);
      this._aiThinking = false;
      if (!choice) return;
      const thinkMs = Math.round(now() - t0);
      this.emit('ai-decided', { player: player.id, thinkMs });
      this.submit({ ...choice.action, commandId: `${this.id}:ai:${this.state.ply}` }, player.id);
    }, 350 + Math.floor(Math.random() * 300));
  }

  _maybeAnswerDrawOffer(action, before) {
    // If a human offered a draw and an AI is now to respond, resolve it.
    if (this.state.phase !== 'active' || !this.state.pendingDraw) return;
    const responder = this.state.players[this.state.turn];
    if (!responder || responder.kind !== 'ai') return;
    const offered = this.state.pendingDraw.by;
    if (responder.id === offered) return;
    const score = evaluate(this.state); // from responder's perspective
    if (score <= -400) {
      this.emit('announce', { text: `${responder.name} accepts the draw.` });
      this.submit({ type: 'acceptDraw', player: responder.id }, responder.id);
    } else {
      this.emit('announce', { text: `${responder.name} declines the draw.` });
      this.submit({ type: 'declineDraw', player: responder.id }, responder.id);
    }
  }

  // --- undo & hints -------------------------------------------------------------

  canUndo() {
    if (this.config.constraints?.noUndo) return false;
    if (!['practice', 'lesson', 'journey'].includes(this.config.mode)) return false;
    return this.undoStack.length > 0 && !this.over;
  }

  /** Undo back to the last point where a local human is (or was) to move. */
  undo() {
    if (!this.canUndo()) return { ok: false, reason: 'undo-unavailable' };
    let steps = 0;
    while (this.undoStack.length) {
      const prev = deserialize(this.undoStack.pop());
      this.state = prev;
      steps += 1;
      this.commands.pop();
      this.hashes.pop();
      const pl = this.state.players[this.state.turn];
      if (this.state.phase === 'over' || pl?.kind !== 'ai') break;
    }
    if (steps) {
      this.assists.undos += 1;
      this.emit('state', this.state);
      this.emit('announce', { text: 'Undone.' });
      this._saveSnapshot();
    }
    return { ok: true, steps };
  }

  canHint() {
    if (this.config.constraints?.noHints) return false;
    return !this.over && this.phase === 'active' && !this.isAiTurn();
  }

  hint() {
    if (!this.canHint()) return { ok: false, reason: 'hint-unavailable' };
    const rng = createRng((this.state.streams.rules ^ 0x51f15e) >>> 0);
    const choice = hintAction(this.state, rng);
    if (!choice) return { ok: false, reason: 'no-moves' };
    this.assists.hints += 1;
    this.emit('hint', { action: choice.action, description: describeAction(this.state, choice.action) });
    return { ok: true, action: choice.action };
  }

  // --- clocks -------------------------------------------------------------------

  _startClock() {
    this._clockLast = now();
    this._clockTimer = setInterval(() => {
      if (this.paused || this.over) { this._clockLast = now(); return; }
      const t = now();
      const dt = t - this._clockLast;
      this._clockLast = t;
      if (this.state.phase !== 'active') return;
      const cur = this.state.turn;
      if (this.state.players[cur]?.kind === 'ai') { this.emit('clock', this.clock); return; }
      this.clock[cur] = Math.max(0, this.clock[cur] - dt);
      this.emit('clock', this.clock);
      if (this.clock[cur] <= 0) {
        this.emit('announce', { text: `${this.state.players[cur].name}'s time has run out.` });
        this.submit({ type: 'timeout', player: cur }, cur);
      }
    }, 200);
  }

  // --- pause / resume -------------------------------------------------------------

  pause(reason = 'manual') {
    if (this.paused) return;
    this.paused = true;
    this.activeMs += now() - this.lastResume;
    if (this._aiTimer) { clearTimeout(this._aiTimer); this._aiTimer = null; this._aiThinking = false; }
    this.emit('paused', { reason });
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.lastResume = now();
    this._clockLast = now();
    this.emit('resumed', {});
    this._maybeDriveAi();
  }

  destroy() {
    if (this._clockTimer) clearInterval(this._clockTimer);
    if (this._aiTimer) clearTimeout(this._aiTimer);
    this.paused = true;
    this.map.clear();
  }

  // --- finish & results -------------------------------------------------------------

  _finish() {
    this.activeMs += now() - this.lastResume;
    if (this._clockTimer) { clearInterval(this._clockTimer); this._clockTimer = null; }
    const st = this.state;
    const r = st.result;
    const elapsedMs = Math.round(this.elapsedMs());
    const breakdowns = st.players.map((pl) => scoreBreakdown(st, pl.id, {
      par: this.config.par, elapsedMs,
      timeTargetMs: this.config.constraints?.timeTargetMs,
    }));
    // Challenge goal evaluation beyond raw win/loss
    let goalMet = null;
    if (this.config.goal && r.winner !== null) {
      const humanWinner = st.players[r.winner]?.kind === 'human';
      goalMet = humanWinner;
      if (goalMet && Number.isFinite(this.config.goal.maxLost)) {
        const lost = st.pieces.filter((p) => p.captured && p.owner === r.winner).length;
        if (lost > this.config.goal.maxLost) goalMet = false;
      }
    }
    this.over = {
      winner: r.winner,
      reason: r.reason,
      reasonText: terminalReasonText(st),
      plies: st.ply,
      elapsedMs,
      breakdowns,
      assistsUsed: this.assistsUsed(),
      invalids: { ...st.invalids },
      goalMet,
      sessionId: this.id,
    };
    this.emit('over', this.over);
    this._saveSnapshot();
  }

  // --- snapshot / restore / replay --------------------------------------------------

  _saveSnapshot() {
    this.emit('snapshot-request', this.snapshot());
  }

  snapshot() {
    return {
      sessionId: this.id,
      config: this.config,
      state: serialize(this.state),
      commands: this.commands,
      hashes: this.hashes,
      undoDepth: this.undoStack.length,
      undoStack: this.undoStack.slice(-40),
      assists: this.assists,
      activeMs: this.activeMs + (this.paused ? 0 : now() - this.lastResume),
      clock: this.clock,
      over: this.over,
      savedAt: new Date().toISOString(),
      plyAtSave: this.state.ply,
    };
  }

  /** Restore from a snapshot. Returns a "while you were away" summary. */
  static restore(snap) {
    const s = new Session(snap.config);
    s.id = snap.sessionId;
    s.state = deserialize(snap.state);
    s.commands = snap.commands || [];
    s.hashes = snap.hashes || [hashState(s.state)];
    s.seenCommandIds = new Set(s.commands.map((c) => c.id));
    s.undoStack = snap.undoStack || [];
    s.assists = snap.assists || { hints: 0, undos: 0 };
    s.activeMs = snap.activeMs || 0;
    s.clock = snap.clock || null;
    s.over = snap.over || null;
    s.lastResume = now();
    if (s.clock && !s.over) s._startClock();
    const away = {
      pliesSince: 0,
      over: !!s.over,
      resumedAtPly: s.state.ply,
      savedAt: snap.savedAt,
    };
    if (!s.over) s._maybeDriveAi();
    return { session: s, away };
  }

  /** Replay envelope per spec: schema, versions, seed, hashes, result. */
  replayEnvelope() {
    return {
      schema: 1,
      engineVersion: ENGINE_VERSION,
      contentVersion: CONTENT_SCHEMA_VERSION,
      ruleset: this.config.ruleset,
      seed: this.config.seed,
      setup: this.config.setup || null,
      players: this.config.players.map((p) => ({ name: p.name, kind: p.kind, aiLevel: p.aiLevel })),
      initialHash: this.initialHash,
      startedAt: new Date(this.startedAt).toISOString(),
      commands: this.commands.map((c) => ({ id: c.id, action: c.action })),
      hashes: this.hashes,
      result: this.over ? {
        winner: this.over.winner, reason: this.over.reason, plies: this.over.plies,
        totals: this.over.breakdowns.map((b) => b.total),
      } : null,
    };
  }
}

/** Verify a replay envelope: re-apply every command, compare all hashes. */
export function verifyReplay(envelope) {
  try {
    let s = createGame({
      ruleset: envelope.ruleset,
      seed: envelope.seed,
      setup: envelope.setup || undefined,
      players: envelope.players,
    });
    if (hashState(s) !== envelope.initialHash) return { ok: false, at: -1, reason: 'initial hash mismatch' };
    for (let i = 0; i < envelope.commands.length; i++) {
      const v = validateAction(s, envelope.commands[i].action);
      if (!v.ok) return { ok: false, at: i, reason: `illegal command: ${v.reason}` };
      s = apply(s, v.resolved || envelope.commands[i].action);
      if (envelope.hashes[i + 1] && hashState(s) !== envelope.hashes[i + 1]) {
        return { ok: false, at: i, reason: 'state hash mismatch' };
      }
    }
    return { ok: true, terminal: s.phase === 'over', result: s.result };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
