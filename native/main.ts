// Crown Draughts on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules, AI, content, progression, sessions and
// hosted tables are the browser build's (js/rules, js/content, js/core),
// unchanged in behaviour; the screens and HUD are starhermit:ui
// (screens.ts), the garden and board starhermit:scene (render.ts), the
// controller app.ts and game.ts, saves and the platform platform.ts.
import { frame, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences } from "starhermit:engine";
import { onAction, onPointerButton, onPointerMove, onTouch } from "starhermit:input";
import { onSessionEnded } from "starhermit:platform";
import * as ui from "starhermit:ui";
import { setSessionClock } from "../js/core/session.js";
import { initLanguage } from "./i18n.ts";
import { platformStrings } from "../js/ui/platform-i18n.js";
import * as render from "./render.ts";
import * as audio from "./audio.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import { setStyle } from "./style.ts";
import { drawScreens, setHudBlur } from "./screens.ts";
import * as A from "./app.ts";
import { app } from "./app.ts";

// Round clocks and play time run on the game clock (pauses while suspended,
// deterministic in checks).
setSessionClock(() => frame().time * 1000);

onStart(() => {
  initLanguage();
  setStyle();
  platform.initPlatform();
  app.settings = platform.loadSettings();
  app.profile = platform.loadProfile();
  A.syncAccount();
  A.applySettings();
  platform.onSettingsChange(() => {
    app.settings = platform.loadSettings();
    app.profile = platform.loadProfile();
    A.syncAccount();
    A.applySettings();
  });
  platform.onAccountChange(() => A.syncAccount());
  onSessionEnded((reason) => {
    if (reason === "signed-out") A.toast(platformStrings().signedOut!, "warn", 4000);
    else A.showSessionExpired(reason === "terms-required");
  });
  onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
  render.setReducedMotion(preferences().reducedMotion);
  audio.loadSfx();
  A.attractBoard();
  A.go("title");
});

onSuspend(() => A.onSuspend());
onResume(() => { /* the pause card waits for the player */ });

// ------------------------------------------------------------------ keys and pads
function inRound(): boolean {
  return app.screen === "game" && !!app.game && !app.modals.length && !ui.capturingKeys();
}
onAction((e) => {
  if (!e.pressed || ui.capturingKeys()) return;
  if (e.action === "mute") { A.toggleMute(); return; }
  if (e.action === "help") { if (!app.modals.some((m) => m.kind === "help")) A.openModal({ kind: "help" }); return; }
  if (e.action === "board") { if (app.screen === "game") A.toggleBoard(); return; }
  if (app.modals.length) return; // the dialog has the keys (Escape / East close it)
  if (inRound()) {
    const game = app.game!;
    // Enter / Space / South on a focused widget is the widget's.
    if (e.action === "confirm" && ui.focused()) return;
    if (["up", "down", "left", "right"].includes(e.action)) {
      game.handleAction(e.action);
      ui.setFocus(`cell-${game.cursor.r}-${game.cursor.c}`);
      return;
    }
    if (e.action === "pause" || e.action === "cancel") {
      if (e.action === "cancel" && game.cancelSelection()) return;
      A.togglePause(true);
      return;
    }
    game.handleAction(e.action);
    return;
  }
  if (e.action === "cancel" && app.screen !== "title" && app.screen !== "game" && !ui.focused()?.startsWith("name-")) {
    audio.play("uiBack");
    if (app.screen === "table-room") A.leaveHosted();
    else if (app.screen === "results") A.exitToTitle();
    else A.go(app.screen === "modes" ? "title" : "modes");
  }
});

// ------------------------------------------------------------------ pointer and touch on the 3D board
// A tap or a drag's end resolves to a cell press (the browser build's canvas
// pointer handling); presses are decided after the frame's UI is built, so
// one over a widget (ui.pointerOver) is the widget's.
type Press = { x: number; y: number; t: number; moved: boolean };
let press: Press | null = null;
const pending: { kind: "down" | "up"; x: number; y: number }[] = [];
let lastTouch = -1e9;
let hoverKey = "";
onPointerButton((e) => {
  if (e.button !== 0 || A.nowMs() - lastTouch < 600) return;
  pending.push({ kind: e.pressed ? "down" : "up", x: e.x, y: e.y });
});
onPointerMove((x, y) => {
  if (press && Math.hypot(x - press.x, y - press.y) > 9 * frame().scale) press.moved = true;
  if (A.nowMs() - lastTouch < 600 || !inRound() || ui.pointerOver()) return;
  const cell = render.pickCell(x, y);
  const key = cell ? `${cell.r},${cell.c}` : "";
  if (key !== hoverKey) { hoverKey = key; render.setHover(cell); }
});
onTouch((e) => {
  if (!e.primary) return;
  lastTouch = A.nowMs();
  if (e.phase === "start") pending.push({ kind: "down", x: e.x, y: e.y });
  else if (e.phase === "end") pending.push({ kind: "up", x: e.x, y: e.y });
  else if (e.phase === "move") { if (press && Math.hypot(e.x - press.x, e.y - press.y) > 9 * frame().scale) press.moved = true; }
  else press = null;
});
function handlePointer(): void {
  while (pending.length) {
    const p = pending.shift()!;
    if (p.kind === "down") {
      press = inRound() && !ui.pointerOver() && app.game!.canAct() ? { x: p.x, y: p.y, t: A.nowMs(), moved: false } : null;
      continue;
    }
    const d = press;
    press = null;
    if (!d || !inRound() || !app.game!.canAct()) continue;
    const cell = render.pickCell(p.x, p.y);
    if (!cell) { app.game!.cancelSelection(); continue; }
    ui.setFocus(null);
    app.game!.onCell(cell.r, cell.c);
  }
}

// ------------------------------------------------------------------ frame
let lookKey = "";
onUpdate((dt) => {
  const f = frame();
  const look = lookFor(f.quality, f.levelIndex);
  const key = `${f.quality}:${f.levelIndex}`;
  if (key !== lookKey) { lookKey = key; setHudBlur(look.budget.hudBlur); }
  render.applyLook(look);
  audio.poll(dt);
  A.tick();
  render.update(dt, f.width, f.height, app.paused);
});
onRender(() => {
  drawScreens();
  handlePointer();
  if (app.game && app.boardShown && app.screen === "game") render.setHover(app.game.cursor);
});
