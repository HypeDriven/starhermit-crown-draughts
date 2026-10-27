// The app: the browser build's js/ui/app.js orchestrator without its DOM —
// the screen state machine, the game lifecycle (practice, journey, daily,
// challenges, lessons, Pass & Play, hosted tables), the results, the
// in-round HUD state (move log, chat, clocks, the lesson coach, toasts,
// the countdown) and the dialogs. native/screens.ts draws it every frame
// with starhermit:ui; native/main.ts routes input to it.
import { clipboard, frame, preferences } from "starhermit:engine";
import { requestSignIn } from "starhermit:platform";
import { vibrate as padVibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { Session } from "../js/core/session.js";
import { HostedSessionClient as HostedJs } from "../js/core/hosted.js";
import { applyRoundResult } from "../js/core/progress.js";
import { dailyDefinition, utcDateKey } from "../js/content/daily.js";
import { contentSetup, JOURNEY_STAGES } from "../js/content/index.js";
import { playerStats } from "../js/rules/engine.js";
import { AI_LEVELS, RULESETS, THEMES, lessonById } from "./data.ts";
import { platformStrings, pfmt } from "../js/ui/platform-i18n.js";
import { N, T } from "./i18n.ts";
import { GameController, type GameHost } from "./game.ts";
import * as render from "./render.ts";
import * as audio from "./audio.ts";
import * as platform from "./platform.ts";
import { setPalette } from "./style.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export type Screen = "title" | "modes" | "practice" | "local" | "journey" | "stage-setup" | "learn" | "challenges"
  | "challenge-setup" | "daily" | "lobby" | "table-room" | "results" | "game";
export type Modal =
  | { kind: "pause" }
  | { kind: "settings"; tab: number }
  | { kind: "profile" }
  | { kind: "help" }
  | { kind: "confirm"; title: string; body?: string; confirmLabel: string; danger?: boolean; resolve: (ok: boolean) => void }
  | { kind: "expired"; terms: boolean };
export type Toast = { text: string; kind: string; until: number };
export type LogEntry = { text: string; render: (() => string) | null };

/** The game clock in milliseconds (pauses while suspended, advances in checks). */
export const nowMs = (): number => frame().time * 1000;

export const app = {
  settings: platform.loadSettings() as Any,
  profile: platform.loadProfile(),
  screen: "title" as Screen,
  screenData: null as Any,
  forms: {} as Record<string, Any>,
  modals: [] as Modal[],
  /** The frame a modal opened (its opening Escape must not close it). */
  modalOpenedAt: 0,
  session: null as Any,
  game: null as GameController | null,
  hostedClient: null as Any,
  lastConfig: null as Any,
  lessonRun: null as { lesson: Any; stepIndex: number } | null,
  dailyDef: null as Any,
  toasts: [] as Toast[],
  log: [] as LogEntry[],
  chat: [] as { name: string; text: string }[],
  chatDraft: "",
  clock: null as number[] | null,
  clockTurn: 0,
  clockWarned: false,
  thinking: false,
  coach: null as null | { title: string; text: string; kind: "read" | "action" | "done" },
  countdown: null as null | { steps: string[]; i: number; next: number; stepMs: number; session: Any },
  lastResults: null as null | { over: Any; config: Any; outcome: Any },
  lbResult: null as null | { posted: boolean; rank: number | null },
  lbPending: false,
  drawer: null as null | "left" | "right",
  boardShown: false,
  paused: false,
  invites: null as null | { id: string; name: string }[],
  friends: null as null | { userId: string; name: string; online: boolean; invited?: boolean; busy?: boolean }[],
  tableRoomNote: "",
  /** Scroll-to-top requests for screens that just opened (dialogs that autofocus a bottom button). */
  scrollTop: 0,
};

const PT = (): Record<string, string> => platformStrings();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HostedSessionClient = HostedJs as any;

// ------------------------------------------------------------------ toasts and announcements
export function toast(msg: string, kind = "info", ms = 2600): void {
  app.toasts.push({ text: msg, kind, until: nowMs() + ms });
  if (app.toasts.length > 4) app.toasts.shift();
  if (kind !== "warn") audio.play("toast");
}
export function announce(msg: string, assertive = false): void {
  if (!msg) return;
  try { ui.announce(String(msg).slice(0, 500), { politeness: assertive ? "assertive" : "polite" }); } catch { /* empty */ }
}

// ------------------------------------------------------------------ navigation
export function go(screen: Screen, data?: Any): void {
  app.screen = screen;
  app.forms = {};
  app.screenData = data ?? null;
  app.scrollTop = frame().frame;
  if (screen !== "game") app.drawer = null;
  ui.setFocus(null);
  const names: Partial<Record<Screen, string>> = {
    title: N("Crown Draughts"), modes: N("Choose your court"), practice: N("Practice"), local: N("Pass & Play"),
    journey: N("Journey"), learn: N("Learn the court"), challenges: N("Challenges"), lobby: N("Hosted play"),
    "table-room": N("Your table"), daily: N("Daily Court"),
  };
  const name = names[screen];
  if (name) announce(T("{name} screen", { name: T(name) }));
}
/** Per-screen form state, kept across frames and reset on navigation. */
export function formState<T2>(key: string, init: () => T2): T2 {
  if (!app.forms[key]) app.forms[key] = init();
  return app.forms[key] as T2;
}

export function openModal(m: Modal): void {
  app.modals.push(m);
  app.modalOpenedAt = frame().frame;
  audio.play("uiOpen");
}
export function closeModal(): void {
  const m = app.modals.pop();
  if (!m) return;
  audio.play("panelClose");
  if (m.kind === "pause") resumeFromPause();
  if (m.kind === "confirm") m.resolve(false);
  if (m.kind === "expired" && app.hostedClient) exitToTitle();
}
export function topModal(): Modal | null { return app.modals[app.modals.length - 1] ?? null; }
export function confirmDialog(o: { title: string; body?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    openModal({ kind: "confirm", title: o.title, body: o.body, confirmLabel: o.confirmLabel || T("Confirm"), danger: o.danger, resolve });
  });
}
export function answerConfirm(ok: boolean): void {
  const m = topModal();
  if (!m || m.kind !== "confirm") return;
  app.modals.pop();
  m.resolve(ok);
}

// ------------------------------------------------------------------ settings and profile
export function saveSettings(): void {
  platform.saveSettings(app.settings);
  applySettings();
}
export function applySettings(): void {
  audio.setMuted(!!app.settings.muted);
  setPalette(app.settings.accessibility.colorPalette);
  render.setCosmetics(app.settings.cosmetics);
  render.setCameraPreset(app.settings.camera.preset);
  render.setReducedMotion(preferences().reducedMotion);
  app.boardShown = app.boardShown || !!app.settings.accessibility.domBoard;
  if (!app.session) applyTheme();
}
export function saveProfile(): void { platform.saveProfile(app.profile); }
/** Signed in, the account's display name replaces the local guest name. */
export function syncAccount(): void {
  const name = platform.accountName();
  if (name && name !== app.profile.name) { app.profile.name = name; saveProfile(); }
}

export function applyTheme(themeId?: string): void {
  const theme = themeId || app.settings.theme;
  render.setTheme(theme, app.session?.config?.seed || 1);
  audio.startAmbience(theme);
  audio.startMusic(THEMES[theme]);
}

export function cycleCamera(): void {
  const order = ["classic", "low", "top"];
  const next = order[(order.indexOf(app.settings.camera.preset) + 1) % order.length]!;
  app.settings.camera = { preset: next };
  platform.saveSettings(app.settings);
  render.setCameraPreset(next);
  audio.play("cameraMove");
  toast(T("Camera: {view}", { view: T(({ classic: N("Classic"), low: N("Low (near the stone)"), top: N("Top-down") } as Record<string, string>)[next]!) }));
}
export function toggleBoard(): boolean {
  app.boardShown = !app.boardShown;
  app.settings.accessibility = { ...app.settings.accessibility, domBoard: app.boardShown };
  platform.saveSettings(app.settings);
  announce(app.boardShown ? T("HTML board shown.") : T("HTML board hidden."));
  return app.boardShown;
}
export function toggleMute(): void {
  app.settings.muted = !app.settings.muted;
  saveSettings();
  toast(app.settings.muted ? T("Muted") : T("Sound on"));
}

// ------------------------------------------------------------------ game lifecycle
const host: GameHost = {
  toast, announce,
  addLogEntry(entry) { app.log.push(entry); if (app.log.length > 60) app.log.shift(); },
  updateClocks(clock, turn) {
    app.clock = clock ? clock.slice() : null;
    app.clockTurn = turn;
    if (!clock) return;
    // One warning knock when the active clock first drops under ten seconds.
    const active = clock[turn]!;
    const low = Number.isFinite(active) && active > 0 && active <= 10000;
    if (low && !app.clockWarned) { app.clockWarned = true; audio.play("clockWarn"); }
    else if (!low) app.clockWarned = false;
  },
  setThinking(v) { app.thinking = v; },
  addChatMessage(m) { app.chat.push({ name: m.name || m.from || "", text: m.text }); if (app.chat.length > 80) app.chat.shift(); },
  lessonStepComplete(step) { lessonStepComplete(step); },
  saveSnapshot(snap) { saveRoundSnapshot(snap); },
  togglePause(force) { togglePause(force); },
  cycleCamera, toggleBoard,
  boardShown: () => app.boardShown,
  haptics: () => !!app.settings.accessibility.haptics,
  vibrate: () => { try { padVibrate(30); } catch { /* no pad */ } },
};

function startSession(config: Any, { lesson = null, lessonStepIndex = 0 }: { lesson?: Any; lessonStepIndex?: number } = {}): void {
  app.modals = [];
  if (!lesson) app.lessonRun = null;
  teardownGame();
  const constraints = { ...(config.constraints || {}) };
  const humans = config.players.filter((p: Any) => p.kind === "human").length;
  if (constraints.clockMs && app.settings.accessibility.timingAssist && humans <= 1) {
    // Timing assistance: the human's clock runs at half speed in solo play.
    constraints.clockMs = Math.round(constraints.clockMs * 1.5);
  }
  app.session = new Session({ ...config, constraints });
  app.lastConfig = config;
  enterGame(lesson, lessonStepIndex);
}

function resetHud(): void {
  app.log = [];
  app.chat = [];
  app.coach = null;
  app.clock = null;
  app.thinking = false;
  app.drawer = null;
  app.paused = false;
  app.lbResult = null;
}

function enterGame(lesson: Any = null, lessonStepIndex = 0): void {
  const session = app.session;
  resetHud();
  applyTheme(session.config.theme);
  app.game = new GameController(host, session, { lesson, lessonStepIndex, onOver: (over) => onGameOver(over) });
  go("game");
  app.game.begin();
  if (session.clock) host.updateClocks(session.clock, session.state.turn);
  if (lesson) presentLessonStep();
  runCountdown(session);
}

/** The ready signal: "Ready?", or 3-2-1-Go! for clocked rounds. */
function runCountdown(session: Any): void {
  const clocked = !!session.config.constraints?.clockMs;
  session.pause("countdown");
  const reduced = preferences().reducedMotion;
  const stepMs = clocked ? (reduced ? 500 : 750) : (reduced ? 500 : 900);
  app.countdown = { steps: clocked ? ["3", "2", "1", T("Go!")] : [T("Ready?")], i: -1, next: nowMs(), stepMs, session };
}
/** Per frame: steps the countdown, expires toasts. */
export function tick(): void {
  const cd = app.countdown;
  if (cd) {
    if (app.session !== cd.session) app.countdown = null;
    else if (nowMs() >= cd.next) {
      cd.i++;
      if (cd.i >= cd.steps.length) { app.countdown = null; if (!app.paused) cd.session.resume(); }
      else {
        audio.play(cd.i === cd.steps.length - 1 ? "roundStart" : "countdownTick");
        cd.next = nowMs() + cd.stepMs;
      }
    }
  }
  const t = nowMs();
  app.toasts = app.toasts.filter((x) => x.until > t);
}

function teardownGame(): void {
  app.game?.destroy();
  app.game = null;
  if (app.session && app.session !== app.hostedClient) app.session.destroy();
  app.session = null;
  app.countdown = null;
}

export function startPractice({ ruleset, level, side }: { ruleset: string; level: string; side: number }): void {
  const me = { name: app.profile.name, kind: "human" };
  const ai = { name: `${AI_LEVELS[level].name}`, kind: "ai", aiLevel: level };
  startSession({
    mode: "practice", ruleset, seed: (Math.random() * 0xffffffff) >>> 0,
    players: side === 0 ? [me, ai] : [ai, me], ranked: false, theme: app.settings.theme,
    contentId: `practice-${ruleset}-${level}`,
  });
}
export function startJourneyStage(stage: Any): void {
  startSession({
    mode: "journey", ruleset: stage.ruleset, seed: stage.seed, setup: contentSetup(stage),
    players: [{ name: app.profile.name, kind: "human" }, { name: AI_LEVELS[stage.ai].name, kind: "ai", aiLevel: stage.ai }],
    contentId: stage.id, goal: stage.goal, par: stage.par, theme: stage.theme, ranked: false,
  });
}
/** Today's daily court, by the platform's clock (the device's when offline). */
export function todayDaily(): Any {
  const key = utcDateKey(new Date(platform.nowMs()));
  if (!app.dailyDef || app.dailyDef.date !== key) app.dailyDef = dailyDefinition(key);
  return app.dailyDef;
}
export function startDaily(): void {
  const def = todayDaily();
  const rec = platform.getProgress().daily[def.date];
  startSession({
    mode: "daily", ruleset: def.ruleset, seed: def.seed,
    players: [{ name: app.profile.name, kind: "human" }, { name: AI_LEVELS[def.ai].name, kind: "ai", aiLevel: def.ai }],
    contentId: def.id, goal: def.goal, par: def.par, theme: def.theme, ranked: !rec?.completed, constraints: def.constraints,
  });
}
export function startChallenge(c: Any): void {
  if (c.constraints?.localMultiplayer) {
    startLocal({ ruleset: "melee", names: [T("Ivory"), T("Jade"), T("Onyx"), T("Ember")], count: 4, challengeId: c.id });
    return;
  }
  startSession({
    mode: "challenge", ruleset: c.ruleset, seed: c.seed, setup: contentSetup(c),
    players: [{ name: app.profile.name, kind: "human" }, { name: AI_LEVELS[c.ai].name, kind: "ai", aiLevel: c.ai }],
    contentId: c.id, goal: c.goal, par: c.par, theme: c.theme, constraints: c.constraints || {}, ranked: false,
  });
}
export function startLocal({ ruleset, names, count, challengeId }: { ruleset: string; names: string[]; count: number; challengeId?: string }): void {
  const cap = RULESETS[ruleset].playerCount;
  const players = [];
  for (let i = 0; i < cap; i++) players.push({ name: names[i % Math.max(1, count)] || `House ${i + 1}`, kind: "human" });
  startSession({
    mode: challengeId ? "challenge" : "local", ruleset, seed: (Math.random() * 0xffffffff) >>> 0,
    players, contentId: challengeId || `local-${ruleset}`, theme: app.settings.theme, ranked: false,
  });
}

// --- lessons -----------------------------------------------------------------------------------
export function startLesson(lessonId: string, stepIndex = 0): void {
  const lesson = lessonById(lessonId);
  if (!lesson) return;
  app.lessonRun = { lesson, stepIndex };
  const step = lesson.steps[stepIndex];
  if (!step) { lessonComplete(); return; }
  if (step.kind === "read") {
    // Prepare the next actionable step's board, but stay in the lesson flow.
    const nextAction = lesson.steps.slice(stepIndex).find((s: Any) => s.setup);
    if (nextAction) lessonSession(lesson, lesson.steps.indexOf(nextAction));
    app.lessonRun = { lesson, stepIndex };
    presentLessonStep();
    return;
  }
  lessonSession(lesson, stepIndex);
}
function lessonSession(lesson: Any, stepIndex: number): void {
  const step = lesson.steps[stepIndex];
  teardownGame();
  app.session = new Session({
    mode: "lesson", ruleset: "duel", seed: 1000 + stepIndex, setup: step.setup,
    players: [{ name: "You", kind: "human" }, { name: "Garden Novice", kind: "ai", aiLevel: step.opponent || "novice" }],
    contentId: lesson.id, theme: "royal-garden",
  });
  app.lessonRun = { lesson, stepIndex };
  enterGame(lesson, stepIndex);
}
function presentLessonStep(): void {
  const run = app.lessonRun!;
  const step = run.lesson.steps[run.stepIndex];
  if (!step) { lessonComplete(); return; }
  app.coach = {
    title: T("{title} — step {n}/{total}", { title: T(run.lesson.title), n: run.stepIndex + 1, total: run.lesson.steps.length }),
    text: T(step.text), kind: step.kind === "read" ? "read" : "action",
  };
  announce(T(step.text));
}
export function lessonAdvance(): void {
  const run = app.lessonRun;
  if (!run) return;
  const next = run.stepIndex + 1;
  if (next >= run.lesson.steps.length) { lessonComplete(); return; }
  const step = run.lesson.steps[next];
  run.stepIndex = next;
  if (step.kind === "action" && step.setup) lessonSession(run.lesson, next);
  else {
    if (app.game) app.game.lessonStepIndex = next;
    presentLessonStep();
  }
}
function lessonStepComplete(step: Any): void {
  audio.play("achievement");
  app.coach = { title: T("Well played"), text: step.success ? T(step.success) : T("Step complete."), kind: "done" };
  ui.setFocus("coach-continue");
  announce(step.success ? T(step.success) : T("Step complete."), true);
}
function lessonComplete(): void {
  const lesson = app.lessonRun!.lesson;
  const p = platform.getProgress();
  if (!p.lessonsComplete.includes(lesson.id)) { p.lessonsComplete.push(lesson.id); platform.saveProgress(p); }
  toast(T("Lesson complete: {title}", { title: T(lesson.title) }), "ok", 4000);
  exitToTitle("learn");
}

// --- hosted tables ----------------------------------------------------------------------------------
function wireHosted(client: Any): void {
  client.on("over", (over: Any) => onGameOver(over));
  client.on("authLost", () => showSessionExpired(false));
  client.on("termsRequired", () => showSessionExpired(true));
  client.on("unavailable", () => {
    toast(T("This table is no longer available — host a new one or join another."), "warn", 6000);
    if (app.screen === "table-room") leaveHosted();
  });
  client.on("state", () => { if (client === app.hostedClient && client.phase === "active" && app.screen !== "game") enterHostedGame(); });
}
async function enterTableRoom(client: Any): Promise<void> {
  app.hostedClient = client;
  client.connect();
  wireHosted(client);
  await client.refresh();
  app.friends = null;
  go("table-room", client);
  if (client.isHost) loadFriends();
}
export async function hostTable(state: { ruleset: string; listed: boolean; clock: boolean }): Promise<void> {
  const res = await HostedSessionClient.create(platform.roomsAdapter, {
    ruleset: state.ruleset, name: app.profile.name, listed: state.listed, clockMs: null, turnDeadlineMs: state.clock ? 90000 : null,
  });
  if (!res.ok) { toast(T("Could not create table"), "warn"); return; }
  await enterTableRoom(res.client);
}
export async function quickJoinTable(): Promise<void> {
  const res = await HostedSessionClient.join(platform.roomsAdapter, { name: app.profile.name });
  if (!res.ok) {
    toast(res.error === "no-open-tables" ? T("No open tables right now — host one, or accept a friend invite.") : T("Could not join"), "warn");
    return;
  }
  await enterTableRoom(res.client);
}
export async function acceptTableInvite(inviteId: string): Promise<void> {
  const res = await HostedSessionClient.acceptInvite(platform.roomsAdapter, inviteId, { name: app.profile.name });
  if (!res.ok) { toast(T("Could not join"), "warn"); return; }
  await enterTableRoom(res.client);
}
export function loadInvites(): void {
  app.invites = null;
  platform.roomsAdapter.pollInvites().then(async (res) => {
    const raw = res.ok ? (res.data as { id: string; fromUserId: string; fromName: string }[]) : [];
    app.invites = await Promise.all(raw.map(async (inv) => ({ id: inv.id, name: inv.fromName || (inv.fromUserId ? await platform.displayName(inv.fromUserId) : "—") })));
  }, () => { app.invites = []; });
}
function loadFriends(): void {
  app.friends = null;
  platform.roomsAdapter.listFriends().then((res) => {
    const list = ((res.data as Any[]) || []).slice().sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));
    app.friends = list.map((f) => ({ userId: f.userId, name: f.name, online: !!f.online }));
  }, () => { app.friends = []; });
}
export async function inviteFriend(f: { userId: string; invited?: boolean; busy?: boolean }): Promise<void> {
  if (!app.hostedClient || f.busy || f.invited) return;
  f.busy = true;
  const r = await platform.roomsAdapter.inviteToRoom(app.hostedClient.roomId, f.userId);
  f.busy = false;
  if (r.ok) f.invited = true;
  else toast(PT().inviteFailed!, "warn");
}
export async function startHostedRound(): Promise<void> {
  const res = await app.hostedClient?.startGame();
  if (res && !res.ok) toast(res.error === "only the host can start" ? T("Only the host can start the round.") : T("Could not start"), "warn");
}
function enterHostedGame(): void {
  app.lessonRun = null;
  app.modals = [];
  teardownGame();
  app.session = app.hostedClient;
  app.lastConfig = app.hostedClient.config;
  resetHud();
  app.game = new GameController(host, app.hostedClient, { onOver: (over) => onGameOver(over) });
  applyTheme(app.settings.theme);
  go("game");
  app.game.begin();
  audio.play("roundStart");
  toast(T("Round started. Good luck!"), "ok");
}
export function leaveHosted(): void {
  app.hostedClient?.leave();
  app.hostedClient = null;
  go("lobby");
}
export async function sendChat(): Promise<void> {
  const text = app.chatDraft.trim();
  if (!text || !app.hostedClient) return;
  const res = await app.hostedClient.sendChat(text);
  if (res && !res.ok) toast(res.error === "rate-limited" ? T("Slow down — 10 messages per minute.") : T("Message not sent"), "warn");
  else app.chatDraft = "";
}

/** The launch token is gone (signed out elsewhere, expired, or terms consent pending). */
export function showSessionExpired(terms: boolean): void {
  if (app.modals.some((m) => m.kind === "expired")) return;
  openModal({ kind: "expired", terms });
}
export function signIn(): void {
  requestSignIn().then(() => { syncAccount(); }, () => toast(PT().relaunchFailed!, "warn", 5000));
}

// --- the round's end and the results ------------------------------------------------------------
function onGameOver(over: Any): void {
  const config = app.session.config;
  const humanSeats = config.players.map((p: Any, i: number) => ({ ...p, seat: i })).filter((p: Any) => p.kind === "human");
  const localMultiplayer = !app.hostedClient && humanSeats.length > 1;
  const mySeat = app.hostedClient ? app.hostedClient.seat : (humanSeats[0]?.seat ?? 0);
  const iWon = localMultiplayer ? false : over.winner === mySeat;
  over.winnerName = over.winner != null ? (config.players[over.winner]?.name || `House ${over.winner + 1}`) : null;
  let outcome: Any = { mySeat, iWon, localMultiplayer, stars: 0, ratingDelta: 0, unlocked: [], mastery: [], nextAction: null };
  if (config.mode !== "hosted" && config.mode !== "lesson") {
    const stats = playerStats(app.session.state);
    const progress = platform.getProgress();
    const applied = applyRoundResult(progress, app.profile, config, over, stats);
    outcome = { ...outcome, ...applied };
    platform.saveProgress(progress);
    saveProfile();
  }
  if (config.mode === "lesson") {
    const run = app.lessonRun;
    if (run) {
      const step = run.lesson.steps[run.stepIndex];
      if (step?.goal && (step.goal.kind === "finish" || (step.goal.kind === "finish-win" && over.winner === 0))) {
        setTimeout(() => lessonStepComplete(step), 600);
      }
    }
    return;
  }
  platform.clearSnapshot();
  if (config.mode === "journey" && iWon) {
    const next = nextJourneyStage(config.contentId);
    if (next) outcome.nextAction = { label: () => T("Next: {name}", { name: T(next.name) }), fn: () => startJourneyStage(next) };
  } else if (config.mode === "daily") {
    outcome.nextAction = { label: () => T("Back to the garden"), fn: () => exitToTitle() };
  }
  setTimeout(() => showResults(over, config, outcome), 1100);
}
function nextJourneyStage(currentId: string): Any {
  const idx = JOURNEY_STAGES.findIndex((s: Any) => s.id === currentId);
  return idx < 0 || idx + 1 >= JOURNEY_STAGES.length ? null : JOURNEY_STAGES[idx + 1];
}
function showResults(over: Any, config: Any, outcome: Any): void {
  if (!app.session || app.session.config !== config) return; // left meanwhile
  app.lastResults = { over, config, outcome };
  app.modals = [];
  go("results");
  if (outcome.stars > 0) audio.play("starAward");
  if (outcome.recordBroken) audio.play("newRecord");
  if (outcome.unlocked?.length) audio.play("achievement");
  if (outcome.mastery?.length) audio.play("masteryUnlock");
  if (config.mode === "daily" && outcome.iWon && platform.getProgress().stats.dailyStreak >= 3) audio.play("streak");
  announce(`${over.winner === null ? T("Draw") : outcome.iWon ? T("Victory") : T("Round over")}. ${T(over.reasonText)}`, true);
  // Signed in, a finished solo round against the AI (not a lesson, Pass &
  // Play or a hosted table) posts the player's total to the high-score board.
  const solo = config.mode !== "hosted" && config.mode !== "lesson" && !outcome.localMultiplayer;
  const brk = over.breakdowns && over.breakdowns[outcome.mySeat];
  app.lbResult = null;
  app.lbPending = false;
  if (platform.signedIn() && solo && brk) {
    app.lbPending = true;
    platform.submitScore(Math.max(0, Math.round(brk.total))).then((r) => { app.lbResult = r; app.lbPending = false; });
  }
}
/** The results leaderboard line, or null when it does not show. */
export function leaderboardLine(): string | null {
  const r = app.lastResults;
  if (!r || !platform.signedIn()) return null;
  const solo = r.config.mode !== "hosted" && r.config.mode !== "lesson" && !r.outcome.localMultiplayer;
  if (!solo) return null;
  const P = PT();
  const lb = app.lbResult;
  return !lb ? (app.lbPending ? P.lbPosting! : P.lbNotPosted!) : !lb.posted ? P.lbNotPosted! : lb.rank ? pfmt(P.lbRank, { rank: lb.rank }) : P.lbPosted!;
}

export function retryLast(): void {
  const c = app.lastConfig;
  if (!c) { go("modes"); return; }
  if (c.mode === "hosted") { exitToTitle("lobby"); return; }
  if (c.mode === "journey") { startSession({ ...c }); return; }
  startSession({ ...c, seed: (Math.random() * 0xffffffff) >>> 0 });
}
export function exitToTitle(screen: Screen = "title"): void {
  teardownGame();
  app.hostedClient?.leave();
  app.hostedClient = null;
  app.lessonRun = null;
  app.modals = [];
  app.paused = false;
  attractBoard();
  go(screen);
}

// --- resume ----------------------------------------------------------------------------------------------
function saveRoundSnapshot(snap: Any): void {
  const mode = app.session?.config?.mode;
  if (mode === "hosted" || mode === "lesson" || mode === "attract") return;
  platform.saveSnapshot(snap);
}
export function pendingSnapshot(): { snap: Any; label: string } | null {
  const snap = platform.loadSnapshot<Any>();
  if (!snap || snap.over || !snap.config) return null;
  return { snap, label: T("{mode} · ply {n}", { mode: modeLabel(snap.config), n: snap.plyAtSave }) };
}
export function resumeSnapshot(): void {
  const pending = pendingSnapshot();
  if (!pending) return;
  let restored: Any;
  try { restored = Session.restore(pending.snap); } catch { platform.clearSnapshot(); toast(T("Could not join"), "warn"); return; }
  teardownGame();
  app.session = restored.session;
  app.lastConfig = restored.session.config;
  enterGame(null);
  toast(T("Welcome back — the court is at ply {n}.", { n: restored.away.resumedAtPly }), "info", 4000);
}

// --- pause ----------------------------------------------------------------------------------------------------
export function togglePause(force?: boolean): void {
  if (app.screen !== "game" || !app.session) return;
  const isOpen = app.modals.some((m) => m.kind === "pause");
  const want = force ?? !isOpen;
  if (want && !isOpen) {
    const hosted = app.session.config.mode === "hosted";
    if (!hosted) app.session.pause("manual");
    app.paused = !hosted;
    openModal({ kind: "pause" });
    audio.play("pause");
  } else if (!want && isOpen) {
    while (app.modals.length && topModal()!.kind !== "pause") app.modals.pop();
    closeModal();
  }
}
function resumeFromPause(): void {
  app.paused = false;
  if (!app.countdown) app.session?.resume();
  audio.play("resume");
}
export async function leaveRound(): Promise<void> {
  const ok = await confirmDialog({ title: T("Leave this round?"), body: T("The round will be saved locally unless it is finished."), confirmLabel: T("Leave") });
  if (ok) exitToTitle();
}
export async function offerDraw(): Promise<void> {
  if (!app.session || app.session.phase !== "active") return;
  const ok = await confirmDialog({ title: T("Offer a draw?"), confirmLabel: T("Offer") });
  if (!ok || !app.session) return;
  const seat = app.hostedClient ? app.hostedClient.seat : app.session.state.turn;
  app.session.submit({ type: "offerDraw", player: seat }, seat);
}
export async function resign(): Promise<void> {
  if (!app.session || app.session.phase !== "active") return;
  const ok = await confirmDialog({ title: T("Resign this round?"), confirmLabel: T("Resign"), danger: true });
  if (!ok || !app.session) return;
  const seat = app.hostedClient ? app.hostedClient.seat : app.session.state.turn;
  app.session.submit({ type: "resign", player: seat }, seat);
}

/** The window was hidden: a local round pauses (hosted rounds keep their clock). */
export function onSuspend(): void {
  if (app.session && app.session.config?.mode !== "hosted" && app.screen === "game" && !app.modals.some((m) => m.kind === "pause")) {
    togglePause(true);
  }
  platform.flushSave();
}

// --- the menus' board ----------------------------------------------------------------------------------------
/** A quiet demo board behind the menus. */
export function attractBoard(): void {
  try {
    const demo = new Session({ mode: "attract", ruleset: "duel", seed: 20260817, players: [{ name: "A", kind: "human" }, { name: "B", kind: "human" }] });
    applyTheme(app.settings.theme);
    render.loadState(demo.state, { snap: true });
    demo.destroy();
  } catch { /* cosmetic only */ }
}

export function copyInviteLink(): void {
  const P = PT();
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(P.copied!, "ok"); } catch { toast(pfmt(P.copyFail, { link }), "info", 6000); }
}

export function consentAnswer(consent: boolean): void {
  app.settings.telemetryConsent = consent;
  platform.saveSettings(app.settings);
}

// --- labels shared with the HUD and results -----------------------------------------------------------------------
export function objectiveTitle(config: Any, lesson: Any): string {
  if (lesson) return T("Lesson: {title}", { title: T(lesson.title) });
  switch (config?.mode) {
    case "practice": return T("Practice");
    case "journey": return T("Journey · {stage}", { stage: config.contentId });
    case "daily": return T("Daily Court");
    case "challenge": return T("Challenge");
    case "hosted": return T("Hosted round");
    case "local": return T("Pass & Play");
    default: return T("Crown Draughts");
  }
}
export function objectiveSub(config: Any): string {
  const bits: string[] = [];
  if (config?.ruleset) bits.push(T(RULESETS[config.ruleset]?.name || config.ruleset));
  if (config?.ranked) bits.push(T("ranked"));
  if (config?.goal?.maxPlies) bits.push(T("win in {n}", { n: config.goal.maxPlies }));
  return bits.join(" · ");
}
export function modeLabel(config: Any): string {
  return objectiveTitle(config, null) + (config?.ruleset ? ` — ${T(RULESETS[config.ruleset]?.name)}` : "");
}
