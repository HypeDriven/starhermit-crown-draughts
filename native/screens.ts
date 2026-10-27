// Every screen, dialog and the in-round HUD on starhermit:ui, drawn each
// frame from the app's state (the browser build's js/ui/screens.js, the HUD
// of js/ui/app.js and the semantic board of js/ui/boarddom.js). Layout
// follows the old style sheet's breakpoints: rails beside the board on wide
// windows; drawers over it with a bottom tray on compact ones (narrower than
// 1024 logical px, or a short landscape window); a single column with a
// two-row tray on phones held upright.
import { frame, openMenu } from "starhermit:engine";
import { bindingLabel } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { isPlayable, playerStats, squareName } from "../js/rules/engine.js";
import { AI_LEVELS, COSMETICS, LESSONS, RULESETS, THEMES } from "./data.ts";
import { JOURNEY_STAGES, JOURNEY_CHAPTERS, stageUnlocked, journeyStats } from "../js/content/index.js";
import { CHALLENGES, constraintSummary } from "../js/content/challenges.js";
import { MASTERY_TRACK, nextMilestone } from "../js/content/themes.js";
import { ACHIEVEMENTS } from "../js/content/achievements.js";
import { msUntilNextDaily } from "../js/content/daily.js";
import { ACTIONS } from "../js/ui/actions.js";
import { platformStrings, pfmt } from "../js/ui/platform-i18n.js";
import { N, T } from "./i18n.ts";
import * as audio from "./audio.ts";
import * as platform from "./platform.ts";
import * as A from "./app.ts";
import { app } from "./app.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const PT = (): Record<string, string> => platformStrings();

// ------------------------------------------------------------------ viewport and helpers
let VW = 1280, VH = 720, SCALE = 1;
function measureViewport(): void {
  const f = frame();
  SCALE = ui.preferences().scale || 1;
  const sa = f.safeArea;
  VW = Math.max(1, (f.width - sa.left - sa.right) / SCALE);
  VH = Math.max(1, (f.height - sa.top - sa.bottom) / SCALE);
}
const compact = (): boolean => VW < 1024 || (VH < 560 && VW > VH);
const phone = (): boolean => VW < 760 && VH > VW;
const landscapeShort = (): boolean => VH < 560 && VW > VH;

function btn(label: string, cls: string | false = false, opts: ui.ButtonOptions = {}): boolean {
  const hit = ui.style("btn", cls).button(label, opts);
  if (hit) audio.play("uiClick");
  return hit;
}
function lbl(text: string, cls = "text"): void { ui.style(cls).label(text); }
function para(text: string, width: number, cls = "text"): void { ui.style(cls).paragraph(text, Math.max(40, width)); }
function heading(text: string, cls = "h2"): void { ui.style(cls).heading(text); }
/** Wraps buttons into rows that fit `width` (rows do not flex-wrap). */
function buttonRows(id: string, items: { label: string; cls?: string | false; opts?: ui.ButtonOptions; run: () => void }[], width: number, justify: ui.Align = "start"): void {
  const gap = 8;
  const rows: typeof items[] = [];
  let cur: typeof items = [], used = 0;
  for (const it of items) {
    const w = ui.measureText(it.label, { kind: "button", style: ["btn", ...(it.cls ? [it.cls] : [])] }).width / SCALE;
    if (cur.length && used + gap + w > width) { rows.push(cur); cur = []; used = 0; }
    used += (cur.length ? gap : 0) + w;
    cur.push(it);
  }
  if (cur.length) rows.push(cur);
  ui.column(`${id}-rows`, () => {
    rows.forEach((row, ri) => ui.row(`${id}-r${ri}`, () => {
      for (const it of row) if (btn(it.label, it.cls ?? false, it.opts)) it.run();
    }, { spacing: gap, justify, width }));
  }, { spacing: gap, width });
}

// Content heights from last frame (vertical centring of short screens).
const heights = new Map<string, number>();
/** A scrolling screen with its content column centred (`maxW` logical px wide at most). */
function screen(id: string, maxW: number, build: (w: number) => void): void {
  const w = Math.min(maxW, VW - 32);
  const contentH = heights.get(id) ?? 0;
  const top = Math.max(16, (VH - contentH) / 2);
  const scrollTo = frame().frame - app.scrollTop < 3 ? { top: 0 } : undefined;
  ui.scrollArea(`${id}-scroll`, { width: VW, height: VH }, () => {
    ui.column(`${id}-outer`, () => {
      const r = ui.column(`${id}-content`, () => build(w), { width: w, spacing: 10 });
      heights.set(id, r.height / SCALE);
    }, { width: VW, align: "center", padding: { top, bottom: 20 } });
  }, scrollTo ? { scrollTo } : {});
}

/** A small drawn glyph (no emoji in text: they draw as tofu). */
type Glyph = "star" | "crown" | "lock" | "dot" | "check";
function glyph(kind: Glyph, size: number, color: string): void {
  ui.widget(`glyph`, {
    role: "none", size: { width: size, height: size },
    draw: (r) => drawGlyph(kind, r.x + r.width / 2, r.y + r.height / 2, Math.min(r.width, r.height) / 2, color),
  });
}
function drawGlyph(kind: Glyph, cx: number, cy: number, rad: number, color: string): void {
  if (kind === "dot") { draw.circle(cx, cy, rad * 0.8, color); return; }
  if (kind === "star") {
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? rad * 0.42 : rad;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    draw.polygon(pts, color);
    return;
  }
  if (kind === "crown") {
    const w = rad * 1.8, h = rad * 1.3, x0 = cx - w / 2, y0 = cy - h / 2;
    draw.polygon([[x0, y0 + h], [x0, y0 + h * 0.25], [x0 + w * 0.25, y0 + h * 0.6], [cx, y0], [x0 + w * 0.75, y0 + h * 0.6], [x0 + w, y0 + h * 0.25], [x0 + w, y0 + h]], color);
    return;
  }
  if (kind === "lock") {
    draw.strokeArc(cx, cy - rad * 0.15, rad * 0.45, Math.PI, Math.PI * 2, color, Math.max(1, rad * 0.18));
    draw.roundRect(cx - rad * 0.7, cy - rad * 0.15, rad * 1.4, rad * 1.05, rad * 0.15, color);
    return;
  }
  draw.line(cx - rad * 0.6, cy, cx - rad * 0.15, cy + rad * 0.5, color, Math.max(1.5, rad * 0.25));
  draw.line(cx - rad * 0.15, cy + rad * 0.5, cx + rad * 0.7, cy - rad * 0.5, color, Math.max(1.5, rad * 0.25));
}

/** A radio group of cards (the browser build's fieldset of radio cards). */
function radioGroup<V>(id: string, legend: string, options: { value: V; label: string; desc?: string }[], current: V, width: number, onChange: (v: V) => void): void {
  ui.column(`${id}-group`, () => {
    lbl(legend, "legend");
    ui.column(`${id}-opts`, () => {
      for (const o of options) {
        const on = o.value === current;
        const hit = ui.id(`${id}-${String(o.value)}`).style("radio-card").button(o.label, {
          selected: on,
          content: () => {
            lbl(o.label, "card-name");
            if (o.desc) para(o.desc, width - 28, "muted");
          },
        });
        if (hit && !on) { audio.play("toggle"); onChange(o.value); }
      }
    }, { spacing: 6, width, role: "radiogroup", align: "stretch" });
  }, { spacing: 6, width });
}

/** A two-column facts table (the browser build's <dl class="setup-facts">). */
function facts(id: string, rows: [string, string][], width: number): void {
  const dt = Math.min(200, width * 0.4);
  ui.grid(`${id}-facts`, () => {
    for (const [k, v] of rows) {
      lbl(k, "fact-dt");
      para(v, width - dt - 16, "fact-dd");
    }
  }, { columns: [{ width: dt }, { fr: 1 }], gap: { row: 4, column: 16 }, width });
}

function panel(id: string, width: number, build: (inner: number) => void, cls = "setup-form"): void {
  const blur = A.app.game ? false : !!currentBudgetBlur;
  ui.column(id, () => build(width - 46), { width, spacing: 10, style: blur && cls === "setup-form" ? "setup-form-blur" : cls });
}
let currentBudgetBlur = false;
export function setHudBlur(v: boolean): void { currentBudgetBlur = v; }

// ------------------------------------------------------------------ title
function titleScreen(): void {
  screen("title", 420, (w) => {
    ui.column("title-block", () => {
      ui.column("emblem", () => { /* the emblem image is the box's background */ }, { width: 112, height: 112, style: "emblem-img" });
      // The browser build's clamp(2.4rem, 7vw, 4.4rem).
      ui.style("game-title", { text: { size: Math.max(38.4, Math.min(70.4, VW * 0.07)) } }).heading(T("Crown Draughts"));
      para(T("A carved stone board in a royal garden."), w, "tagline");
    }, { align: "center", spacing: 8, width: w });
    ui.id("title-actions").column(T("Main menu"), () => {
      const resume = A.pendingSnapshot();
      if (resume && btn(T("Resume round — {label}", { label: resume.label }), "btn-primary", {})) A.resumeSnapshot();
      if (ui.id("play").style("btn", "btn-primary", "btn-xl").button(T("Play"))) { audio.play("uiConfirm"); A.go("modes"); }
      const date = A.todayDaily().date.slice(5);
      if (ui.id("daily").style("btn").button(T("Daily Court — {date}", { date }))) A.startDaily();
      if (btn(T("Journey"))) A.go("journey");
      if (btn(T("Learn the rules"))) A.go("learn");
    }, { spacing: 10, width: Math.min(340, w), align: "stretch" });
    ui.column("title-foot", () => {
      buttonRows("title-footer", [
        { label: T("Profile"), cls: "btn-dark", run: () => A.openModal({ kind: "profile" }) },
        { label: T("Settings"), cls: "btn-dark", run: () => A.openModal({ kind: "settings", tab: 0 }) },
        { label: T("Help"), cls: "btn-dark", run: () => A.openModal({ kind: "help" }) },
      ], w, "center");
      const P = PT();
      if (!platform.signedIn()) {
        buttonRows("title-signin", [{ label: P.signIn!, cls: "btn-ghost", run: () => A.signIn() }], w, "center");
      } else {
        ui.style("note", { text: { align: "center" } }).paragraph(pfmt(P.playingAs, { name: app.profile.name }), w);
        if (platform.inviteLink()) buttonRows("title-invite", [{ label: P.invite!, cls: "btn-ghost", run: () => A.copyInviteLink() }], w, "center");
      }
    }, { spacing: 10, width: w, align: "center", padding: { top: 14 } });
  });
}

// ------------------------------------------------------------------ modes
const MODES = [
  { id: "learn", name: N("Learn"), desc: N("Interactive lessons — one rule at a time, hands on the stones."), time: N("2–5 min each"), players: N("Solo"), ranked: false },
  { id: "journey", name: N("Journey"), desc: N("48 authored stages across six garden courts."), time: N("3–10 min each"), players: N("Solo vs AI"), ranked: false },
  { id: "daily", name: N("Daily Court"), desc: N("One shared seed and ruleset per UTC day. Ranked."), time: N("~10 min"), players: N("Solo vs AI"), ranked: true },
  { id: "practice", name: N("Practice"), desc: N("Pick a ruleset and difficulty. Undo and hints allowed; never ranked."), time: N("5–15 min"), players: N("Solo vs AI"), ranked: false },
  { id: "challenge", name: N("Challenge"), desc: N("Move limits, speed trials, altered layouts, restricted tools."), time: N("2–15 min"), players: N("Solo / local"), ranked: false },
  { id: "hosted", name: N("Hosted Play"), desc: N("Private invite codes and public matches against other players."), time: N("10–20 min"), players: N("2–4 online"), ranked: true },
  { id: "local", name: N("Pass & Play"), desc: N("Two to four commanders, one device, including Royal Melee."), time: N("10–25 min"), players: N("2–4 local"), ranked: false },
];
function openMode(id: string): void {
  if (id === "practice") A.go("practice");
  else if (id === "local") A.go("local");
  else if (id === "journey") A.go("journey");
  else if (id === "learn") A.go("learn");
  else if (id === "challenge") A.go("challenges");
  else if (id === "hosted") { A.go("lobby"); if (platform.signedIn()) A.loadInvites(); }
  else if (id === "daily") A.startDaily();
}
function modesScreen(): void {
  screen("modes", 960, (w) => {
    heading(T("Choose your court"));
    const gap = 13;
    const cols = phone() ? 1 : Math.max(1, Math.floor((w + gap) / (240 + gap)));
    const cw = (w - gap * (cols - 1)) / cols;
    ui.grid("mode-grid", () => {
      for (const m of MODES) {
        const hit = ui.id(`mode-${m.id}`).style("mode-card").button(T(m.name), {
          content: () => {
            lbl(T(m.name), "card-title");
            if (!phone()) para(T(m.desc), cw - 34, "card-body");
            lbl(`${T(m.players)} · ${T(m.time)} · ${m.ranked ? T("ranked") : T("unranked")}`, "card-meta");
          },
        });
        if (hit) { audio.play("uiConfirm"); openMode(m.id); }
      }
    }, { columns: cols, gap, width: w, align: "stretch" });
    if (btn(T("Back"), "btn-ghost")) A.go("title");
  });
}

// ------------------------------------------------------------------ setups
function actionsRow(id: string, w: number, items: { label: string; cls?: string | false; run: () => void }[]): void {
  buttonRows(id, items, w);
}
function practiceScreen(): void {
  const s = A.formState("practice", () => ({ ruleset: "duel", level: "apprentice", side: 0 }));
  screen("practice", 560, (w) => panel("practice-form", w, (iw) => {
    heading(T("Practice"));
    radioGroup("rs", T("Ruleset"), Object.values(RULESETS).filter((r: Any) => r.playerCount === 2).map((r: Any) => ({ value: r.id, label: T(r.name), desc: T(r.description) })), s.ruleset, iw, (v) => { s.ruleset = v; });
    radioGroup("ai", T("Opponent"), Object.values(AI_LEVELS).map((l: Any) => ({ value: l.id, label: `${T(l.name)} (${l.rating})`, desc: T(l.blurb) })), s.level, iw, (v) => { s.level = v; });
    radioGroup("side", T("Your house"), [{ value: 0, label: T("Ivory (moves first)") }, { value: 1, label: T("Onyx") }], s.side, iw, (v) => { s.side = v; });
    para(T("Undo and hints are allowed. Practice never touches your rating."), iw, "note");
    actionsRow("practice-actions", iw, [
      { label: T("Back"), cls: "btn-ghost", run: () => A.go("modes") },
      { label: T("Take your seat"), cls: "btn-primary", run: () => A.startPractice(s) },
    ]);
  }));
}
function localScreen(): void {
  const s = A.formState("local", () => ({ ruleset: "duel", names: [T("Ivory"), T("Onyx"), T("Jade"), T("Ember")], count: 2 }));
  screen("local", 560, (w) => panel("local-form", w, (iw) => {
    heading(T("Pass & Play"));
    radioGroup("lrs", T("Ruleset"), ["duel", "grand", "melee"].map((id) => ({ value: id, label: T(RULESETS[id].name), desc: T(RULESETS[id].description) })), s.ruleset, iw, (v) => {
      s.ruleset = v;
      if (s.count > RULESETS[v].playerCount) s.count = RULESETS[v].playerCount;
    });
    const n = s.ruleset === "melee" ? s.count : 2;
    for (let i = 0; i < n; i++) {
      lbl(T("House {n} ({house})", { n: i + 1, house: T(["Ivory", "Jade", "Onyx", "Ember"][i] || "") }), "legend");
      s.names[i] = ui.textField(`name-${i}`, s.names[i] ?? "", { maxChars: 18, width: iw });
    }
    if (s.ruleset === "melee") {
      radioGroup("count", T("Commanders"), [2, 3, 4].map((k) => ({ value: k, label: T("{n} commanders", { n: k }), desc: k < 4 ? T("Each extra house is passed around the table.") : "" })), s.count, iw, (v) => { s.count = v; });
    }
    actionsRow("local-actions", iw, [
      { label: T("Back"), cls: "btn-ghost", run: () => A.go("modes") },
      { label: T("Begin"), cls: "btn-primary", run: () => A.startLocal(s) },
    ]);
  }));
}

export function goalText(goal: Any): string {
  if (!goal || (!goal.maxPlies && !Number.isFinite(goal.maxLost) && !goal.minPiecesLeft)) return T("Win the round.");
  const parts: string[] = [];
  if (goal.maxPlies) parts.push(T("within {n} plies", { n: goal.maxPlies }));
  if (Number.isFinite(goal.maxLost)) parts.push(T("losing at most {n} pieces", { n: goal.maxLost }));
  if (goal.minPiecesLeft) parts.push(T("with at least {n} pieces left", { n: goal.minPiecesLeft }));
  return T("Win {conditions}.", { conditions: parts.join(T(", ")) });
}

function journeyScreen(): void {
  const progress = platform.getProgress();
  const stats = journeyStats(progress);
  screen("journey", 720, (w) => {
    heading(T("Journey"));
    para(T("{done} of {total} stages · {stars} of {maxStars} stars", { done: stats.completed, total: stats.total, stars: stats.stars, maxStars: stats.maxStars }), w, "muted");
    const next = nextMilestone(stats.stars);
    if (next) para(T("Next mastery reward at {stars} stars: {reward}", { stars: next.stars, reward: T(next.label) }), w, "muted");
    for (const ch of JOURNEY_CHAPTERS) {
      ui.column(`chapter-${ch.id}`, () => {
        heading(`${ch.id.toUpperCase()} — ${T(ch.name)}`, "h3");
        para(T(ch.blurb), w - 34, "muted");
        const cols = VW < 760 ? 4 : 8;
        const gap = 6;
        const cell = Math.min(72, (w - 34 - gap * (cols - 1)) / cols);
        ui.grid(`stages-${ch.id}`, () => {
          for (const s of JOURNEY_STAGES.filter((x: Any) => x.chapter === Number(ch.id.slice(2)))) {
            const rec = progress.journey[s.id];
            const unlocked = stageUnlocked(progress, s);
            const name = rec?.completed ? T("{name}, completed with {stars} stars", { name: T(s.name), stars: rec.stars })
              : T(unlocked ? "{name}, available" : "{name}, locked", { name: T(s.name) });
            const hit = ui.id(`stage-${s.id}`).style("stage-cell", rec?.completed && "stage-done", s.mastery && "stage-mastery",
              { width: cell, height: cell }).button(name, {
              disabled: !unlocked,
              content: () => {
                ui.style("text", { text: { align: "center" } }).label(String(s.index));
                ui.row("stars", () => {
                  if (rec?.completed) for (let k = 0; k < rec.stars; k++) glyph("star", 10, "#d4af37");
                  else if (!unlocked) glyph("lock", 12, "#c9c0a8");
                  else if (s.mastery) glyph("crown", 12, "#d4af37");
                  else glyph("dot", 6, "#d4af37");
                }, { spacing: 1, justify: "center" });
              },
            });
            if (hit && unlocked) { audio.play("uiConfirm"); A.go("stage-setup", s); }
          }
        }, { columns: cols, gap });
      }, { width: w, spacing: 6, style: "chapter" });
    }
    if (btn(T("Back"), "btn-ghost")) A.go("modes");
  });
}

function stageSetupScreen(): void {
  const stage = app.screenData;
  if (!stage) { A.go("journey"); return; }
  const ruleset = RULESETS[stage.ruleset];
  screen("stage", 560, (w) => panel("stage-form", w, (iw) => {
    heading(T(stage.name));
    para(`${T(JOURNEY_CHAPTERS[stage.chapter - 1].name)} · ${T("Stage {n}", { n: stage.index })}${stage.mastery ? ` · ${T("Mastery trial")}` : ""}`, iw, "muted");
    if (stage.blurb) para(T(stage.blurb), iw);
    facts("stage", [
      [T("Court"), `${T(ruleset.name)} (${ruleset.size}×${ruleset.size})`],
      [T("Opponent"), T(AI_LEVELS[stage.ai]?.name || "None")],
      [T("Goal"), goalText(stage.goal)],
      [T("Par"), T("{n} plies", { n: stage.par })],
      [T("Ranked"), T("No")],
    ], iw);
    actionsRow("stage-actions", iw, [
      { label: T("Back"), cls: "btn-ghost", run: () => A.go("journey") },
      { label: T("Play stage"), cls: "btn-primary", run: () => A.startJourneyStage(stage) },
    ]);
  }));
}

function learnScreen(): void {
  const done = new Set(platform.getProgress().lessonsComplete);
  screen("learn", 560, (w) => {
    heading(T("Learn the court"));
    para(T("Each lesson teaches one rule and asks you to play it. Lessons use the same legal-move engine as every other mode."), w);
    for (const lesson of LESSONS) {
      const isDone = done.has(lesson.id);
      const hit = ui.id(`lesson-${lesson.id}`).style("mode-card", isDone && "card-done").button(T(lesson.title), {
        content: () => {
          lbl(T(lesson.title), "card-name");
          para(T(lesson.intro), w - 34, "muted");
          ui.row("meta", () => {
            lbl(T("{n} min", { n: lesson.minutes }), "card-meta");
            if (isDone) { lbl("·", "card-meta"); glyph("check", 12, "#8fd18a"); }
          }, { spacing: 4 });
        },
      });
      if (hit) { audio.play("uiConfirm"); A.startLesson(lesson.id); }
    }
    if (btn(T("Back"), "btn-ghost")) A.go("modes");
  });
}

function challengesScreen(): void {
  const progress = platform.getProgress();
  screen("challenges", 620, (w) => {
    heading(T("Challenges"));
    for (const c of CHALLENGES) {
      const rec = progress.challenges[c.id];
      const hit = ui.id(`ch-${c.id}`).style("mode-card", rec?.completed && "card-done").button(T(c.name), {
        content: () => {
          lbl(T(c.name), "card-title");
          para(T(c.desc), w - 34, "card-body");
          para(`${constraintSummary(c, T)}${rec?.completed ? ` · ${T("best {score}", { score: rec.bestScore })}` : ""}`, w - 34, "card-meta");
        },
      });
      if (hit) { audio.play("uiConfirm"); A.go("challenge-setup", c); }
    }
    if (btn(T("Back"), "btn-ghost")) A.go("modes");
  });
}

function challengeSetupScreen(): void {
  const c = app.screenData;
  if (!c) { A.go("challenges"); return; }
  screen("challenge", 560, (w) => panel("challenge-form", w, (iw) => {
    heading(T(c.name));
    para(T(c.desc), iw);
    facts("challenge", [
      [T("Court"), T(RULESETS[c.ruleset].name)],
      [T("Opponent"), c.ai ? T(AI_LEVELS[c.ai].name) : T("Local players")],
      [T("Constraints"), constraintSummary(c, T)],
      [T("Ranked"), T("No")],
    ], iw);
    actionsRow("challenge-actions", iw, [
      { label: T("Back"), cls: "btn-ghost", run: () => A.go("challenges") },
      { label: T("Begin challenge"), cls: "btn-primary", run: () => A.startChallenge(c) },
    ]);
  }));
}

function dailyScreen(): void {
  const def = A.todayDaily();
  const progress = platform.getProgress();
  const rec = progress.daily[def.date];
  const countdown = msUntilNextDaily(new Date(platform.nowMs()));
  screen("daily", 560, (w) => panel("daily-form", w, (iw) => {
    heading(T("Daily Court — {date}", { date: def.date }));
    para(T("One seed and ruleset per UTC day — the same for every player. Ranked."), iw);
    facts("daily", [
      [T("Court"), T(RULESETS[def.ruleset].name)],
      [T("Opponent"), T(AI_LEVELS[def.ai].name)],
      [T("Goal"), goalText(def.goal)],
      [T("Today"), rec?.completed ? (rec.won ? T("Won — score {score}", { score: rec.score }) : T("Played")) : T("Not yet played")],
      [T("Next court in"), `${Math.floor(countdown / 3600000)}h ${Math.floor((countdown % 3600000) / 60000)}m`],
      [T("Streak"), T("{n} day(s)", { n: progress.stats.dailyStreak })],
    ], iw);
    if (rec?.excluded) para(T("This day was marked defective and is excluded from ranking."), iw, "note-warn");
    const entries = Object.entries(progress.daily as Record<string, Any>).sort(([a], [b]) => b.localeCompare(a)).slice(0, 7);
    if (entries.length) {
      heading(T("Your recent dailies"), "h3");
      for (const [date, r] of entries) {
        para(`${date} — ${T(r.won ? "won, score {score}" : "played, score {score}", { score: r.score })}${r.excluded ? ` ${T("(excluded from ranking)")}` : ""}`, iw, "muted");
      }
    }
    actionsRow("daily-actions", iw, [
      { label: T("Back"), cls: "btn-ghost", run: () => A.go("title") },
      { label: rec?.completed ? T("Play again (unranked)") : T("Play the Daily"), cls: "btn-primary", run: () => A.startDaily() },
    ]);
  }));
}

// ------------------------------------------------------------------ hosted play
function lobbyScreen(): void {
  screen("lobby", 560, (w) => panel("lobby-form", w, (iw) => {
    heading(T("Hosted play"));
    if (!platform.signedIn()) {
      para(T("Hosted play needs a connection to a game host. You are playing standalone, so only Pass & Play is available."), iw, "note-warn");
      actionsRow("lobby-off", iw, [
        { label: T("Back"), cls: "btn-ghost", run: () => A.go("modes") },
        { label: T("Pass & Play instead"), cls: "btn-primary", run: () => A.go("local") },
      ]);
      return;
    }
    const s = A.formState("lobby", () => ({ ruleset: "duel", listed: false, clock: false }));
    heading(T("Host a table"), "h3");
    radioGroup("hrs", T("Ruleset"), Object.values(RULESETS).map((r: Any) => ({ value: r.id, label: `${T(r.name)} (${T(r.playersLabel)})`, desc: T(r.description) })), s.ruleset, iw, (v) => { s.ruleset = v; });
    const listed = ui.checkbox(T("List publicly (open matching)"), s.listed);
    if (listed !== s.listed) { s.listed = listed; audio.play("toggle"); }
    const clock = ui.checkbox(T("90-second turn deadline"), s.clock);
    if (clock !== s.clock) { s.clock = clock; audio.play("toggle"); }
    actionsRow("host", iw, [{ label: T("Create table"), cls: "btn-primary", run: () => { void A.hostTable(s); } }]);
    heading(T("Join a table"), "h3");
    actionsRow("join", iw, [{ label: T("Join an open table"), cls: "btn-primary", run: () => { void A.quickJoinTable(); } }]);
    para(T("Open tables fill instantly. Private tables arrive as friend invites — there are no join codes on the platform."), iw, "note");
    const P = PT();
    heading(P.tableInvites!, "h3");
    if (app.invites === null) lbl("…", "note");
    else if (!app.invites.length) lbl(P.noInvites!, "note");
    else for (const inv of app.invites) {
      ui.row(`inv-${inv.id}`, () => {
        lbl(pfmt(P.from, { name: inv.name }));
        ui.spacer();
        if (ui.id(`join-${inv.id}`).style("btn", "btn-primary").button(P.join!)) void A.acceptTableInvite(inv.id);
      }, { width: iw, align: "center", spacing: 8 });
    }
    actionsRow("lobby-back", iw, [{ label: T("Back"), cls: "btn-ghost", run: () => A.go("modes") }]);
  }));
}

function tableRoomScreen(): void {
  const client = app.hostedClient;
  if (!client) { A.go("lobby"); return; }
  screen("table", 560, (w) => panel("table-form", w, (iw) => {
    heading(T("Your table"));
    lbl(T("Join code: {code}", { code: client.joinCode || "—" }), "join-code");
    for (const p of client.players) {
      ui.column(`seat-${p.seat}`, () => {
        para(T(p.connected ? "{name} — rating {rating}" : "{name} (away) — rating {rating}", { name: T(p.name), rating: p.rating }), iw);
      }, { width: iw, style: "mastery-row" });
    }
    const isHost = client.seat === 0;
    if (isHost) { if (btn(T("Start the round"), "btn-primary")) void A.startHostedRound(); }
    else btn(T("Waiting for the host…"), "btn-primary", { disabled: true });
    if (isHost) {
      const P = PT();
      heading(P.inviteFriends!, "h3");
      if (app.friends === null) lbl("…", "note");
      else if (!app.friends.length) lbl(P.noFriends!, "note");
      else for (const f of app.friends) {
        ui.row(`friend-${f.userId}`, () => {
          lbl(`${f.name} · ${f.online ? P.online : P.offline}`);
          ui.spacer();
          if (ui.id(`invite-${f.userId}`).style("btn", "btn-small").button(f.invited ? P.invited! : P.sendInvite!, { disabled: !!f.invited || !!f.busy })) void A.inviteFriend(f);
        }, { width: iw, align: "center", spacing: 8 });
      }
    }
    para(T("Voice rooms are available from the host shell once everyone joins. Voice is never required to play."), iw, "note");
    actionsRow("table-leave", iw, [{ label: T("Leave table"), cls: "btn-ghost", run: () => A.leaveHosted() }]);
  }));
}

// ------------------------------------------------------------------ results
function resultsScreen(): void {
  const r = app.lastResults;
  if (!r) { A.go("title"); return; }
  const { over, outcome } = r;
  const me = outcome.mySeat;
  const brk = over.breakdowns[me];
  const goalMissed = over.goalMet === false && over.winner !== null && outcome.iWon;
  const headline = goalMissed ? T("Goal Missed") : over.winner === null ? T("A Truce")
    : outcome.iWon ? T("Victory") : outcome.localMultiplayer ? T("{name} wins", { name: T(over.winnerName || "A house") }) : T("Defeat");
  const banner = over.winner === null ? null : (goalMissed || (!outcome.iWon && !outcome.localMultiplayer)) ? "banner-defeat" : "banner-victory";
  const tone = goalMissed ? "result-loss" : over.winner === null ? "result-draw" : outcome.iWon ? "result-win" : "result-loss";
  screen("results", 520, (w) => panel("results-panel", w, (iw) => {
    if (banner) ui.column("banner", () => { /* the illustration is the box's background */ }, { width: iw, height: iw * 384 / 896, style: banner });
    ui.style(tone).paragraph(headline, iw);
    ui.style("center-muted").paragraph(T(over.reasonText), iw);
    heading(T("Score breakdown"), "legend");
    const rows: [string, number][] = [
      [T("Captures"), brk.components.captures], [T("Crowns taken"), brk.components.crowns], [T("Pieces preserved"), brk.components.survival],
      [T("Objective"), brk.components.objective], [T("Efficiency"), brk.components.efficiency], [T("Speed"), brk.components.timeBonus],
      [T("Slips"), brk.components.penalties],
    ];
    ui.grid("breakdown", () => {
      for (const [label, val] of rows) {
        lbl(label, "bd-label");
        ui.style(val < 0 ? "bd-neg" : "bd-value").label(val > 0 ? `+${val}` : String(val));
      }
      lbl(T("Total"), "bd-total");
      ui.style("bd-total", { text: { align: "end" } }).label(String(brk.total));
    }, { columns: [{ fr: 1 }, { width: "auto", align: "end" }], gap: { row: 6, column: 12 }, width: iw, rowStyle: "bd-row" });
    const f = [T("{n} plies", { n: over.plies })];
    if (Number.isFinite(over.elapsedMs)) f.push(`${(over.elapsedMs / 1000).toFixed(0)}s`);
    if (outcome.ratingDelta) f.push(T("rating {delta}", { delta: `${outcome.ratingDelta > 0 ? "+" : ""}${outcome.ratingDelta}` }));
    if (over.assistsUsed) f.push(T("assists used"));
    ui.row("facts-row", () => {
      ui.style("center-muted").label(f.join(" · "));
      if (outcome.stars) { ui.style("center-muted").label("·"); for (let k = 0; k < outcome.stars; k++) glyph("star", 14, "#d4af37"); }
    }, { spacing: 4, justify: "center", width: iw, align: "center" });
    for (const key of outcome.unlocked || []) {
      const a = ACHIEVEMENTS.find((x: Any) => x.key === key);
      if (a) para(T("Achievement: {name} — {desc}", { name: T(a.name), desc: T(a.desc) }), iw, "unlock");
    }
    for (const m of outcome.mastery || []) para(T("Mastery reward: {reward}", { reward: T(m.label) }), iw, "unlock");
    const lb = A.leaderboardLine();
    if (lb) ui.style("center-muted").paragraph(lb, iw);
    const items: { label: string; cls?: string | false; run: () => void }[] = [];
    if (outcome.nextAction) items.push({ label: outcome.nextAction.label(), cls: "btn-primary", run: outcome.nextAction.fn });
    items.push({ label: T("Play again"), run: () => A.retryLast() });
    items.push({ label: T("Leave"), cls: "btn-ghost", run: () => A.exitToTitle() });
    actionsRow("results-actions", iw, items);
  }));
}

// ------------------------------------------------------------------ the in-round HUD
function hudTopbar(): void {
  const s = app.session;
  const st = s.state;
  ui.place("topbar", "top", () => {
    ui.row("topbar-row", () => {
      ui.column("topbar-left", () => {
        ui.style("hud-title").label(A.objectiveTitle(s.config, app.lessonRun?.lesson));
        const sub = A.objectiveSub(s.config);
        if (sub) ui.style("objective-sub").label(sub);
      }, { spacing: 2 });
      ui.spacer();
      ui.row("topbar-right", () => {
        if (st?.phase === "active") {
          const pl = st.players[st.turn];
          const mine = app.hostedClient ? st.turn === app.hostedClient.seat : pl.kind === "human";
          const text = T(mine ? "{name} to move — you" : "{name} to move", { name: T(pl.name) });
          ui.row("turn", () => {
            ui.widget("turn-color", { role: "none", size: { width: 10, height: 18 }, draw: (r) => draw.roundRect(r.x, r.y, r.width, r.height, 3, COLOR_HEX[pl.color] || "#e8ddc4") });
            // Phones: the banner wraps beside the title and the Pause button.
            if (phone()) ui.style("text", { text: { size: 13, weight: "700" } }).paragraph(text, Math.max(90, VW - 250));
            else ui.label(text);
          }, { style: "turn-banner", spacing: 8, align: "center" });
        }
        if (app.clock && !phone()) clocks();
        if (app.thinking) ui.style("thinking").label("…");
        if (ui.id("pause").style("btn", "btn-ghost").button(T("Pause"))) { audio.play("uiClick"); A.togglePause(true); }
      }, { spacing: 10, align: "center" });
    }, { width: VW, align: "start", padding: { top: 8, bottom: 8, start: 12, end: 12 }, style: "topbar" });
    if (app.clock && phone()) ui.row("clock-row", () => clocks(), { spacing: 8, padding: { start: 12 } });
  });
}
const COLOR_HEX: Record<string, string> = { ivory: "#e8ddc4", onyx: "#3a3f4a", jade: "#4a8a68", ember: "#b05038" };
function clocks(): void {
  const st = app.session.state;
  app.clock!.forEach((ms, i) => {
    const total = Math.max(0, Math.round(ms / 1000));
    const txt = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
    const cls = total <= 10 ? "clock-low" : i === app.clockTurn ? "clock-active" : "clock";
    ui.style(cls, { text: { numerals: "tabular" } }).label(`${T(st.players[i]?.name) || i}: ${txt}`);
  });
}

function railCard(id: string, w: number, build: (iw: number) => void, cls = "rail-card"): void {
  ui.column(id, () => build(w - 28), { width: w, spacing: 6, style: currentBudgetBlur && cls === "rail-card" ? "rail-card-blur" : cls });
}
function coachCard(w: number): void {
  const c = app.coach;
  if (!c) return;
  railCard("coach", w, (iw) => {
    para(c.title, iw, "rail-h");
    para(c.text, iw, "text");
    if (c.kind === "action") para(T("Your turn — play the move."), iw, "lesson-goal");
    else if (ui.id("coach-continue").style("btn", "btn-primary").button(T("Continue"))) {
      audio.play("uiConfirm");
      // The lesson may end (and the round with it): after this frame's UI.
      queueMicrotask(() => A.lessonAdvance());
    }
  }, "coach-card");
}
function leftRail(w: number, h: number, withCoach: boolean): void {
  const s = app.session;
  const st = s.state;
  const config = s.config;
  ui.column("rail-left", () => {
    if (withCoach) coachCard(w);
    railCard("progress", w, (iw) => {
      heading(T("Progress"), "rail-h");
      const bits: string[] = [];
      if (config?.par) bits.push(T("Par: {par} plies (now {ply})", { par: config.par, ply: st.ply }));
      if (config?.goal?.maxPlies) bits.push(T("Must win by ply {n} (now {ply})", { n: config.goal.maxPlies, ply: st.ply }));
      if (config?.goal?.maxLost != null) bits.push(T("Lose at most {n} pieces", { n: config.goal.maxLost }));
      bits.push(T("Draw clock: {n}/{max}", { n: st.sinceProgress, max: RULESETS[st.ruleset].drawPlies }));
      for (const b of bits) para(b, iw, "fact");
    });
    railCard("moves", w, (iw) => {
      heading(T("Moves"), "rail-h");
      ui.scrollArea("move-log", { width: iw, height: Math.max(60, h) }, () => {
        app.log.forEach((e, i) => para(`${i + 1}. ${e.render ? e.render() : e.text}`, iw - 12, "log-line"));
      }, { scrollTo: { top: Infinity } });
    });
  }, { spacing: 10, width: w });
}
function rightRail(w: number, chatH: number): void {
  const s = app.session;
  const st = s.state;
  const hosted = s.config.mode === "hosted";
  ui.column("rail-right", () => {
    railCard("actions", w, (iw) => {
      heading(T("Actions"), "rail-h");
      const bw = (iw - 6) / 2;
      ui.grid("action-grid", () => {
        const b = (label: string, run: () => void): void => { if (ui.style("btn", "btn-ghost", { width: bw, padding: 6 }).button(label)) { audio.play("uiClick"); run(); } };
        b(T("Undo"), () => app.game?.requestUndo());
        b(T("Hint"), () => app.game?.requestHint());
        b(T("Offer draw"), () => { void A.offerDraw(); });
        b(T("Resign"), () => { void A.resign(); });
        b(T("Camera"), () => A.cycleCamera());
        b(T("HTML board"), () => A.toggleBoard());
      }, { columns: 2, gap: 6, width: iw });
    });
    railCard("houses", w, (iw) => {
      heading(T("Houses"), "rail-h");
      const stats = playerStats(st);
      st.players.forEach((pl: Any, i: number) => {
        const sti = stats[i];
        ui.row(`house-${i}`, () => {
          glyph("dot", 10, COLOR_HEX[pl.color] || "#e8ddc4");
          ui.style("player-name").label(T(pl.name));
          ui.spacer();
          ui.style("player-mat").label(String(sti.piecesLeft));
          glyph("dot", 9, "#c9c0a8");
          ui.style("player-mat").label(String(sti.crownedLeft));
          glyph("crown", 11, "#c9c0a8");
        }, { width: iw, spacing: 4, align: "center", style: i === st.turn ? "player-row-active" : "player-row" });
      });
    });
    if (hosted) railCard("chat", w, (iw) => {
      heading(T("Chat"), "rail-h");
      ui.scrollArea("chat-log", { width: iw, height: chatH }, () => {
        for (const m of app.chat) para(`${m.name}: ${m.text}`, iw - 12, "chat-line");
      }, { scrollTo: { top: Infinity } });
      ui.row("chat-compose", () => {
        app.chatDraft = ui.textField("chat-input", app.chatDraft, { maxChars: 240, width: iw - 80, placeholder: T("Message…"), arrows: false });
        if (btn(T("Send"), "btn-primary") || ui.submitted("chat-input")) void A.sendChat();
      }, { spacing: 6, align: "center" });
    });
  }, { spacing: 10, width: w });
}

function tray(): void {
  const left = !!app.settings.accessibility.leftHanded;
  const items: { label: string; run: () => void; drawer?: "left" | "right" }[] = [
    { label: T("Info"), drawer: "left", run: () => { app.drawer = app.drawer === "left" ? null : "left"; } },
    { label: T("Undo"), run: () => app.game?.requestUndo() },
    { label: T("Hint"), run: () => app.game?.requestHint() },
    { label: T("Draw"), run: () => { void A.offerDraw(); } },
    { label: T("Pause"), run: () => A.togglePause(true) },
    { label: T("Actions"), drawer: "right", run: () => { app.drawer = app.drawer === "right" ? null : "right"; } },
  ];
  if (left) items.reverse();
  ui.place("tray", "bottom", () => {
    const w = VW - 20;
    buttonRows("tray-buttons", items.map((it) => ({
      label: it.label, cls: it.drawer && app.drawer === it.drawer ? "btn-dark" : "btn-ghost",
      opts: it.drawer ? { selected: app.drawer === it.drawer } : {},
      run: it.run,
    })), w, "center");
  }, { width: VW, style: "tray", padding: { top: 8, bottom: 10, start: 10, end: 10 } });
}
const TRAY_H = (): number => (phone() ? 116 : 64);

/** The semantic board (the browser build's HTML board): every playable square a button. */
function semanticBoard(g: NonNullable<typeof app.game>, maxSize: number, bottom: number): void {
  const st = g.state;
  const n = st.size;
  const size = Math.max(160, Math.min(maxSize, 460));
  const cell = (size - 12 - 2 * (n - 1)) / n;
  ui.place("dom-board", { anchor: "bottom", y: bottom }, () => {
    ui.id("board-grid").grid(T("Game board"), () => {
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const playable = isPlayable(n, r, c);
        if (!playable) {
          ui.widget(`v-${r}-${c}`, { role: "none", size: { width: cell, height: cell } });
          continue;
        }
        const info = g.cellInfo(r, c);
        const cursor = g.cursor.r === r && g.cursor.c === c;
        const pl = info.piece ? st.players[info.piece.owner] : null;
        const name = info.piece
          ? `${squareName(r, c)}: ${T(info.piece.crowned ? "{name} crowned piece" : "{name} piece", { name: T(pl.name) })}${info.selected ? T(", selected") : ""}`
          : `${squareName(r, c)}: ${T("empty")}${info.target ? T(" — legal destination") : ""}`;
        const res = ui.id(`cell-${r}-${c}`).widget(name, {
          role: "button", size: { width: cell, height: cell },
          draw: (rect, state) => drawCell(rect, info, pl?.color ?? null, cursor, state.highContrast),
        });
        if (res.activated) g.onCell(r, c);
      }
    }, { columns: n, gap: 2 });
  }, { style: "board-panel", padding: 6 });
}
function drawCell(r: ui.Rect, info: ReturnType<NonNullable<typeof app.game>["cellInfo"]>, color: string | null, cursor: boolean, hc: boolean): void {
  let bg = "#3c414c";
  if (info.capture) bg = "#7a4a2c"; else if (info.target) bg = paletteTarget();
  draw.roundRect(r.x, r.y, r.width, r.height, 3 * SCALE, bg);
  const ring = (c: string, wpx: number): void => draw.strokeRoundRect(r.x + wpx / 2, r.y + wpx / 2, r.width - wpx, r.height - wpx, 3 * SCALE, c, wpx);
  if (info.capture) ring("#ff9a5c", 3 * SCALE);
  else if (info.target) ring(paletteTargetRing(), 3 * SCALE);
  if (info.selected) ring("#ffd873", 3 * SCALE);
  else if (info.last) ring("rgba(255,255,255,0.5)", 2 * SCALE);
  if (cursor) ring(hc ? "#ffff00" : "#7fb2e0", 3 * SCALE);
  if (!info.piece || !color) return;
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2, rad = r.width * 0.3;
  if (info.piece.crowned) draw.circle(cx, cy, rad * 1.35, "rgba(255,216,115,0.35)");
  if (color === "ivory") draw.circle(cx, cy, rad, "#f4ecd8");
  else if (color === "onyx") draw.strokeCircle(cx, cy, rad * 0.85, "#15181f", Math.max(2, rad * 0.35));
  else if (color === "jade") draw.polygon([[cx, cy - rad], [cx + rad, cy], [cx, cy + rad], [cx - rad, cy]], "#67c498");
  else draw.polygon([[cx, cy - rad], [cx + rad, cy + rad * 0.8], [cx - rad, cy + rad * 0.8]], "#e07050");
  if (info.piece.crowned) drawGlyph("crown", cx, cy - rad * 0.05, rad * 0.55, "#d4af37");
}
const paletteTarget = (): string => (["deuteranopia", "protanopia"].includes(app.settings.accessibility.colorPalette) ? "#2c5a7a" : "#4c7a3c");
const paletteTargetRing = (): string => (["deuteranopia", "protanopia"].includes(app.settings.accessibility.colorPalette) ? "#6ab0ff" : "#a8e890");

function gameHud(): void {
  if (!app.session || !app.game) return;
  const game = app.game;
  const isCompact = compact();
  const left = !!app.settings.accessibility.leftHanded;
  hudTopbar();
  const topY = 64;
  // The semantic board first: the rails, drawers and tray draw (and take the pointer) over it.
  if (app.boardShown) {
    const bottom = isCompact ? TRAY_H() + 12 : 12;
    // Phones keep the 3D board in view above the (smaller) semantic board.
    semanticBoard(game, phone() ? Math.min(VW * 0.62, VH * 0.3) : Math.min(VW * 0.92, VH * 0.46), bottom);
  }
  if (!isCompact) {
    const railH = VH - topY - 16;
    const logH = railH - 240 - (app.coach ? 170 : 0);
    ui.place("rail-l", { anchor: left ? "top-end" : "top-start", x: 10, y: topY }, () => leftRail(250, logH, true));
    ui.place("rail-r", { anchor: left ? "top-start" : "top-end", x: 10, y: topY }, () => rightRail(230, Math.max(60, Math.min(VH * 0.4, railH - 330))));
  } else {
    if (app.coach) {
      const cw = Math.min(VW * 0.94, 544);
      if (landscapeShort()) ui.place("coach-dock", { anchor: "top-start", x: 10, y: 52 }, () => coachCard(Math.min(VW * 0.4, 320)));
      else ui.place("coach-dock", { anchor: "top", y: topY }, () => coachCard(cw));
    }
    const drawerW = Math.min(320, VW * 0.84);
    const drawerBottom = TRAY_H() + 4;
    // A drawer scrolls when it is taller than the room between the top bar and the tray.
    const room = VH - topY - drawerBottom - 8;
    const drawer = (id: string, build: () => void): void => {
      const h = heights.get(id) ?? 0;
      if (h > room) ui.scrollArea(`${id}-scroll`, { width: drawerW + 12, height: room }, () => { const r = ui.column(id, build, { spacing: 0 }); heights.set(id, r.height / SCALE); });
      else { const r = ui.column(id, build, { spacing: 0 }); heights.set(id, r.height / SCALE); }
    };
    if (app.drawer === "left") ui.place("drawer-l", { anchor: left ? "bottom-end" : "bottom-start", x: 10, y: drawerBottom }, () => drawer("drawer-l-c", () => leftRail(drawerW, Math.min(160, VH * 0.2), false)));
    if (app.drawer === "right") ui.place("drawer-r", { anchor: left ? "bottom-start" : "bottom-end", x: 10, y: drawerBottom }, () => drawer("drawer-r-c", () => rightRail(drawerW, Math.min(120, VH * 0.18))));
    tray();
  }
  if (app.countdown && app.countdown.i >= 0 && app.countdown.i < app.countdown.steps.length) {
    ui.place("countdown", "center", () => { ui.style("countdown").label(app.countdown!.steps[app.countdown!.i]!); });
  }
}

// ------------------------------------------------------------------ toasts and the consent banner
function toasts(): void {
  if (!app.toasts.length) return;
  const bottom = app.screen === "game" && compact() ? TRAY_H() + 12 : 76;
  ui.place("toasts", { anchor: "bottom", y: bottom }, () => {
    for (const t of app.toasts) {
      const cls = t.kind === "warn" ? "toast-warn" : t.kind === "ok" ? "toast-ok" : "toast";
      const max = Math.min(VW - 64, 520);
      const tw = ui.measureText(t.text, { style: cls }).width / SCALE;
      if (tw <= max) ui.style(cls).label(t.text);
      else ui.column(`toast-${t.until}`, () => { ui.style(cls === "toast" ? "text" : cls === "toast-ok" ? { text: { color: "$ok" } } : { text: { color: "$warn" } }).paragraph(t.text, max); }, { style: cls });
    }
  }, { spacing: 6, align: "center" });
}
function consentBanner(): void {
  if (app.settings.telemetryConsent !== null || app.screen === "game" || app.modals.length) return;
  const w = Math.min(480, VW - 24);
  ui.place("consent", { anchor: "bottom", y: 12 }, () => {
    para(T("Help improve Crown Draughts with anonymous usage stats (round start/end, tutorial steps, errors). No text, pointers, or personal data — ever. Off by default."), w - 36, "muted");
    ui.row("consent-actions", () => {
      ui.spacer();
      if (btn(T("No thanks"))) A.consentAnswer(false);
      if (btn(T("Allow"), "btn-primary")) A.consentAnswer(true);
    }, { spacing: 8, width: w - 36 });
  }, { width: w, spacing: 8, style: "consent-banner" });
}

// ------------------------------------------------------------------ dialogs
/** A modal card: a heading, a scrolling body and a pinned footer. Returns false once Back closes it. */
function card(id: string, title: string, width: number, body: (w: number) => void, footer?: (w: number) => void): void {
  const w = Math.min(width, VW - 24) - 44;
  const maxBody = VH * 0.86 - 140;
  const bodyH = heights.get(id) ?? 0;
  const open = ui.dialog(id, "", true, () => {
    ui.column(`${id}-col`, () => {
      if (title) heading(title);
      const inner = (): void => {
        const r = ui.column(`${id}-body`, () => body(w - 14), { width: w - 14, spacing: 8 });
        heights.set(id, r.height / SCALE);
      };
      if (bodyH > maxBody) ui.scrollArea(`${id}-scroll`, { width: w, height: maxBody }, inner, frame().frame - app.modalOpenedAt < 3 ? { scrollTo: { top: 0 } } : {});
      else inner();
      if (footer) footer(w);
    }, { width: w, spacing: 10 });
  });
  if (!open && frame().frame !== app.modalOpenedAt) A.closeModal();
}

function pauseDialog(): void {
  const hosted = app.session?.config?.mode === "hosted";
  card("pause", T("Paused"), 380, (w) => {
    if (hosted) para(T("Hosted round: the clock keeps running while you are away."), w, "note");
    ui.column("pause-actions", () => {
      if (ui.id("resume").style("btn", "btn-primary").button(T("Resume"))) { A.closeModal(); }
      if (btn(T("Settings"))) A.openModal({ kind: "settings", tab: 0 });
      if (btn(T("How to play"))) A.openModal({ kind: "help" });
      if (btn(T("Leave round"), "btn-danger")) void A.leaveRound();
    }, { spacing: 8, width: w, align: "stretch" });
  });
}

function confirmModal(m: Extract<A.Modal, { kind: "confirm" }>): void {
  card("confirm", m.title, 420, (w) => { if (m.body) para(m.body, w); }, (w) => {
    ui.row("confirm-actions", () => {
      ui.spacer();
      if (btn(T("Cancel"), "btn-ghost")) A.answerConfirm(false);
      if (ui.id("confirm-ok").style("btn", m.danger ? "btn-danger" : "btn-primary").button(m.confirmLabel)) { audio.play("uiConfirm"); A.answerConfirm(true); }
    }, { spacing: 8, width: w });
  });
}

function expiredModal(m: Extract<A.Modal, { kind: "expired" }>): void {
  const P = PT();
  card("expired", m.terms ? P.termsTitle! : P.expiredTitle!, 460, (w) => para(m.terms ? P.termsBody! : P.expiredBody!, w), (w) => {
    buttonRows("expired-actions", [
      { label: P.keepPlaying!, cls: "btn-ghost", run: () => A.closeModal() },
      { label: P.signIn!, cls: "btn-primary", run: () => { A.closeModal(); A.signIn(); } },
    ], w, "end");
  });
}

function helpModal(): void {
  card("help", T("How the court works"), 720, (w) => {
    const cards: [string, string][] = [
      [T("Moving"), T("Pieces step one square diagonally forward along the dark squares. Tap a piece to see where it may go; glowing squares are legal destinations.")],
      [T("Capturing"), T("Jump over an adjacent enemy piece onto the empty square beyond to capture it. Captures are mandatory — if one exists, the court refuses quiet moves.")],
      [T("Chains"), T("After a jump, if the same piece can jump again, it must. Chains end when no jump remains. Long chains are the soul of the game.")],
      [T("Crowning"), T("A piece that reaches the far edge is crowned. Crowns move and capture in all four diagonal directions. Crowning ends the turn immediately.")],
      [T("Winning"), T("Capture every enemy piece, or leave the enemy with no legal move. Draws come from threefold repetition, long capture-less stretches, or agreement.")],
      [T("Royal Melee"), T("Four houses on a wide court, each advancing from its own edge. Last house standing takes the garden.")],
    ];
    const cols = w > 480 ? 2 : 1;
    const cw = (w - 10 * (cols - 1)) / cols;
    ui.grid("help-grid", () => {
      for (const [title, body] of cards) ui.column(`help-${title}`, () => { heading(title, "h3"); para(body, cw - 30); }, { style: "help-card", width: cw, spacing: 4 });
    }, { columns: cols, gap: 10, width: w });
    heading(T("Controls"), "h3");
    ui.grid("controls", () => {
      for (const a of ACTIONS) {
        lbl(T(a.label), "fact-dt");
        let key = "—";
        try { key = bindingLabel(a.id) || "—"; } catch { /* undeclared */ }
        lbl(key, "fact-dd");
      }
    }, { columns: [{ fr: 1 }, { width: "auto" }], gap: { row: 4, column: 12 }, width: w, rowStyle: "bd-row" });
    para(T("Gamepad: d-pad or left stick moves the cursor, A confirms, B cancels, Start pauses. Rebind everything in Settings → Controls."), w, "note");
  }, (w) => buttonRows("help-close", [{ label: T("Close"), cls: "btn-primary", run: () => A.closeModal() }], w, "end"));
}

const SETTINGS_TABS = [N("Graphics"), N("Accessibility"), N("Privacy")];
function settingsModal(m: Extract<A.Modal, { kind: "settings" }>): void {
  const s = app.settings;
  card("settings", T("Settings"), 720, (w) => {
    ui.row("settings-tabs", () => {
      SETTINGS_TABS.forEach((label, i) => {
        if (ui.id(`tab-${i}`).style("tab").button(T(label), { selected: m.tab === i }) && m.tab !== i) { audio.play("tabSwitch"); m.tab = i; }
      });
    }, { spacing: 5, role: "radiogroup" });
    if (m.tab === 0) {
      lbl(T("Camera"), "legend");
      const camIds = ["classic", "low", "top"];
      const ci = ui.select(T("Camera"), Math.max(0, camIds.indexOf(s.camera.preset)), [T("Classic"), T("Low (near the stone)"), T("Top-down")]);
      if (camIds[ci] !== s.camera.preset) { s.camera = { preset: camIds[ci]! }; A.saveSettings(); }
      lbl(T("Garden theme"), "legend");
      const themes = Object.values(THEMES) as Any[];
      const ti = ui.select(T("Garden theme"), Math.max(0, themes.findIndex((t) => t.id === s.theme)), themes.map((t) => T(t.name)));
      if (themes[ti].id !== s.theme) { s.theme = themes[ti].id; A.saveSettings(); A.applyTheme(app.session?.config?.theme || s.theme); }
    } else if (m.tab === 1) {
      const a = s.accessibility;
      const toggle = (label: string, value: boolean, hint: string, set: (v: boolean) => void): void => {
        const v = ui.checkbox(label, value);
        if (v !== value) { audio.play("toggle"); set(v); A.saveSettings(); }
        if (hint) para(hint, w, "small");
      };
      toggle(T("Left-handed controls"), a.leftHanded, T("Moves the action tray to the left."), (v) => { a.leftHanded = v; });
      toggle(T("Always show HTML board"), a.domBoard, T("A fully playable semantic board beside the 3D scene."), (v) => { a.domBoard = v; app.boardShown = v; });
      toggle(T("Timing assistance"), a.timingAssist, T("Clocks run at half speed for you in solo play."), (v) => { a.timingAssist = v; });
      toggle(T("Haptics"), a.haptics, "", (v) => { a.haptics = v; });
      lbl(T("Color-vision palette"), "legend");
      const pals = ["default", "deuteranopia", "protanopia", "tritanopia"];
      const pi = ui.select(T("Color palette"), Math.max(0, pals.indexOf(a.colorPalette)), [T("Default palette"), T("Deuteranopia-safe"), T("Protanopia-safe"), T("Tritanopia-safe")]);
      if (pals[pi] !== a.colorPalette) { a.colorPalette = pals[pi]!; A.saveSettings(); }
      if (btn(T("Replay tutorial lessons"), "btn-ghost")) { app.modals = []; if (app.session) A.exitToTitle("learn"); else A.go("learn"); }
    } else {
      const consent = s.telemetryConsent === true;
      const v = ui.checkbox(T("Anonymous usage stats"), consent);
      if (v !== consent) { audio.play("toggle"); A.consentAnswer(v); }
      para(T("Only funnel events: start, tutorial step, round end, retry, settings change, error. Never text or pointers."), w, "small");
      para(T("Progress is stored on this device and, when signed in through the host, synced as a versioned cloud save. No credentials or chat content are ever placed in saves."), w, "note");
    }
    para(T("Sound, graphics quality, controls, language, text size, high contrast and reduced motion are in the StarHermit Options (F1)."), w, "note");
  }, (w) => buttonRows("settings-foot", [
    { label: T("StarHermit Options"), cls: "btn-ghost", run: () => openMenu() },
    { label: T("Close"), cls: "btn-primary", run: () => A.closeModal() },
  ], w, "end"));
}

function profileModal(): void {
  const p = app.profile;
  const progress = platform.getProgress();
  const st = progress.stats;
  const stats = journeyStats(progress);
  card("profile", T("Profile"), 720, (w) => {
    lbl(T("Display name"), "legend");
    const name = ui.textField("profile-name", p.name, { maxChars: 24, width: Math.min(w, 360) });
    if (name !== p.name) { p.name = name; A.saveProfile(); }
    lbl(T("Avatar color"), "legend");
    ui.row("swatches", () => {
      for (const c of ["#d4af37", "#7fb2e0", "#4a8a68", "#b05038", "#9a5fd0", "#e8e0c0"]) {
        const on = p.avatar.color === c;
        const res = ui.id(`swatch-${c}`).widget(T("Color {value}", { value: c }), {
          role: "radio", checked: on, size: { width: 40, height: 40 }, style: "swatch",
          draw: (r) => { draw.circle(r.x + r.width / 2, r.y + r.height / 2, r.width / 2 - 3 * SCALE, c); if (on) draw.strokeCircle(r.x + r.width / 2, r.y + r.height / 2, r.width / 2 - 1 * SCALE, "#f2ecdc", 2 * SCALE); },
        });
        if (res.activated && !on) { p.avatar = { ...p.avatar, color: c }; A.saveProfile(); audio.play("toggle"); }
      }
    }, { spacing: 8, role: "radiogroup" });
    facts("profile", [
      [T("Rating (duel / grand)"), `${p.rating.duel} / ${p.rating.grand}`],
      [T("Rounds played"), String(st.roundsCompleted)],
      [T("Wins"), String(st.wins)],
      [T("Daily wins"), T("{n} (best streak {best})", { n: st.dailyWins, best: st.bestDailyStreak })],
      [T("Journey"), T("{done}/{total} stages, {stars} stars", { done: stats.completed, total: stats.total, stars: stats.stars })],
      [T("Longest chain"), String(st.bestChain)],
    ], w);
    heading(T("Achievements"), "h3");
    const have = new Set(progress.achievements);
    const cols = w > 600 ? 3 : w > 380 ? 2 : 1;
    const cw = (w - 8 * (cols - 1)) / cols;
    ui.grid("ach-grid", () => {
      for (const a of ACHIEVEMENTS) {
        const on = have.has(a.key);
        ui.column(`ach-${a.key}`, () => { lbl(T(a.name), "card-name"); para(on ? T(a.desc) : "???", cw - 24, "small"); }, { style: on ? "ach-unlocked" : "ach-card", width: cw, spacing: 2 });
      }
    }, { columns: cols, gap: 8, width: w });
    heading(T("Mastery track"), "h3");
    for (const ms of MASTERY_TRACK) {
      const claimed = stats.stars >= ms.stars;
      ui.row(`mastery-${ms.stars}`, () => {
        ui.style(claimed ? "mastery-on" : "muted").label(String(ms.stars));
        glyph("star", 12, claimed ? "#d4af37" : "#c9c0a8");
        ui.style(claimed ? "mastery-on" : "muted").label(T(ms.label));
        ui.spacer();
        if (claimed) glyph("check", 14, "#d4af37");
      }, { width: w, spacing: 8, align: "center", style: "mastery-row" });
    }
    heading(T("Cosmetics"), "h3");
    const slots: [string, string][] = [["material", N("Material")], ["trail", N("Trail")], ["surround", N("Surround")], ["flourish", N("Flourish")]];
    const ccols = w > 480 ? 2 : 1;
    const ccw = (w - 16 * (ccols - 1)) / ccols;
    ui.grid("cosmetics", () => {
      for (const [slot, slotLabel] of slots) {
        ui.column(`cos-${slot}`, () => {
          lbl(T(slotLabel), "legend");
          const opts = (COSMETICS as Any[]).filter((c) => c.slot === slot);
          const cur = Math.max(0, opts.findIndex((c) => c.id === app.settings.cosmetics[slot as keyof typeof app.settings.cosmetics]));
          const idx = ui.select(T(slotLabel), cur, opts.map((c) => {
            const locked = stats.stars < c.unlockStars;
            return { text: `${T(c.name)}${locked ? ` ${T("(unlock at {n}★)", { n: c.unlockStars })}` : ""}`, disabled: locked };
          }));
          if (idx !== cur && stats.stars >= opts[idx].unlockStars) {
            app.settings.cosmetics = { ...app.settings.cosmetics, [slot]: opts[idx].id };
            A.saveSettings();
            A.toast(T("Cosmetic applied."));
          }
        }, { width: ccw, spacing: 4 });
      }
    }, { columns: ccols, gap: { row: 8, column: 16 }, width: w });
  }, (w) => buttonRows("profile-close", [{ label: T("Close"), cls: "btn-primary", run: () => A.closeModal() }], w, "end"));
}

function dialogs(): void {
  const m = A.topModal();
  if (!m) return;
  switch (m.kind) {
    case "pause": pauseDialog(); break;
    case "settings": settingsModal(m); break;
    case "profile": profileModal(); break;
    case "help": helpModal(); break;
    case "confirm": confirmModal(m); break;
    case "expired": expiredModal(m); break;
  }
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  measureViewport();
  switch (app.screen) {
    case "title": titleScreen(); break;
    case "modes": modesScreen(); break;
    case "practice": practiceScreen(); break;
    case "local": localScreen(); break;
    case "journey": journeyScreen(); break;
    case "stage-setup": stageSetupScreen(); break;
    case "learn": learnScreen(); break;
    case "challenges": challengesScreen(); break;
    case "challenge-setup": challengeSetupScreen(); break;
    case "daily": dailyScreen(); break;
    case "lobby": lobbyScreen(); break;
    case "table-room": tableRoomScreen(); break;
    case "results": resultsScreen(); break;
    case "game": gameHud(); break;
  }
  consentBanner();
  toasts();
  dialogs();
}
