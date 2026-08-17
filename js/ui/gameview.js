// GameController: the in-round experience. Binds the rules session to the
// renderer, the semantic DOM board, HUD, and input. Handles selection,
// chains, drag, invalid-action explanation, clocks, pause, and results.

import { legalActionsForPiece, squareName, INVALID_REASON_TEXT } from '../rules/engine.js';
import { lessonGoalMet } from '../content/lessons.js';

export class GameController {
  /**
   * app: the App orchestrator. session: Session | HostedSessionClient.
   * opts: { lesson?, onExit, onOver }
   */
  constructor(app, session, opts = {}) {
    this.app = app;
    this.session = session;
    this.opts = opts;
    this.lesson = opts.lesson || null;
    this.lessonStepIndex = opts.lessonStepIndex || 0;
    this.selected = null;          // pieceId
    this.chainPrefix = [];         // squares committed in an in-progress chain
    this.candidates = [];          // actions consistent with the prefix
    this.hover = null;
    this.busy = false;             // input lock during resolution/animation
    this.skipRequested = false;
    this.lastMove = null;
    this._drag = null;
    this._unsubs = [];
    this._bindSession();
    this._bindCanvas();
  }

  get state() { return this.session.state; }
  get size() { return this.state?.size || 8; }

  // --- session wiring -------------------------------------------------------

  _bindSession() {
    const s = this.session;
    this._unsubs.push(s.on('state', (st) => this._onState(st)));
    this._unsubs.push(s.on('action', (ev) => this._onAction(ev)));
    this._unsubs.push(s.on('invalid', (ev) => this._onInvalid(ev)));
    this._unsubs.push(s.on('over', (over) => this._onOver(over)));
    this._unsubs.push(s.on('hint', (ev) => this._onHint(ev)));
    this._unsubs.push(s.on('clock', (clock) => this.app.ui.updateClocks(clock, this.state?.turn)));
    this._unsubs.push(s.on('ai-thinking', () => this.app.ui.setThinking(true)));
    this._unsubs.push(s.on('ai-decided', () => this.app.ui.setThinking(false)));
    this._unsubs.push(s.on('announce', (ev) => this.app.ui.announce(ev.text)));
    this._unsubs.push(s.on('chat', (m) => this.app.ui.addChatMessage(m)));
    this._unsubs.push(s.on('snapshot-request', (snap) => this.app.saveSnapshot(snap)));
  }

  _bindCanvas() {
    const canvas = this.app.renderer.canvas;
    if (!canvas) return;
    this._onPointerDown = (e) => this._pointerDown(e);
    this._onPointerMove = (e) => this._pointerMove(e);
    this._onPointerUp = (e) => this._pointerUp(e);
    this._onPointerCancel = () => { this._drag = null; };
    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointermove', this._onPointerMove);
    canvas.addEventListener('pointerup', this._onPointerUp);
    canvas.addEventListener('pointercancel', this._onPointerCancel);
  }

  destroy() {
    for (const u of this._unsubs) u();
    const canvas = this.app.renderer?.canvas;
    if (canvas && this._onPointerDown) {
      canvas.removeEventListener('pointerdown', this._onPointerDown);
      canvas.removeEventListener('pointermove', this._onPointerMove);
      canvas.removeEventListener('pointerup', this._onPointerUp);
      canvas.removeEventListener('pointercancel', this._onPointerCancel);
    }
  }

  // --- initial sync -----------------------------------------------------------

  begin() {
    this.app.renderer.loadState(this.state, { snap: true, seed: this.session.config?.seed || 1 });
    this._onState(this.state, { first: true });
  }

  _onState(st, { first = false } = {}) {
    if (!first) {
      // renderer already animates from 'action'; ensure final truth matches
      this.app.renderer.syncState(st);
    }
    this._refreshSelection(false);
    this._updateHud();
    this.app.domBoard.setState(st);
    this._syncDomTargets();
  }

  _onAction({ action, description, remote }) {
    const audio = this.app.audio;
    if (action.type === 'move') {
      if (action.captures.length) audio.capture(); else audio.move();
      if (action.crowns) audio.crown();
      if (action.captures.length && this.app.settings.accessibility.haptics) {
        try { navigator.vibrate?.(30); } catch { /* unsupported */ }
      }
      const dur = this.app.renderer.playAction(action, this.state, {
        skip: this.skipRequested,
      });
      this.skipRequested = false;
      this.busy = true;
      clearTimeout(this._busyT);
      this._busyT = setTimeout(() => { this.busy = false; this._refreshSelection(); }, Math.min(dur * 1000, 900));
      this.lastMove = {
        from: `${action.from[0]},${action.from[1]}`,
        to: `${action.path.at(-1)[0]},${action.path.at(-1)[1]}`,
      };
      const pl = this.state.players[action.piece !== undefined ? this._moverOf(action) : 0];
      this.app.ui.addLogEntry(description);
      this.app.ui.announce(description);
      if (this.lesson) this._checkLessonGoal(action);
      // clear selection if it was ours
      this.selected = null;
      this.chainPrefix = [];
      this.candidates = [];
    } else {
      this.app.ui.addLogEntry(description);
      this.app.ui.announce(description);
    }
    this.app.audio.turn();
    this._updateHud();
  }

  _moverOf(action) {
    // after application, the piece's owner is the mover
    return this.state.pieces[action.piece]?.owner ?? 0;
  }

  _onInvalid({ reason, message }) {
    this.app.audio.invalid();
    this.app.ui.toast(message || INVALID_REASON_TEXT[reason] || 'Not legal', 'warn');
    this.app.ui.announce(message || 'That move is not legal', true);
    const v = this.selected != null ? this.app.renderer.board?.pieces.get(this.selected) : null;
    if (v) v.wobble = 1;
  }

  _onHint({ action, description }) {
    this.app.audio.hint();
    const piece = this.state.pieces[action.piece];
    this.app.ui.toast(`Hint: ${description}`, 'info', 4000);
    this.app.ui.announce(`Hint: ${description}`);
    // flash the piece and its destination
    this._selectPiece(action.piece);
  }

  _onOver(over) {
    this.app.renderer.roundEndFx();
    const mine = over.winner;
    const humanSeats = this.session.config.players?.map((p, i) => ({ p, i })).filter((x) => x.p.kind === 'human') || [];
    const iWon = humanSeats.some((h) => h.i === over.winner);
    if (over.winner === null) this.app.audio.draw();
    else if (iWon) this.app.audio.win();
    else this.app.audio.lose();
    this.opts.onOver?.(over);
  }

  // --- lesson flow -----------------------------------------------------------

  currentLessonStep() {
    return this.lesson?.steps[this.lessonStepIndex] || null;
  }

  _checkLessonGoal(action) {
    const step = this.currentLessonStep();
    if (!step || !step.goal || this._lessonDone) return;
    // find the action in the before-state: session emitted 'action' after apply;
    // lessonGoalMet needs stateBefore — we stashed it on the action event
    const before = this._lastBefore || this.state;
    if (lessonGoalMet(step.goal, action, before, this.state)) {
      this._lessonDone = true;
      this.app.ui.lessonStepComplete(step);
    } else if (step.goal.kind !== 'finish' && step.goal.kind !== 'finish-win') {
      // wrong move for the lesson: rewind politely
      this.app.ui.toast('That works, but it is not what this lesson is about — try the shown move.', 'warn');
    }
  }

  advanceLessonStep() {
    this._lessonDone = false;
    this.lessonStepIndex += 1;
    return this.currentLessonStep();
  }

  // --- interaction -----------------------------------------------------------

  _canAct() {
    if (this.busy || !this.state || this.state.phase !== 'active') return false;
    if (this.session.isAiTurn?.()) return false;
    if (this.session.isMyTurn && !this.session.isMyTurn()) return false;
    return true;
  }

  /** Unified cell press from canvas pick or DOM board. */
  onCell(r, c) {
    if (!this._canAct()) return;
    const st = this.state;
    const piece = st.pieces.find((p) => !p.captured && p.r === r && p.c === c);
    // completing a chain step / move target?
    if (this.selected != null) {
      const next = this._nextSteps().get(`${r},${c}`);
      if (next) {
        this._advanceChain(r, c);
        return;
      }
      if (piece && piece.owner === st.turn) {
        this._selectPiece(piece.id);
        return;
      }
      // pressed something else — explain why nothing happens
      const reason = piece ? 'not-your-piece' : 'illegal-target';
      this._onInvalid({ reason, message: INVALID_REASON_TEXT[reason] });
      return;
    }
    if (piece && piece.owner === st.turn) {
      this._selectPiece(piece.id);
      return;
    }
    if (piece) {
      this._onInvalid({ reason: 'not-your-piece', message: INVALID_REASON_TEXT['not-your-piece'] });
    }
  }

  _selectPiece(pieceId) {
    const st = this.state;
    const all = this.session.legalTargets();
    let actions = all.filter((a) => a.piece === pieceId);
    if (this.lesson) {
      const step = this.currentLessonStep();
      if (step?.allowPieces) {
        const p = st.pieces[pieceId];
        const allowed = step.allowPieces.some(([r, c]) => r === p.r && c === p.c);
        if (!allowed) {
          this._onInvalid({ reason: 'not-your-piece', message: 'This lesson asks you to move a different piece — it glows gold.' });
          return;
        }
      }
    }
    if (!actions.length) {
      const mustCapture = all.some((a) => a.captures.length > 0);
      this._onInvalid({
        reason: mustCapture ? 'must-capture' : 'illegal-target',
        message: mustCapture ? INVALID_REASON_TEXT['must-capture'] : 'That piece has no legal move.',
      });
      return;
    }
    this.selected = pieceId;
    this.chainPrefix = [];
    this.candidates = actions;
    this.app.audio.select();
    this._refreshSelection();
  }

  _nextSteps() {
    // map of "r,c" -> candidate actions, for the next chain step
    const map = new Map();
    for (const a of this.candidates) {
      if (a.path.length > this.chainPrefix.length) {
        const [r, c] = a.path[this.chainPrefix.length];
        const key = `${r},${c}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(a);
      }
    }
    return map;
  }

  _advanceChain(r, c) {
    this.chainPrefix.push([r, c]);
    this.candidates = this.candidates.filter((a) => {
      if (a.path.length < this.chainPrefix.length) return false;
      for (let i = 0; i < this.chainPrefix.length; i++) {
        if (a.path[i][0] !== this.chainPrefix[i][0] || a.path[i][1] !== this.chainPrefix[i][1]) return false;
      }
      return true;
    });
    const complete = this.candidates.filter((a) => a.path.length === this.chainPrefix.length);
    const longer = this.candidates.filter((a) => a.path.length > this.chainPrefix.length);
    if (complete.length === 1 && longer.length === 0) {
      // chain complete — commit
      const action = complete[0];
      this.selected = null;
      this.chainPrefix = [];
      this.candidates = [];
      this._stashBefore();
      this.session.submit({ ...action });
      this._refreshSelection();
      return;
    }
    if (longer.length > 0) {
      this.app.audio.move();
      this.app.ui.announce(`Chain continues — ${longer.length} follow-up ${longer.length === 1 ? 'jump' : 'jumps'} available.`);
      this.candidates = [...longer, ...complete.filter((a) => longer.length === 0)];
      this._refreshSelection();
      return;
    }
    // nothing matched — shouldn't happen (targets came from candidates)
    this._refreshSelection();
  }

  _stashBefore() {
    // keep the pre-submit state for lesson goal checks
    this._lastBefore = this.session.state;
  }

  cancelSelection() {
    if (this.selected != null) {
      this.selected = null;
      this.chainPrefix = [];
      this.candidates = [];
      this.app.audio.uiClick();
      this._refreshSelection();
      return true;
    }
    return false;
  }

  _refreshSelection(syncRender = true) {
    const piece = this.selected != null ? this.state?.pieces[this.selected] : null;
    const steps = this.selected != null ? this._nextSteps() : null;
    // renderer ghosts
    const ghostActions = [];
    if (steps) {
      for (const [key, acts] of steps) {
        const [r, c] = key.split(',').map(Number);
        ghostActions.push({ path: [[r, c]], captures: acts[0].captures.length || acts.some((a) => a.captures.length > this.chainPrefix.length) ? [1] : [] });
      }
    }
    if (syncRender) this.app.renderer.setSelection(this.selected, ghostActions.length ? ghostActions : null);
    // DOM targets
    this._syncDomTargets();
  }

  _syncDomTargets() {
    const steps = this.selected != null ? this._nextSteps() : new Map();
    this.app.domBoard.setInteraction(
      this.selected != null && this.state?.pieces[this.selected]
        ? [this.state.pieces[this.selected].r, this.state.pieces[this.selected].c]
        : null,
      steps,
      this.lastMove,
    );
  }

  // --- pointer (canvas) ----------------------------------------------------------

  _pointerDown(e) {
    if (!this._canAct()) return;
    this.app.audio.ensure();
    const cell = this.app.renderer.pickCell(e.clientX, e.clientY);
    this._drag = { start: cell, x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId };
    e.target.setPointerCapture?.(e.pointerId);
  }

  _pointerMove(e) {
    if (!this._drag) {
      // hover preview (never required, pointer only)
      if (this.app.renderer.ok && e.pointerType === 'mouse') {
        const cell = this.app.renderer.pickCell(e.clientX, e.clientY);
        const key = cell ? `${cell.r},${cell.c}` : null;
        if (key !== this._hoverKey) {
          this._hoverKey = key;
          this.app.renderer.setHover(cell);
        }
      }
      return;
    }
    const dx = e.clientX - this._drag.x;
    const dy = e.clientY - this._drag.y;
    if (Math.hypot(dx, dy) > 9) this._drag.moved = true; // drag threshold
  }

  _pointerUp(e) {
    const drag = this._drag;
    this._drag = null;
    if (!drag || !this._canAct()) return;
    const cell = this.app.renderer.pickCell(e.clientX, e.clientY);
    if (!cell) { this.cancelSelection(); return; }
    // tap or drag-end both resolve to a cell press; a drag that started on a
    // piece and ends elsewhere moves the selection flow forward too
    this.onCell(cell.r, cell.c);
  }

  // --- keyboard / gamepad -------------------------------------------------------

  handleAction(action) {
    const b = this.app.domBoard;
    switch (action) {
      case 'up': case 'down': case 'left': case 'right': {
        // keyboard/board navigation implies the semantic board — pin it visible
        const wrap = document.getElementById('dom-board-container');
        if (wrap && !wrap.classList.contains('pinned')) {
          wrap.classList.add('pinned');
          this.app.ui.announce('HTML board shown. Arrow keys move the cursor; Enter selects.');
        }
        if (action === 'up') b.moveCursor(1, 0);       // up = toward far edge (r+1)
        else if (action === 'down') b.moveCursor(-1, 0);
        else if (action === 'left') b.moveCursor(0, -1);
        else b.moveCursor(0, 1);
        return true;
      }
      case 'confirm': {
        const { r, c } = b.cursor;
        this.onCell(r, c);
        return true;
      }
      case 'cancel':
        if (this.cancelSelection()) return true;
        this.app.togglePause(true);
        return true;
      case 'pause': this.app.togglePause(); return true;
      case 'undo': this.requestUndo(); return true;
      case 'hint': this.requestHint(); return true;
      case 'camera': this.app.cycleCamera(); return true;
      case 'skip': this.skipRequested = true; this.app.renderer.board?.skipAll(this.state); return true;
      default: return false;
    }
  }

  requestUndo() {
    if (!this.session.canUndo?.()) {
      this.app.ui.toast('Undo is not available here.', 'warn');
      return;
    }
    const res = this.session.undo();
    if (res.ok) this.app.audio.undo();
  }

  requestHint() {
    if (!this.session.canHint?.()) {
      this.app.ui.toast('Hints are disabled for this round.', 'warn');
      return;
    }
    this.session.hint();
  }

  // --- HUD -----------------------------------------------------------------------

  _updateHud() {
    const st = this.state;
    if (!st) return;
    const me = this.session.seat ?? 0;
    this.app.ui.updateHud({
      state: st,
      session: this.session,
      config: this.session.config,
      canUndo: !!this.session.canUndo?.(),
      canHint: !!this.session.canHint?.(),
      mySeat: me,
      selected: this.selected,
    });
  }
}
