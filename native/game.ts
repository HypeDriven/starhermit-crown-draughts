// GameController: the in-round experience (the browser build's
// js/ui/gameview.js). Binds the rules session (a local Session or a hosted
// table's client) to the renderer, the semantic board, the HUD and input;
// handles selection, chains, invalid-action explanations, hints, undo, clocks
// and the round's end. Pointer picks on the 3D board and presses on the
// semantic board both resolve to onCell(r, c).
import { describeAction, isPlayable } from "../js/rules/engine.js";
import { INVALID_REASON_TEXT } from "./data.ts";
import { lessonGoalMet } from "../js/content/lessons.js";
import { N, T } from "./i18n.ts";
import * as render from "./render.ts";
import * as audio from "./audio.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** What the controller needs from the app (js/ui/app.js's ui facade and services). */
export interface GameHost {
  toast(msg: string, kind?: string, ms?: number): void;
  announce(msg: string, assertive?: boolean): void;
  addLogEntry(entry: { text: string; render: (() => string) | null }): void;
  updateClocks(clock: number[] | null, turn: number): void;
  setThinking(v: boolean): void;
  addChatMessage(m: { from?: string; name?: string; text: string }): void;
  lessonStepComplete(step: Any): void;
  saveSnapshot(snap: Any): void;
  togglePause(force?: boolean): void;
  cycleCamera(): void;
  toggleBoard(): boolean;
  boardShown(): boolean;
  haptics(): boolean;
  vibrate(): void;
}

export class GameController {
  host: GameHost;
  session: Any;
  opts: { lesson?: Any; lessonStepIndex?: number; onOver?: (over: Any) => void };
  lesson: Any;
  lessonStepIndex: number;
  selected: number | null = null;
  chainPrefix: number[][] = [];
  candidates: Any[] = [];
  busy = false;
  skipRequested = false;
  lastMove: { from: string; to: string } | null = null;
  cursor = { r: 0, c: 1 };
  private busyTimer = 0;
  private unsubs: (() => void)[] = [];
  private lastBefore: Any = null;
  private lessonCheckPending = false;
  private lessonDone = false;

  constructor(host: GameHost, session: Any, opts: GameController["opts"] = {}) {
    this.host = host;
    this.session = session;
    this.opts = opts;
    this.lesson = opts.lesson || null;
    this.lessonStepIndex = opts.lessonStepIndex || 0;
    const s = session;
    this.unsubs.push(s.on("state", (st: Any) => this.onState(st)));
    this.unsubs.push(s.on("action", (ev: Any) => this.onAction(ev)));
    this.unsubs.push(s.on("invalid", (ev: Any) => this.onInvalid(ev)));
    this.unsubs.push(s.on("over", (over: Any) => this.onOver(over)));
    this.unsubs.push(s.on("hint", (ev: Any) => this.onHint(ev)));
    this.unsubs.push(s.on("clock", (clock: number[]) => this.host.updateClocks(clock, this.state?.turn)));
    this.unsubs.push(s.on("ai-thinking", () => this.host.setThinking(true)));
    this.unsubs.push(s.on("ai-decided", () => this.host.setThinking(false)));
    this.unsubs.push(s.on("announce", (ev: { text: string }) => this.host.announce(ev.text)));
    this.unsubs.push(s.on("chat", (m: Any) => this.host.addChatMessage(m)));
    this.unsubs.push(s.on("snapshot-request", (snap: Any) => this.host.saveSnapshot(snap)));
  }

  get state(): Any { return this.session.state; }
  get size(): number { return this.state?.size || 8; }

  destroy(): void {
    for (const u of this.unsubs) u();
    clearTimeout(this.busyTimer);
  }

  begin(): void {
    render.loadState(this.state, { snap: true });
    this.onState(this.state, true);
  }

  private onState(st: Any, first = false): void {
    if (!first) render.syncState(st);
    this.refreshSelection(false);
  }

  private onAction({ action, description, remote, before, after }: Any): void {
    if (action.type === "move") {
      if (action.captures.length >= 2) audio.play("multiJump");
      else if (action.captures.length) audio.play("capture");
      else audio.play("move");
      if (action.crowns) audio.play("crown");
      // A house leaving the court mid-round (melee): local sessions carry before/after snapshots.
      const elimBefore = before?.players?.filter((p: Any) => p.eliminated).length ?? 0;
      const elimAfter = after?.players?.filter((p: Any) => p.eliminated).length ?? elimBefore;
      if (elimAfter > elimBefore && after?.phase === "active") audio.play("houseFall");
      if (action.captures.length && this.host.haptics()) this.host.vibrate();
      const dur = render.playAction(action, this.state, { skip: this.skipRequested });
      this.skipRequested = false;
      this.busy = true;
      clearTimeout(this.busyTimer);
      this.busyTimer = setTimeout(() => { this.busy = false; this.refreshSelection(); }, Math.min(dur * 1000, 900));
      const last = action.path[action.path.length - 1];
      this.lastMove = { from: `${action.from[0]},${action.from[1]}`, to: `${last[0]},${last[1]}` };
      this.host.addLogEntry(this.logEntry(description, action, before));
      this.host.announce(description);
      // Only the player's own move is judged against the lesson goal.
      if (this.lesson && this.lessonCheckPending) {
        this.lessonCheckPending = false;
        this.checkLessonGoal(action);
      }
      this.selected = null;
      this.chainPrefix = [];
      this.candidates = [];
    } else {
      if (action.type === "offerDraw") audio.play("drawOffer");
      this.host.addLogEntry(this.logEntry(description, action, before));
      this.host.announce(description);
    }
    audio.play(remote ? "opponentTurn" : "turn");
  }

  private logEntry(text: string, action: Any, before: Any): { text: string; render: (() => string) | null } {
    return { text, render: before ? () => describeAction(before, action) : null };
  }

  onInvalid({ reason, message }: { reason: string; message?: string }): void {
    audio.play(reason === "must-capture" ? "mandatoryCapture" : "invalid");
    this.host.toast(T(message || INVALID_REASON_TEXT[reason] || N("Not legal")), "warn");
    this.host.announce(T(message || N("That move is not legal")), true);
  }

  private onHint({ action, description }: Any): void {
    audio.play("hint");
    this.host.toast(T("Hint: {move}", { move: description }), "info", 4000);
    this.host.announce(T("Hint: {move}", { move: description }));
    this.selectPiece(action.piece);
  }

  private onOver(over: Any): void {
    render.roundEndFx();
    const humanSeats = this.session.config.players?.map((p: Any, i: number) => ({ p, i })).filter((x: Any) => x.p.kind === "human") || [];
    const iWon = humanSeats.some((h: Any) => h.i === over.winner);
    if (over.winner === null) audio.play("draw");
    else if (iWon) audio.play("win");
    else if (["challenge", "journey"].includes(this.session.config?.mode)) audio.play("levelFail");
    else audio.play("lose");
    this.opts.onOver?.(over);
  }

  // --- lessons ---------------------------------------------------------------------
  currentLessonStep(): Any { return this.lesson?.steps[this.lessonStepIndex] || null; }

  private checkLessonGoal(action: Any): void {
    const step = this.currentLessonStep();
    if (!step || !step.goal || this.lessonDone) return;
    const before = this.lastBefore || this.state;
    if (lessonGoalMet(step.goal, action, before, this.state)) {
      this.lessonDone = true;
      this.host.lessonStepComplete(step);
    } else if (step.goal.kind !== "finish" && step.goal.kind !== "finish-win") {
      this.host.toast(T("That works, but it is not what this lesson is about — try the shown move."), "warn");
    }
  }

  // --- interaction ---------------------------------------------------------------------
  canAct(): boolean {
    if (this.busy || !this.state || this.state.phase !== "active") return false;
    if (this.session.isAiTurn?.()) return false;
    if (this.session.isMyTurn && !this.session.isMyTurn()) return false;
    return true;
  }

  /** A cell press from a 3D pick or the semantic board. */
  onCell(r: number, c: number): void {
    if (!this.canAct()) return;
    const st = this.state;
    this.cursor = { r, c };
    const piece = st.pieces.find((p: Any) => !p.captured && p.r === r && p.c === c);
    if (this.selected != null) {
      if (this.nextSteps().get(`${r},${c}`)) { this.advanceChain(r, c); return; }
      if (piece && piece.owner === st.turn) { this.selectPiece(piece.id); return; }
      const reason = piece ? "not-your-piece" : "illegal-target";
      this.onInvalid({ reason, message: INVALID_REASON_TEXT[reason] });
      return;
    }
    if (piece && piece.owner === st.turn) { this.selectPiece(piece.id); return; }
    if (piece) this.onInvalid({ reason: "not-your-piece", message: INVALID_REASON_TEXT["not-your-piece"] });
  }

  selectPiece(pieceId: number): void {
    const st = this.state;
    const all = this.session.legalTargets();
    const actions = all.filter((a: Any) => a.piece === pieceId);
    if (this.lesson) {
      const step = this.currentLessonStep();
      if (step?.allowPieces) {
        const p = st.pieces[pieceId];
        if (!step.allowPieces.some(([r, c]: number[]) => r === p.r && c === p.c)) {
          this.onInvalid({ reason: "not-your-piece", message: N("This lesson asks you to move a different piece — it glows gold.") });
          return;
        }
      }
    }
    if (!actions.length) {
      const mustCapture = all.some((a: Any) => a.captures.length > 0);
      this.onInvalid({
        reason: mustCapture ? "must-capture" : "illegal-target",
        message: mustCapture ? INVALID_REASON_TEXT["must-capture"] : N("That piece has no legal move."),
      });
      return;
    }
    this.selected = pieceId;
    this.chainPrefix = [];
    this.candidates = actions;
    audio.play("select");
    this.refreshSelection();
  }

  /** "r,c" → the candidate actions whose next chain step lands there. */
  nextSteps(): Map<string, Any[]> {
    const map = new Map<string, Any[]>();
    for (const a of this.candidates) {
      if (a.path.length > this.chainPrefix.length) {
        const [r, c] = a.path[this.chainPrefix.length];
        const key = `${r},${c}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(a);
      }
    }
    return map;
  }

  private advanceChain(r: number, c: number): void {
    this.chainPrefix.push([r, c]);
    this.candidates = this.candidates.filter((a: Any) => {
      if (a.path.length < this.chainPrefix.length) return false;
      for (let i = 0; i < this.chainPrefix.length; i++) {
        if (a.path[i][0] !== this.chainPrefix[i]![0] || a.path[i][1] !== this.chainPrefix[i]![1]) return false;
      }
      return true;
    });
    const complete = this.candidates.filter((a: Any) => a.path.length === this.chainPrefix.length);
    const longer = this.candidates.filter((a: Any) => a.path.length > this.chainPrefix.length);
    if (complete.length === 1 && longer.length === 0) {
      const action = complete[0];
      this.selected = null;
      this.chainPrefix = [];
      this.candidates = [];
      this.lastBefore = this.session.state;
      this.lessonCheckPending = true;
      this.session.submit({ ...action });
      this.refreshSelection();
      return;
    }
    if (longer.length > 0) {
      audio.play("chainStep");
      this.host.announce(longer.length === 1 ? T("Chain continues — 1 follow-up jump available.") : T("Chain continues — {n} follow-up jumps available.", { n: longer.length }));
      this.candidates = [...longer];
    }
    this.refreshSelection();
  }

  cancelSelection(): boolean {
    if (this.selected == null) return false;
    this.selected = null;
    this.chainPrefix = [];
    this.candidates = [];
    audio.play("setDown");
    this.refreshSelection();
    return true;
  }

  private refreshSelection(syncRender = true): void {
    if (!syncRender) return;
    const steps = this.selected != null ? this.nextSteps() : null;
    const ghosts: { path: number[][]; captures: unknown[] }[] = [];
    if (steps) {
      for (const [key, acts] of steps) {
        const [r, c] = key.split(",").map(Number) as [number, number];
        ghosts.push({ path: [[r, c]], captures: acts[0].captures.length || acts.some((a: Any) => a.captures.length > this.chainPrefix.length) ? [1] : [] });
      }
    }
    render.setSelection(this.selected, ghosts.length ? ghosts : null);
  }

  /** The semantic board's cell states (the browser build's DomBoard). */
  cellInfo(r: number, c: number): { piece: Any; target: boolean; capture: boolean; selected: boolean; last: boolean } {
    const st = this.state;
    const piece = st.pieces.find((p: Any) => !p.captured && p.r === r && p.c === c) || null;
    const key = `${r},${c}`;
    const steps = this.selected != null ? this.nextSteps() : null;
    const acts = steps?.get(key);
    const sel = this.selected != null ? st.pieces[this.selected] : null;
    return {
      piece, target: !!acts, capture: !!acts?.some((a: Any) => a.captures.length),
      selected: !!sel && sel.r === r && sel.c === c,
      last: !!this.lastMove && (this.lastMove.from === key || this.lastMove.to === key),
    };
  }

  /** Moves the semantic board's cursor to the next playable square that way. */
  moveCursor(dr: number, dc: number): void {
    const size = this.size;
    let { r, c } = this.cursor;
    for (let i = 0; i < size; i++) {
      r += dr; c += dc;
      if (r < 0 || r >= size || c < 0 || c >= size) break;
      if (isPlayable(size, r, c)) { this.cursor = { r, c }; break; }
    }
  }

  // --- keys and pads -------------------------------------------------------------------
  handleAction(action: string): boolean {
    switch (action) {
      case "up": case "down": case "left": case "right": {
        // Keyboard / pad navigation implies the semantic board: show it.
        if (!this.host.boardShown()) {
          this.host.toggleBoard();
          this.host.announce(T("HTML board shown. Arrow keys move the cursor; Enter selects."));
        }
        if (action === "up") this.moveCursor(-1, 0);
        else if (action === "down") this.moveCursor(1, 0);
        else if (action === "left") this.moveCursor(0, -1);
        else this.moveCursor(0, 1);
        audio.play("scrollTick");
        return true;
      }
      case "confirm": this.onCell(this.cursor.r, this.cursor.c); return true;
      case "cancel":
        if (this.cancelSelection()) return true;
        this.host.togglePause(true);
        return true;
      case "pause": this.host.togglePause(); return true;
      case "undo": this.requestUndo(); return true;
      case "hint": this.requestHint(); return true;
      case "camera": this.host.cycleCamera(); return true;
      case "skip": this.skipRequested = true; render.skipAll(this.state); return true;
      default: return false;
    }
  }

  requestUndo(): void {
    if (!this.session.canUndo?.()) { this.host.toast(T("Undo is not available here."), "warn"); return; }
    const res = this.session.undo();
    if (res.ok) audio.play("undo");
  }

  requestHint(): void {
    if (!this.session.canHint?.()) { this.host.toast(T("Hints are disabled for this round."), "warn"); return; }
    this.session.hint();
  }
}
