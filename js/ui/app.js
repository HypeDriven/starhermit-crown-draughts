// App: the UI orchestrator. Owns services (settings, progress, profile,
// platform, audio, renderer, input), the screen state machine, the game
// lifecycle, overlays, and the ui facade the game controller talks to.

import { RenderFacade } from '../render/index.js';
import { audio } from '../core/audio.js';
import { platform } from '../core/platform.js';
import { Session, verifyReplay } from '../core/session.js';
import { HostedSessionClient } from '../core/hosted.js';
import {
  loadSettings, saveSettings, loadProfile, saveProfile, loadProgress, saveProgress,
  loadProgressDoc, adoptProgressDoc, loadCloudSave, writeCloudSave, compareSaves, archiveSave,
  saveSessionSnapshot, loadSessionSnapshot, clearSessionSnapshot, adoptCloudSaveDoc,
} from '../core/storage.js';
import { applyRoundResult } from '../core/progress.js';
import { dailyDefinition } from '../content/daily.js';
import { contentSetup, JOURNEY_STAGES } from '../content/index.js';
import { THEMES } from '../content/themes.js';
import { lessonById, LESSONS } from '../content/lessons.js';
import { AI_LEVELS } from '../rules/ai.js';
import { playerStats, RULESETS } from '../rules/engine.js';
import { DomBoard } from './boarddom.js';
import { InputManager, DEFAULT_KEYBOARD } from './input.js';
import { platformStrings, pfmt } from './platform-i18n.js';
import { T, onLanguage, initLanguage } from '../i18n/index.js';
import { setTextTranslator, describeAction } from '../rules/engine.js';
import { mergeProgress } from '../core/progress.js';
import { GameController } from './gameview.js';
import { el, button, Modal, confirmDialog } from './widgets.js';
import * as screens from './screens.js';

export class App {
  constructor() {
    this.settings = loadSettings();
    this.profile = loadProfile();
    this.progress = loadProgress();
    this.platform = platform;
    this.audio = audio;
    this.renderer = null;
    this.input = null;
    this.domBoard = null;
    this.session = null;
    this.game = null;
    this.hostedClient = null;
    this.lastConfig = null;
    this.lessonRun = null;
    this.dailyDef = null;
    this._screen = 'boot';
    this._modals = [];
    this._forms = {};
    this._screenData = null;
    this._openModals = new Set();
    this._log = [];
    this._coach = null;
  }

  /** Per-screen form state, kept across language re-renders and reset on navigation. */
  formState(screen, init) {
    if (!this._forms[screen]) this._forms[screen] = init();
    return this._forms[screen];
  }

  async boot() {
    // Engine/session announcements and move descriptions follow the game language.
    setTextTranslator(T);
    this.language = initLanguage();
    onLanguage(() => this._onLanguage());
    this._grabDom();
    this._buildDomBoard();
    this.input = new InputManager({ onAction: (a, meta) => this._onInputAction(a, meta) });
    this.input.applyOverrides(this.settings.bindings);
    this.input.applyGamepadOverrides(this.settings.gamepad);
    this.input.start();
    this.renderer = new RenderFacade(this.$scene, {
      onCompat: () => this._showCompatNotice(),
    });
    this.applyGraphicsSettings();
    this.applyAccessSettings();
    this.applyTheme();
    await this.platform.init();
    this.platform.setTelemetryConsent(this.settings.telemetryConsent === true);
    // Signed in: the account nickname replaces the local guest name, the cloud
    // slot seeds the synced save before the conflict check runs, platform
    // preferences and key bindings win over the local ones.
    this.platform.onAuth((signedIn, reason) => {
      if (!signedIn && reason === 'expired') this.showSessionExpired();
      else if (!signedIn) this.ui.toast(platformStrings().signedOut, 'warn', 4000);
      if (this._screen === 'title') this.go('title');
      this._syncFromPlatform();
    });
    this.platform.onSaveConflict(() => this._mergeCloudConflict());
    this._syncFromPlatform();
    this._wireLifecycle();
    this._applyTextSize();
    // idle attract board behind the title
    this._attractBoard();
    this.go('title');
    this._checkResumeOffer();
    this._maybeAskConsent();
    // Signed in, the compare waits for the cloud slot (_syncFromPlatform).
    if (!this.platform.hosted) this._syncCloudSave();
    this.platform.track('start', { mode: 'boot' });
  }

  _grabDom() {
    this.$scene = document.getElementById('scene-container');
    this.$gameUi = document.getElementById('game-ui');
    this.$screens = document.getElementById('screens');
    this.$overlay = document.getElementById('overlay-root');
    this.$toast = document.getElementById('toast-region');
    this.$live = document.getElementById('live-region');
    this.$alert = document.getElementById('alert-region');
    this.$topbar = document.getElementById('topbar');
    this.$railLeft = document.getElementById('rail-left');
    this.$railRight = document.getElementById('rail-right');
    this.$tray = document.getElementById('tray-bottom');
    window.addEventListener('resize', () => this._placeCoach());
    this.$domBoardWrap = document.getElementById('dom-board-container');
  }

  _buildDomBoard() {
    this.domBoard = new DomBoard(this.$domBoardWrap, {
      onCell: (r, c) => this.game?.onCell(r, c),
    });
  }

  // ------------------------------------------------------------------
  // Navigation / state machine
  // ------------------------------------------------------------------

  go(screen, data, { refresh = false } = {}) {
    const prev = this._screen;
    this._screen = screen;
    if (!refresh) { this._forms = {}; this._screenData = data; }
    for (const sec of this.$screens.querySelectorAll('.screen')) {
      sec.hidden = sec.dataset.screen !== screen;
    }
    const active = this.$screens.querySelector(`[data-screen="${screen}"]`);
    const inGame = screen === 'game';
    this.$gameUi.hidden = !inGame;
    document.body.dataset.screen = screen;
    if (!inGame && active) {
      const builder = {
        title: () => screens.buildTitle(this, active),
        modes: () => screens.buildModes(this, active),
        practice: () => screens.buildPracticeSetup(this, active),
        local: () => screens.buildLocalSetup(this, active),
        journey: () => screens.buildJourney(this, active),
        'stage-setup': () => screens.buildStageSetup(this, active, data),
        learn: () => screens.buildLearn(this, active),
        challenges: () => screens.buildChallenges(this, active),
        'challenge-setup': () => screens.buildChallengeSetup(this, active, data),
        daily: () => { this.dailyDef = this.dailyDef || dailyDefinition(); screens.buildDailySetup(this, active); },
        lobby: () => screens.buildLobby(this, active),
        'table-room': () => screens.buildTableRoom(this, active, data),
        results: () => { /* built by showResults */ },
      }[screen];
      builder?.();
      if (refresh) return;
      // focus the screen heading for screen readers & keyboard flow
      requestAnimationFrame(() => {
        const h = active.querySelector('h1, h2, [autofocus]');
        if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
      });
      this.announce(T('{name} screen', { name: active.querySelector('h1, h2')?.textContent || screen }));
    }
    if (inGame) {
      requestAnimationFrame(() => this.domBoard.focusCursor());
    }
  }

  _showScreenless(name) { /* helper for dynamic-only screens */ }

  /**
   * The game language changed (Settings → Language, or Automatic resolving
   * the account preference): re-render every visible screen, the in-game HUD,
   * open dialogs and live labels in place. Sessions, sockets, selections and
   * form choices are untouched.
   */
  _onLanguage() {
    if (!this.$screens) return;
    const screen = this._screen;
    if (screen === 'results' && this._lastResults) {
      const r = this._lastResults;
      screens.buildResults(this, this.$screens.querySelector('[data-screen="results"]'), r);
      this._postHighScoreLine(this.$screens.querySelector('[data-screen="results"]'), r);
    } else if (screen !== 'game' && screen !== 'boot') {
      this.go(screen, this._screenData, { refresh: true });
    }
    if (this.session && this.game && screen === 'game') this._refreshGameHud();
    for (const modal of [...this._openModals]) {
      if (!modal.backdrop.isConnected) { this._openModals.delete(modal); continue; }
      modal.relabel?.();
    }
    this._consentRelabel?.();
    this.domBoard?.render();
  }

  /** Track a modal so a language change can relabel it. */
  _trackModal(modal, relabel) {
    if (relabel) modal.relabel = relabel;
    this._openModals.add(modal);
    return modal;
  }

  // ------------------------------------------------------------------
  // Game lifecycle
  // ------------------------------------------------------------------

  openMode(id) {
    if (id === 'practice') return this.go('practice');
    if (id === 'local') return this.go('local');
    if (id === 'journey') return this.go('journey');
    if (id === 'learn') return this.go('learn');
    if (id === 'challenge') return this.go('challenges');
    if (id === 'hosted') return this.go('lobby');
    if (id === 'daily') return this.startDaily();
  }

  openStageSetup(stage) { this.go('stage-setup', stage); }
  openChallengeSetup(c) { this.go('challenge-setup', c); }

  /** Common solo session start. */
  _startSession(config, { lesson = null, lessonStepIndex = 0 } = {}) {
    this._closeAllModals();
    if (!lesson) this.lessonRun = null;
    this._teardownGame();
    const constraints = { ...(config.constraints || {}) };
    if (constraints.clockMs && this.settings.accessibility.timingAssist && !config.players.some((p) => p.kind === 'human' && config.players.filter(q => q.kind === 'human').length > 1)) {
      // timing assistance: the human's clock runs at half speed in solo play
      constraints.clockMs = Math.round(constraints.clockMs * 1.5);
    }
    const session = new Session({ ...config, constraints });
    this.session = session;
    this.lastConfig = config;
    this._enterGame(lesson, lessonStepIndex);
    this.platform.track('start', { mode: config.mode, ruleset: config.ruleset });
  }

  _enterGame(lesson = null, lessonStepIndex = 0) {
    const session = this.session;
    this.applyTheme(session.config.theme);
    this.game = new GameController(this, session, {
      lesson,
      lessonStepIndex,
      onOver: (over) => this._onGameOver(over),
    });
    this._buildGameHud();
    this.go('game');
    this.game.begin();
    if (lesson) this._presentLessonStep();
    this._runCountdown(session);
  }

  /** tutorial/countdown state: brief ready signal; 3-2-1 for clocked rounds. */
  _runCountdown(session) {
    const clocked = !!session.config.constraints?.clockMs;
    session.pause('countdown');
    const overlay = el('div', { class: 'countdown-overlay', role: 'status' });
    document.getElementById('app').appendChild(overlay);
    const steps = clocked ? ['3', '2', '1', T('Go!')] : [T('Ready?')];
    let i = 0;
    const reduced = this.settings.accessibility.reducedMotion;
    const stepMs = clocked ? (reduced ? 500 : 750) : (reduced ? 500 : 900);
    const tick = () => {
      if (i >= steps.length || this.session !== session) {
        overlay.remove();
        if (this.session === session) session.resume();
        return;
      }
      overlay.textContent = steps[i];
      overlay.classList.remove('pop');
      void overlay.offsetWidth;
      overlay.classList.add('pop');
      if (i === steps.length - 1) this.audio.roundStart();
      else this.audio.countdownTick();
      i += 1;
      this._countdownT = setTimeout(tick, stepMs);
    };
    tick();
  }

  _teardownGame() {
    this.game?.destroy();
    this.game = null;
    this.session?.destroy();
    this.session = null;
  }

  startPractice({ ruleset, level, side }) {
    const players = side === 0
      ? [{ name: this.profile.name, kind: 'human' }, { name: `${AI_LEVELS[level].name}`, kind: 'ai', aiLevel: level }]
      : [{ name: `${AI_LEVELS[level].name}`, kind: 'ai', aiLevel: level }, { name: this.profile.name, kind: 'human' }];
    this._startSession({
      mode: 'practice', ruleset, seed: (Math.random() * 0xffffffff) >>> 0,
      players, ranked: false, theme: this.settings.theme,
      contentId: `practice-${ruleset}-${level}`,
    });
  }

  startJourneyStage(stage) {
    const setup = contentSetup(stage);
    this._startSession({
      mode: 'journey', ruleset: stage.ruleset, seed: stage.seed, setup,
      players: [{ name: this.profile.name, kind: 'human' }, { name: AI_LEVELS[stage.ai].name, kind: 'ai', aiLevel: stage.ai }],
      contentId: stage.id, goal: stage.goal, par: stage.par, theme: stage.theme,
      ranked: false,
    });
  }

  startDaily() {
    this.dailyDef = dailyDefinition();
    const def = this.dailyDef;
    const rec = this.progress.daily[def.date];
    this._startSession({
      mode: 'daily', ruleset: def.ruleset, seed: def.seed,
      players: [{ name: this.profile.name, kind: 'human' }, { name: AI_LEVELS[def.ai].name, kind: 'ai', aiLevel: def.ai }],
      contentId: def.id, goal: def.goal, par: def.par, theme: def.theme,
      ranked: !rec?.completed,
      constraints: def.constraints,
    });
  }

  startChallenge(c) {
    if (c.constraints?.localMultiplayer) {
      // melee challenge: local 2–4 commanders
      this.startLocal({ ruleset: 'melee', names: [T('Ivory'), T('Jade'), T('Onyx'), T('Ember')], count: 4, challengeId: c.id });
      return;
    }
    const setup = contentSetup(c);
    this._startSession({
      mode: 'challenge', ruleset: c.ruleset, seed: c.seed, setup,
      players: [{ name: this.profile.name, kind: 'human' }, { name: AI_LEVELS[c.ai].name, kind: 'ai', aiLevel: c.ai }],
      contentId: c.id, goal: c.goal, par: c.par, theme: c.theme,
      constraints: c.constraints || {},
      ranked: false,
    });
  }

  startLocal({ ruleset, names, count, challengeId }) {
    const cap = RULESETS[ruleset].playerCount;
    const players = [];
    for (let i = 0; i < cap; i++) {
      players.push({ name: names[i % Math.max(1, count)] || `House ${i + 1}`, kind: 'human' });
    }
    this._startSession({
      mode: challengeId ? 'challenge' : 'local', ruleset,
      seed: (Math.random() * 0xffffffff) >>> 0,
      players, contentId: challengeId || `local-${ruleset}`,
      theme: this.settings.theme, ranked: false,
    });
  }

  startLesson(lessonId, stepIndex = 0) {
    const lesson = lessonById(lessonId);
    if (!lesson) return;
    this.lessonRun = { lesson, stepIndex };
    const step = lesson.steps[stepIndex];
    if (!step) return this._lessonComplete();
    if (step.kind === 'read') {
      // find next actionable step to prepare its board, but stay in lesson flow
      const nextAction = lesson.steps.slice(stepIndex).find((s) => s.setup);
      if (nextAction) this._lessonSession(lesson, lesson.steps.indexOf(nextAction));
      this._presentLessonStep();
      return;
    }
    this._lessonSession(lesson, stepIndex);
  }

  _lessonSession(lesson, stepIndex) {
    const step = lesson.steps[stepIndex];
    const opponent = step.opponent || 'novice';
    this._teardownGame();
    const session = new Session({
      mode: 'lesson', ruleset: 'duel', seed: 1000 + stepIndex,
      setup: step.setup,
      players: [
        { name: 'You', kind: 'human' },
        { name: 'Garden Novice', kind: 'ai', aiLevel: opponent },
      ],
      contentId: lesson.id,
      theme: 'royal-garden',
    });
    this.session = session;
    this.lessonRun = { lesson, stepIndex };
    this._enterGame(lesson, stepIndex);
  }

  _presentLessonStep() {
    const { lesson, stepIndex } = this.lessonRun;
    const step = lesson.steps[stepIndex];
    if (!step) return this._lessonComplete();
    this.ui.showLessonStep(lesson, step, stepIndex);
  }

  lessonAdvance() {
    const { lesson, stepIndex } = this.lessonRun;
    const next = stepIndex + 1;
    if (next >= lesson.steps.length) return this._lessonComplete();
    const step = lesson.steps[next];
    this.lessonRun.stepIndex = next;
    if (step.kind === 'action' && step.setup) {
      this._lessonSession(lesson, next);
    } else {
      this.game.lessonStepIndex = next;
      this._presentLessonStep();
    }
  }

  _lessonComplete() {
    const { lesson } = this.lessonRun;
    if (!this.progress.lessonsComplete.includes(lesson.id)) {
      this.progress.lessonsComplete.push(lesson.id);
      this._afterProgressChange();
    }
    this.ui.toast(T('Lesson complete: {title}', { title: T(lesson.title) }), 'ok', 4000);
    this.platform.track('tutorial_step', { mode: 'lesson', reason: 'complete' });
    this.exitToTitle('learn');
  }

  // --- hosted ----------------------------------------------------------------

  async hostTable(state) {
    const res = await HostedSessionClient.create(this.platform, {
      ruleset: state.ruleset, name: this.profile.name, listed: state.listed,
      clockMs: null,
      turnDeadlineMs: state.clock ? 90000 : null,
    });
    if (!res.ok) return this.ui.toast(T('Could not create table'), 'warn');
    this.hostedClient = res.client;
    this.hostedClient.connect();
    this._wireHostedOver();
    await this.hostedClient.refresh();
    this.go('table-room', this.hostedClient);
    // auto-transition into the game when it starts
    this.hostedClient.on('state', () => {
      if (this.hostedClient.phase === 'active' && this._screen !== 'game') this._enterHostedGame();
    });
  }

  async quickJoinTable() {
    // Realtime rooms quick-join: any open table for this game.
    const res = await HostedSessionClient.join(this.platform, { name: this.profile.name });
    if (!res.ok) {
      return this.ui.toast(res.error === 'no-open-tables'
        ? T('No open tables right now — host one, or accept a friend invite.')
        : T('Could not join'), 'warn');
    }
    this.hostedClient = res.client;
    this.hostedClient.connect();
    this._wireHostedOver();
    await this.hostedClient.refresh();
    this.go('table-room', this.hostedClient);
    this.hostedClient.on('state', () => {
      if (this.hostedClient.phase === 'active' && this._screen !== 'game') this._enterHostedGame();
    });
  }

  async refreshOpenTables() {
    // The rooms API has no public listing; quick-join replaces browsing.
    return this.quickJoinTable();
  }

  async joinByCode() {
    // Join codes belonged to the old dev-server protocol. On the platform,
    // private tables are friend invites; open tables use quick-join.
    return this.ui.toast(T('Private tables arrive as friend invites — open tables fill from Hosted play.'), 'warn');
  }

  _wireHostedOver() {
    this.hostedClient.on('over', (over) => this._onGameOver(over));
    this.hostedClient.on('authLost', () => this.showSessionExpired());
    // Pending terms consent stops the table socket like auth loss: only the
    // StarHermit launcher can collect it, so the same dialog offers the way back.
    this.hostedClient.on('termsRequired', () => this.showSessionExpired({ terms: true }));
    // The room is gone (closed or no longer ours): the reconnect loop has
    // ended; say so instead of retrying forever.
    this.hostedClient.on('unavailable', () => {
      this.ui.toast(T('This table is no longer available — host a new one or join another.'), 'warn', 6000);
      if (this._screen === 'table-room') this.leaveHosted();
    });
  }

  /** The launch token can no longer be renewed (or terms consent is pending):
   *  say so and offer the way back to StarHermit (relaunch must run from the
   *  click). Closing it leaves any hosted table and keeps playing on this device. */
  showSessionExpired({ terms = false } = {}) {
    if (this._expiredModal?.backdrop.isConnected) return;
    const modal = new Modal(this.$overlay, {
      title: '',
      onClose: () => {
        this._expiredModal = null;
        if (this.hostedClient) this.exitToTitle();
      },
    });
    this._expiredModal = modal;
    modal.box.classList.add('modal-expired');
    const render = () => {
      const PT = platformStrings();
      const title = terms ? PT.termsTitle : PT.expiredTitle;
      modal.setTitle(title);
      const row = el('div', { class: 'modal-actions' });
      row.appendChild(button(PT.keepPlaying, () => { audio.uiBack(); modal.close(); }));
      row.appendChild(button(PT.relaunch, () => {
        audio.uiConfirm();
        if (!this.platform.relaunch()) this.ui.toast(platformStrings().relaunchFailed, 'warn', 5000);
      }, { kind: 'primary', class: 'btn btn-primary btn-relaunch' }));
      modal.box.replaceChildren(
        el('h2', { text: title }),
        el('p', { text: terms ? PT.termsBody : PT.expiredBody, class: 'modal-body' }),
        row,
      );
    };
    render();
    this._trackModal(modal, render);
    modal.box.querySelector('.btn-relaunch')?.focus();
  }

  _enterHostedGame() {
    this.lessonRun = null;
    this._closeAllModals();
    this._teardownGame();
    this.session = this.hostedClient;
    this.lastConfig = this.hostedClient.config;
    this.game = new GameController(this, this.hostedClient, {
      onOver: (over) => this._onGameOver(over),
    });
    this._buildGameHud();
    this.applyTheme(this.settings.theme);
    this.go('game');
    this.game.begin();
    this.audio.roundStart();
    this.ui.toast(T('Round started. Good luck!'), 'ok');
    this.platform.startPresence('playing');
  }

  leaveHosted() {
    this.platform.stopPresence();
    this.hostedClient?.leave();
    this.hostedClient = null;
    this.go('lobby');
  }

  // --- game over / results ---------------------------------------------------

  _onGameOver(over) {
    const config = this.session.config;
    const humanSeats = config.players.map((p, i) => ({ ...p, seat: i })).filter((p) => p.kind === 'human');
    const localMultiplayer = humanSeats.length > 1;
    const mySeat = this.hostedClient ? this.hostedClient.seat : (humanSeats[0]?.seat ?? 0);
    const iWon = localMultiplayer ? false : over.winner === mySeat;
    over.winnerName = over.winner != null ? (config.players[over.winner]?.name || `House ${over.winner + 1}`) : null;
    let outcome = {
      mySeat, iWon, localMultiplayer,
      stars: 0, ratingDelta: 0, unlocked: [], mastery: [],
      nextAction: null,
    };
    if (config.mode !== 'hosted' && config.mode !== 'lesson') {
      const stats = playerStats(this.session.state);
      const before = new Set(this.progress.achievements);
      const applied = applyRoundResult(this.progress, this.profile, config, over, stats);
      outcome = { ...outcome, ...applied };
      this._afterProgressChange();
    }
    if (config.mode === 'lesson') {
      // lessons end through their own flow; a finished free-play step completes it
      if (this.lessonRun) {
        const step = this.lessonRun.lesson.steps[this.lessonRun.stepIndex];
        if (step?.goal && (step.goal.kind === 'finish' || (step.goal.kind === 'finish-win' && over.winner === 0))) {
          setTimeout(() => this.ui.lessonStepComplete(step), 600);
        }
      }
      return;
    }
    clearSessionSnapshot();
    this.platform.track('round_end', { mode: config.mode, ruleset: config.ruleset });
    // next recommended action
    if (config.mode === 'journey' && iWon) {
      const nextStage = this._nextJourneyStage(config.contentId);
      if (nextStage) {
        outcome.nextAction = { label: () => T('Next: {name}', { name: T(nextStage.name) }), fn: () => this.startJourneyStage(nextStage) };
      }
    } else if (config.mode === 'daily') {
      outcome.nextAction = { label: () => T('Back to the garden'), fn: () => this.exitToTitle() };
    }
    setTimeout(() => this.showResults(over, config, outcome), 1100);
  }

  _nextJourneyStage(currentId) {
    const idx = JOURNEY_STAGES.findIndex((s) => s.id === currentId);
    if (idx < 0 || idx + 1 >= JOURNEY_STAGES.length) return null;
    return JOURNEY_STAGES[idx + 1];
  }

  showResults(over, config, outcome) {
    const active = this.$screens.querySelector('[data-screen="results"]');
    this._lastResults = { over, config, outcome };
    screens.buildResults(this, active, { over, config, outcome });
    this._postHighScore(active, over, config, outcome);
    this.go('results');
    if (outcome.stars > 0) this.audio.starAward();
    if (outcome.recordBroken) this.audio.newRecord();
    if (outcome.unlocked?.length) this.audio.achievement();
    if (outcome.mastery?.length) this.audio.masteryUnlock();
    if (config.mode === 'daily' && outcome.iWon && this.progress.stats.dailyStreak >= 3) this.audio.streak();
    this.announce(`${over.winner === null ? T('Draw') : outcome.iWon ? T('Victory') : T('Round over')}. ${T(over.reasonText)}`, true);
  }

  // Signed in, a finished solo round against the AI (not a lesson, Pass & Play
  // or a hosted table) posts the player's total to the platform high-score
  // board; the results screen shows the rank line.
  _postHighScore(root, over, config, outcome) {
    const line = root.querySelector('.result-lb');
    if (!line) return;
    const solo = config.mode !== 'hosted' && config.mode !== 'lesson' && !outcome.localMultiplayer;
    const brk = over.breakdowns && over.breakdowns[outcome.mySeat];
    if (!this.platform.hosted || !solo || !brk) { line.hidden = true; return; }
    line.hidden = false;
    this._lbResult = null;
    this._postHighScoreLine(root);
    this.platform.postHighScore(Math.max(0, Math.round(brk.total))).then((r) => {
      this._lbResult = r;
      this._postHighScoreLine(this.$screens.querySelector('[data-screen="results"]'));
    });
  }

  /** The results leaderboard line in the current language. */
  _postHighScoreLine(root) {
    const line = root?.querySelector('.result-lb');
    if (!line) return;
    const solo = this._lastResults && this._lastResults.config.mode !== 'hosted' && this._lastResults.config.mode !== 'lesson' && !this._lastResults.outcome.localMultiplayer;
    if (!this.platform.hosted || !solo) { line.hidden = true; return; }
    const PT = platformStrings();
    const r = this._lbResult;
    line.hidden = false;
    line.textContent = !r ? PT.lbPosting : !r.posted ? PT.lbNotPosted : r.rank ? pfmt(PT.lbRank, { rank: r.rank }) : PT.lbPosted;
  }

  retryLast() {
    if (!this.lastConfig) return this.go('modes');
    const c = this.lastConfig;
    this.platform.track('retry', { mode: c.mode });
    if (c.mode === 'journey') {
      const stage = { id: c.contentId, ...c };
      return this._startSession({ ...c, seed: c.seed });
    }
    this._startSession({ ...c, seed: (Math.random() * 0xffffffff) >>> 0 });
  }

  exitToTitle(screen = 'title') {
    this._teardownGame();
    this.hostedClient?.leave();
    this.hostedClient = null;
    this.lessonRun = null;
    this._attractBoard();
    this.go(screen);
  }

  // --- snapshot / resume ------------------------------------------------------

  saveSnapshot(snap) {
    const mode = this.session?.config?.mode;
    if (mode === 'hosted' || mode === 'lesson' || mode === 'attract') return; // server is the truth / lessons restart cleanly
    saveSessionSnapshot(snap);
  }

  pendingSnapshot() {
    const snap = loadSessionSnapshot();
    if (!snap || snap.over) return null;
    const label = T('{mode} · ply {n}', { mode: modeLabel(snap.config), n: snap.plyAtSave });
    return { snap, label };
  }

  resumeSnapshot() {
    const pending = this.pendingSnapshot();
    if (!pending) return;
    const { session, away } = Session.restore(pending.snap);
    this.session = session;
    this.lastConfig = session.config;
    this._enterGame(session.config.mode === 'lesson' ? this.lessonRun?.lesson : null);
    this.ui.toast(T('Welcome back — the court is at ply {n}.', { n: away.resumedAtPly }), 'info', 4000);
  }

  _checkResumeOffer() {
    // surfaced on the title screen as the primary Resume button
  }

  // --- overlays ----------------------------------------------------------------

  togglePause(force) {
    if (this._screen !== 'game' || !this.session) return;
    const wantOpen = force ?? !this._pauseModal;
    if (wantOpen && !this._pauseModal) {
      const hosted = this.session.config.mode === 'hosted';
      if (!hosted) this.session.pause('manual');
      this.renderer.setPaused(!hosted);
      this.audio.pause();
      this._pauseModal = new Modal(this.$overlay, {
        title: T('Paused'),
        onClose: () => {
          this._pauseModal = null;
          this.session?.resume();
          this.renderer.setPaused(false);
          this.audio.resume();
        },
      });
      const box = this._pauseModal.box;
      const pauseModal = this._pauseModal;
      const render = () => {
        pauseModal.setTitle(T('Paused'));
        box.replaceChildren(
          el('h2', { text: T('Paused') }),
          hosted ? el('p', { class: 'setup-note', text: T('Hosted round: the clock keeps running while you are away.') }) : '',
          el('div', { class: 'pause-actions' }, [
            button(T('Resume'), () => this._pauseModal?.close(), { kind: 'primary', autofocus: true }),
            button(T('Settings'), () => this.openSettings(), {}),
            button(T('How to play'), () => this.openHelp(), {}),
            button(T('Leave round'), async () => {
              const ok = await confirmDialog(this.$overlay, { title: T('Leave this round?'), body: T('The round will be saved locally unless it is finished.'), confirmLabel: T('Leave') });
              if (ok) { this._pauseModal?.close(); this.exitToTitle(); }
            }, { kind: 'danger' }),
          ]),
        );
      };
      render();
      this._trackModal(pauseModal, render);
      box.querySelector('.btn-primary')?.focus();
    } else if (!wantOpen && this._pauseModal) {
      this._pauseModal.close();
    }
  }

  openSettings() {
    const modal = new Modal(this.$overlay, { title: T('Settings'), wide: true });
    screens.buildSettings(this, modal);
    this._trackModal(modal);
  }

  openProfile() {
    const modal = new Modal(this.$overlay, { title: T('Profile'), wide: true });
    screens.buildProfile(this, modal);
    this._trackModal(modal, () => {
      modal.setTitle(T('Profile'));
      modal.box.replaceChildren();
      screens.buildProfile(this, modal);
    });
  }

  openHelp() {
    const modal = new Modal(this.$overlay, { title: T('Help'), wide: true });
    screens.buildHelp(this, modal);
    this._trackModal(modal, () => {
      modal.setTitle(T('Help'));
      modal.box.replaceChildren();
      screens.buildHelp(this, modal);
    });
  }

  _closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
    this._pauseModal = null;
  }

  // --- settings application -------------------------------------------------------

  saveSettings() {
    saveSettings(this.settings);
    // Only after the platform values were read on boot, so they win.
    if (this.platform.hosted && this._platformSettingsReady) this.platform.patchSettings(this._settingsForPlatform());
  }

  /** Preferences mirrored to the platform settings KV (bindings go to controls). */
  _settingsForPlatform() {
    const s = this.settings;
    return { audio: s.audio, graphics: s.graphics, accessibility: s.accessibility, camera: s.camera, theme: s.theme, cosmetics: s.cosmetics, gamepad: s.gamepad };
  }

  _syncFromPlatform() {
    if (!this.platform.hosted) return;
    this.platform.fetchProfile().then((prof) => {
      if (prof?.name) {
        this.profile.name = prof.name;
        saveProfile(this.profile);
        if (this._screen === 'title') this.go('title');
      }
    }).catch(() => {});
    // Cloud pushes are held (platform.cloudReady) until the slot has been
    // loaded and compared: progress saved meanwhile stays local and is
    // reconciled here, so a stale local doc never overwrites a newer cloud one.
    this.platform.cloudReady = false;
    this.platform.loadCloudSave().then(async (raw) => {
      let remote = null;
      try { remote = raw ? JSON.parse(raw) : null; } catch { /* corrupt remote */ }
      if (remote) {
        adoptCloudSaveDoc(remote);
        await this._syncCloudSave(true);
      } else {
        // Empty slot: seed it with local progress (a progress doc only exists
        // once something was earned).
        const doc = loadProgressDoc();
        if (doc) writeCloudSave(doc.payload, doc.id, true);
      }
    }).catch(() => {}).finally(() => { this.platform.cloudReady = true; });
    this._platformSettingsReady = false;
    this.platform.getSettings().then((remote) => {
      this._platformSettingsReady = true;
      let changed = false;
      for (const k of Object.keys(this._settingsForPlatform())) {
        const v = remote?.[k];
        if (v == null || typeof v !== typeof this.settings[k]) continue;
        this.settings[k] = (v && typeof v === 'object' && !Array.isArray(v) && this.settings[k]) ? { ...this.settings[k], ...v } : v;
        changed = true;
      }
      if (!changed) return;
      saveSettings(this.settings);
      this.input.applyGamepadOverrides(this.settings.gamepad);
      this.audio.applySettings(this.settings.audio);
      this.applyGraphicsSettings();
      this.applyAccessSettings();
      this.applyTheme();
      this._applyTextSize();
    }).catch(() => { this._platformSettingsReady = true; });
    this.platform.loadBindings({ ...DEFAULT_KEYBOARD, ...this.input.keyboard }).then((b) => {
      this.input.keyboard = b; // platform bindings win while signed in
    }).catch(() => {});
  }

  /** Copy the StarHermit invite link and confirm with a toast. */
  copyInviteLink() {
    const PT = platformStrings();
    const link = this.platform.inviteLink();
    if (!link) return;
    const fail = () => this.ui.toast(pfmt(PT.copyFail, { link }), 'info', 6000);
    try { navigator.clipboard.writeText(link).then(() => this.ui.toast(PT.copied, 'ok'), fail); } catch { fail(); }
  }

  /** Guest: accept a friend's table invite and take the seat. */
  async acceptTableInvite(inviteId) {
    const res = await HostedSessionClient.acceptInvite(this.platform, inviteId, { name: this.profile.name });
    if (!res.ok) return this.ui.toast(T('Could not join'), 'warn');
    this._enterTableRoom(res.client);
  }

  async _enterTableRoom(client) {
    this.hostedClient = client;
    this.hostedClient.connect();
    this._wireHostedOver();
    await this.hostedClient.refresh();
    this.go('table-room', this.hostedClient);
    this.hostedClient.on('state', () => {
      if (this.hostedClient.phase === 'active' && this._screen !== 'game') this._enterHostedGame();
    });
  }
  saveProfile() { saveProfile(this.profile); }

  applyAudioSettings() {
    this.audio.applySettings(this.settings.audio);
    this.saveSettings();
    this.platform.track('settings_change', { category: 'audio' });
  }

  applyGraphicsSettings() {
    this.renderer?.setGraphics(this.settings.graphics);
    this.renderer?.setCameraPreset(this.settings.camera.preset);
    this.saveSettings();
  }

  applyAccessSettings() {
    const a = this.settings.accessibility;
    document.body.classList.toggle('reduced-motion', a.reducedMotion);
    document.body.classList.toggle('high-contrast', a.highContrast);
    document.body.classList.toggle('large-text', a.largeText);
    document.body.classList.toggle('left-handed', a.leftHanded);
    document.body.dataset.palette = a.colorPalette;
    let osReduced = false;
    try { osReduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* no media queries */ }
    this.renderer?.setReducedMotion(a.reducedMotion || osReduced);
    this.$domBoardWrap.classList.toggle('pinned', a.domBoard);
    this._applyTextSize();
    this.saveSettings();
  }

  _applyTextSize() {
    // nothing extra — class-driven CSS
  }

  applyTheme(themeId) {
    const theme = themeId || this.settings.theme;
    this.renderer?.setCosmetics(this.settings.cosmetics);
    this.renderer?.setTheme(theme, this.session?.config?.seed || 1);
    document.body.dataset.theme = theme;
    // the ambience bed and music pad follow the theme once audio is unlocked
    if (this.audio.ctx && this._audioThemeId !== theme) {
      this._audioThemeId = theme;
      this.audio.startAmbience(THEMES[theme]);
      this.audio.startMusic(THEMES[theme]);
    }
  }

  /** Show/hide the semantic board and remember the choice for the next round. */
  toggleDomBoard() {
    const on = this.$domBoardWrap.classList.toggle('pinned');
    this.settings.accessibility.domBoard = on;
    this.saveSettings();
    this.announce(on ? T('HTML board shown.') : T('HTML board hidden.'));
    return on;
  }

  cycleCamera() {
    const order = ['classic', 'low', 'top'];
    const cur = order.indexOf(this.settings.camera.preset);
    const next = order[(cur + 1) % order.length];
    this.settings.camera.preset = next;
    this.saveSettings();
    this.renderer.setCameraPreset(next);
    this.audio.cameraMove();
    this.ui.toast(T('Camera: {view}', { view: T({ classic: 'Classic', low: 'Low (near the stone)', top: 'Top-down' }[next]) }));
  }

  // --- input routing ---------------------------------------------------------------

  _onInputAction(action, meta) {
    this.audio.ensure();
    if (action === 'mute') {
      this.settings.audio.muted = !this.settings.audio.muted;
      this.applyAudioSettings();
      this.ui.toast(this.settings.audio.muted ? T('Muted') : T('Sound on'));
      return;
    }
    if (action === 'help') { this.openHelp(); return; }
    if (action === 'board') {
      this.toggleDomBoard();
      return;
    }
    if (this._screen === 'game' && this.game) {
      const handled = this.game.handleAction(action);
      if (!handled && action === 'cancel') this.togglePause();
      return;
    }
    if (action === 'cancel' && this._screen !== 'title') {
      this.audio.uiBack();
      this.go(this._screen === 'modes' ? 'title' : 'modes');
    }
  }

  // --- lifecycle --------------------------------------------------------------------

  _wireLifecycle() {
    document.addEventListener('visibilitychange', () => {
      const hidden = document.hidden;
      this.renderer?.setHidden(hidden);
      this.audio.setSuspended(hidden);
      if (hidden && this.session && this.session.config?.mode !== 'hosted' && this._screen === 'game') {
        this.session.pause('background');
        if (!this._pauseModal) this.togglePause(true);
      }
      if (!hidden && this.session?.config?.mode === 'hosted') {
        this.session.resume(); // pulls a fresh snapshot → "while you were away"
      }
    });
    window.addEventListener('beforeunload', () => {
      this.platform.flushTelemetry();
    });
    // first gesture unlocks audio + ambience
    const unlock = () => {
      if (this.audio.ensure()) {
        const theme = this._currentThemeObj();
        this._audioThemeId = theme?.id;
        this.audio.startAmbience(theme);
        this.audio.startMusic(theme);
      }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // hover tick on interactive elements (pointer only, never required)
    document.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const hit = e.target.closest?.('button, select, input, a[href], [role="tab"]');
      if (hit && hit !== e.relatedTarget?.closest?.('button, select, input, a[href], [role="tab"]')) this.audio.hover();
    });
  }

  _currentThemeObj() {
    const id = this.session?.config?.theme || this.settings.theme;
    return THEMES[id];
  }

  _attractBoard() {
    // a quiet demo board behind the menus
    try {
      const demo = new Session({
        mode: 'attract', ruleset: 'duel', seed: 20260817,
        players: [{ name: 'A', kind: 'human' }, { name: 'B', kind: 'human' }],
      });
      this.renderer?.loadState(demo.state, { snap: true });
      demo.destroy();
    } catch { /* cosmetic only */ }
  }

  _showCompatNotice() {
    const note = document.getElementById('webgl-fallback');
    if (note) note.hidden = false;
    this.$domBoardWrap.classList.add('pinned');
  }

  _maybeAskConsent() {
    if (this.settings.telemetryConsent !== null) return;
    // Non-blocking banner, not a modal: the menu must stay usable while it is up.
    const dismiss = (consent) => {
      this.settings.telemetryConsent = consent;
      if (consent) this.platform.setTelemetryConsent(true);
      this.saveSettings();
      banner.remove();
    };
    const banner = el('div', { class: 'consent-banner', role: 'dialog' });
    this._consentRelabel = () => {
      if (!banner.isConnected) { this._consentRelabel = null; return; }
      banner.setAttribute('aria-label', T('Anonymous stats'));
      banner.replaceChildren(
        el('p', { class: 'consent-text', text: T('Help improve Crown Draughts with anonymous usage stats (round start/end, tutorial steps, errors). No text, pointers, or personal data — ever. Off by default.') }),
        el('div', { class: 'modal-actions' }, [
          button(T('No thanks'), () => dismiss(false)),
          button(T('Allow'), () => dismiss(true), { kind: 'primary' }),
        ]),
      );
    };
    this._consentRelabel();
    this.$overlay.appendChild(banner);
  }

  /** Compare local progress with the cloud mirror; `push` uploads a winning
   *  local doc even while start-up pushes are still held. */
  async _syncCloudSave(push = false) {
    const localDoc = loadProgressDoc();
    const cloudDoc = loadCloudSave();
    const cmp = compareSaves(localDoc, cloudDoc);
    if (cmp.status === 'cloud-ahead' && cmp.cloud) {
      archiveSave(localDoc);
      adoptProgressDoc(cmp.cloud);
      this.progress = loadProgress();
      if (this._screen === 'title') this.go('title');
    } else if (cmp.status === 'local-ahead' && localDoc) {
      writeCloudSave(localDoc.payload, localDoc.id, push);
    } else if (cmp.status === 'conflict') {
      archiveSave(cmp.local);
      archiveSave(cmp.cloud);
      const useCloud = await confirmDialog(this.$overlay, {
        title: T('Two saves found'),
        body: T('Your local progress ({local}) and the synced save ({cloud}) diverged. Keep the synced save? Both copies are preserved.', { local: cmp.local?.at?.slice(0, 10) || T('unknown'), cloud: cmp.cloud?.at?.slice(0, 10) || T('unknown') }),
        confirmLabel: T('Use synced save'),
      });
      if (useCloud && cmp.cloud) {
        adoptProgressDoc(cmp.cloud);
        this.progress = loadProgress();
        if (this._screen === 'title') this.go('title');
      } else if (localDoc) {
        writeCloudSave(localDoc.payload, localDoc.id, push);
      }
    }
  }

  /**
   * A cloud write lost to a save made on another device. Reload the slot,
   * merge it with this device's progress (better records, unions of unlocks,
   * larger counters; the in-progress round lives in the local snapshot and is
   * untouched), adopt the merge locally and push it as the new cloud save.
   */
  async _mergeCloudConflict() {
    if (this._merging) return;
    this._merging = true;
    try {
      const raw = await this.platform.loadCloudSave();
      if (this.platform.saveConflicted()) return; // the reload failed; writes stay blocked
      let remote = null;
      try { remote = raw ? JSON.parse(raw) : null; } catch { /* corrupt remote */ }
      const localDoc = loadProgressDoc();
      if (localDoc) archiveSave(localDoc);
      if (remote?.payload) { archiveSave(remote); adoptCloudSaveDoc(remote); }
      const merged = mergeProgress(remote?.payload, this.progress);
      this.progress = loadProgress();
      Object.assign(this.progress, merged);
      saveProgress(this.progress);
      const doc = loadProgressDoc();
      if (doc) writeCloudSave(doc.payload, doc.id, true);
      if (this._screen !== 'game' && this._screen !== 'results' && this._screen !== 'boot') this.go(this._screen, this._screenData, { refresh: true });
    } finally {
      this._merging = false;
    }
  }

  _afterProgressChange() {
    saveProgress(this.progress);
    saveProfile(this.profile);
    const doc = loadProgressDoc();
    if (doc) writeCloudSave(doc.payload, doc.id);
    // achievement fanfare
    // (evaluateAchievements already applied in applyRoundResult)
  }

  platformNow() {
    return this.platform.serverNow();
  }

  // --- HUD construction ---------------------------------------------------------

  /** Language change mid-round: rebuild the HUD text, keeping chat, the move
   *  log, open drawers, the lesson coach and the clocks. */
  _refreshGameHud() {
    const chat = document.getElementById('chat-log');
    const chatNodes = chat ? [...chat.childNodes] : [];
    const chatDraft = document.getElementById('chat-input')?.value || '';
    this._buildGameHud({ keepDrawers: true });
    document.getElementById('chat-log')?.append(...chatNodes);
    const input = document.getElementById('chat-input');
    if (input) input.value = chatDraft;
    const log = document.getElementById('move-log');
    if (log) for (const entry of this._log) log.appendChild(el('li', { text: entry.render ? entry.render() : entry.text }));
    if (this._coach) this._coach(false);
    if (this.session?.clock) this._updateClocks(this.session.clock, this.session.state?.turn);
    this.game?._updateHud();
  }

  _buildGameHud({ keepDrawers = false } = {}) {
    if (!keepDrawers) { this._log = []; this._coach = null; }
    const s = this.session;
    const hosted = s.config.mode === 'hosted';
    const lesson = this.lessonRun?.lesson;
    // top bar
    this.$topbar.replaceChildren(
      el('div', { class: 'topbar-left' }, [
        el('h2', { id: 'objective-title', text: objectiveTitle(s.config, lesson) }),
        el('p', { id: 'objective-sub', class: 'objective-sub', text: objectiveSub(s.config) }),
      ]),
      el('div', { class: 'topbar-right' }, [
        el('div', { id: 'turn-banner', class: 'turn-banner', role: 'status' }),
        el('div', { id: 'clock-row', class: 'clock-row' }),
        el('span', { id: 'thinking', class: 'thinking', hidden: true, text: '…' }),
        button(T('Pause'), () => this.togglePause(true), { kind: 'ghost', class: 'btn btn-ghost pause-btn' }),
      ]),
    );
    // left rail: lesson coach or objective/progress + move log
    this.$railLeft.replaceChildren(
      el('section', { class: 'rail-card', id: 'lesson-coach', hidden: !lesson }),
      el('section', { class: 'rail-card' }, [
        el('h3', { text: T('Progress') }),
        el('div', { id: 'objective-detail' }),
      ]),
      el('section', { class: 'rail-card move-log-card' }, [
        el('h3', { text: T('Moves') }),
        el('ol', { id: 'move-log', class: 'move-log' }),
      ]),
    );
    // right rail: actions + players (+ chat when hosted)
    const actionsCard = el('section', { class: 'rail-card' }, [
      el('h3', { text: T('Actions') }),
      el('div', { class: 'action-grid' }, [
        button(T('Undo'), () => this.game?.requestUndo(), { kind: 'ghost', id: 'btn-undo' }),
        button(T('Hint'), () => this.game?.requestHint(), { kind: 'ghost', id: 'btn-hint' }),
        button(T('Offer draw'), () => this._offerDraw(), { kind: 'ghost', id: 'btn-draw' }),
        button(T('Resign'), () => this._resign(), { kind: 'ghost', id: 'btn-resign' }),
        button(T('Camera'), () => this.cycleCamera(), { kind: 'ghost' }),
        button(T('HTML board'), () => this.toggleDomBoard(), { kind: 'ghost' }),
      ]),
    ]);
    const playersCard = el('section', { class: 'rail-card' }, [
      el('h3', { text: T('Houses') }),
      el('ul', { id: 'player-list', class: 'player-list' }),
    ]);
    const chatCard = el('section', { class: 'rail-card chat-card', id: 'chat-card', hidden: !hosted }, [
      el('h3', { text: T('Chat') }),
      el('div', { id: 'chat-log', class: 'chat-log', role: 'log', 'aria-live': 'polite' }),
      (() => {
        const input = el('input', { type: 'text', class: 'text-input', id: 'chat-input', maxlength: '240', placeholder: T('Message…'), 'aria-label': T('Chat message') });
        const send = button(T('Send'), async () => {
          const text = input.value.trim();
          if (!text) return;
          const res = await this.hostedClient?.sendChat(text);
          if (res && !res.ok) this.ui.toast(res.error === 'rate-limited' ? T('Slow down — 10 messages per minute.') : T('Message not sent'), 'warn');
          else input.value = '';
        }, { kind: 'primary' });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send.click(); e.stopPropagation(); });
        return el('div', { class: 'chat-compose' }, [input, send]);
      })(),
    ]);
    this.$railRight.replaceChildren(...[actionsCard, playersCard, hosted ? chatCard : null].filter(Boolean));
    // bottom tray mirrors key actions on small screens
    const drawerBtn = (label, cls) => button(label, () => {
      const other = cls === 'rail-left-open' ? 'rail-right-open' : 'rail-left-open';
      document.body.classList.remove(other);
      document.body.classList.toggle(cls);
      this._syncDrawerButtons();
    }, { kind: 'ghost', class: 'btn btn-ghost drawer-btn', 'aria-expanded': 'false', 'data-drawer': cls });
    this.$tray.replaceChildren(
      drawerBtn(T('Info'), 'rail-left-open'),
      button(T('Undo'), () => this.game?.requestUndo(), { kind: 'ghost' }),
      button(T('Hint'), () => this.game?.requestHint(), { kind: 'ghost' }),
      button(T('Draw'), () => this._offerDraw(), { kind: 'ghost' }),
      button(T('Pause'), () => this.togglePause(true), { kind: 'ghost' }),
      drawerBtn(T('Actions'), 'rail-right-open'),
    );
    if (!keepDrawers) document.body.classList.remove('rail-left-open', 'rail-right-open');
    this._syncDrawerButtons();
    this._placeCoach();
    this.ui.updateHud({ state: s.state, session: s, config: s.config });
  }

  _syncDrawerButtons() {
    for (const b of this.$tray.querySelectorAll('[data-drawer]')) {
      b.setAttribute('aria-expanded', String(document.body.classList.contains(b.dataset.drawer)));
    }
  }

  /**
   * On compact layouts the lesson coach (and its Continue button) lives in a
   * persistent dock over the board rather than inside the collapsed rail.
   */
  _placeCoach() {
    const coach = document.getElementById('lesson-coach');
    const dock = document.getElementById('coach-dock');
    if (!coach || !dock) return;
    const compact = matchMedia('(max-width: 1023px), (max-height: 560px) and (orientation: landscape)').matches;
    const target = compact ? dock : this.$railLeft;
    if (coach.parentElement !== target) {
      if (compact) target.appendChild(coach); else target.prepend(coach);
    }
    dock.hidden = !compact || coach.hidden;
  }

  async _offerDraw() {
    if (!this.session || this.session.phase !== 'active') return;
    const ok = await confirmDialog(this.$overlay, { title: T('Offer a draw?'), confirmLabel: T('Offer') });
    if (!ok) return;
    const seat = this.hostedClient ? this.hostedClient.seat : this.session.state.turn;
    this.session.submit({ type: 'offerDraw', player: seat }, seat);
  }

  async _resign() {
    if (!this.session || this.session.phase !== 'active') return;
    const ok = await confirmDialog(this.$overlay, { title: T('Resign this round?'), confirmLabel: T('Resign'), danger: true });
    if (!ok) return;
    const seat = this.hostedClient ? this.hostedClient.seat : this.session.state.turn;
    this.session.submit({ type: 'resign', player: seat }, seat);
  }

  // --- ui facade (used by GameController) -----------------------------------------

  get ui() {
    if (this._uiFacade) return this._uiFacade;
    const app = this;
    this._uiFacade = {
      toast: (msg, kind = 'info', ms = 2600) => app.toast(msg, kind, ms),
      announce: (msg, assertive = false) => app.announce(msg, assertive),
      addLogEntry: (text) => app._addLogEntry(text),
      updateHud: (ctx) => app._updateHud(ctx),
      updateClocks: (clock, turn) => app._updateClocks(clock, turn),
      setThinking: (v) => { const t = document.getElementById('thinking'); if (t) t.hidden = !v; },
      addChatMessage: (m) => app._addChatMessage(m),
      lessonStepComplete: (step) => app._lessonStepComplete(step),
      showLessonStep: (lesson, step, idx) => app._showLessonStep(lesson, step, idx),
    };
    return this._uiFacade;
  }

  toast(msg, kind = 'info', ms = 2600) {
    const t = el('div', { class: `toast toast-${kind}`, role: 'status', text: msg });
    this.$toast.appendChild(t);
    if (kind !== 'warn') this.audio.toast();
    setTimeout(() => t.classList.add('gone'), ms);
    setTimeout(() => t.remove(), ms + 400);
  }

  announce(msg, assertive = false) {
    const region = assertive ? this.$alert : this.$live;
    region.textContent = '';
    requestAnimationFrame(() => { region.textContent = msg; });
    if (this.settings.audio.voiceCues) this.audio.speak(msg);
  }

  /** entry: a string, or { text, render } where render() re-describes it in the current language. */
  _addLogEntry(entry) {
    const e = typeof entry === 'string' ? { text: entry } : entry;
    this._log.push(e);
    if (this._log.length > 60) this._log.shift();
    const log = document.getElementById('move-log');
    if (!log) return;
    const li = el('li', { text: e.text });
    log.appendChild(li);
    while (log.children.length > 60) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  _addChatMessage(m) {
    const log = document.getElementById('chat-log');
    if (!log) return;
    log.appendChild(el('p', { class: 'chat-msg' }, [el('strong', { text: `${m.name}: ` }), m.text]));
    log.scrollTop = log.scrollHeight;
  }

  _updateHud({ state, session, config }) {
    if (!state) return;
    const turnEl = document.getElementById('turn-banner');
    if (turnEl && state.phase === 'active') {
      const pl = state.players[state.turn];
      const mine = this.hostedClient ? state.turn === this.hostedClient.seat : pl.kind === 'human';
      turnEl.textContent = T(mine ? '{name} to move — you' : '{name} to move', { name: T(pl.name) });
      turnEl.dataset.color = pl.color;
    }
    // players list with material
    const list = document.getElementById('player-list');
    if (list) {
      const stats = playerStats(state);
      list.replaceChildren(...state.players.map((pl, i) => {
        const st = stats[i];
        return el('li', { class: i === state.turn ? 'active' : '', dataset: { color: pl.color } }, [
          el('span', { class: 'player-chip', text: T(pl.name) }),
          el('span', { class: 'player-mat', text: `${st.piecesLeft}⬤ ${st.crownedLeft}♛` }),
        ]);
      }));
    }
    // objective detail
    const detail = document.getElementById('objective-detail');
    if (detail) {
      const bits = [];
      if (config?.par) bits.push(T('Par: {par} plies (now {ply})', { par: config.par, ply: state.ply }));
      if (config?.goal?.maxPlies) bits.push(T('Must win by ply {n} (now {ply})', { n: config.goal.maxPlies, ply: state.ply }));
      if (config?.goal?.maxLost != null) bits.push(T('Lose at most {n} pieces', { n: config.goal.maxLost }));
      bits.push(T('Draw clock: {n}/{max}', { n: state.sinceProgress, max: RULESETS[state.ruleset].drawPlies }));
      detail.replaceChildren(...bits.map((b) => el('p', { class: 'objective-fact', text: b })));
    }
    // lesson coach highlight of allowed pieces
    if (this.lessonRun) {
      const step = this.lessonRun.lesson.steps[this.lessonRun.stepIndex];
      // focus ring via DOM board only (renderer selection handled by controller)
    }
  }

  _updateClocks(clock, turn) {
    const row = document.getElementById('clock-row');
    if (!row) return;
    if (!clock) { row.replaceChildren(); return; }
    // one warning knock when the active clock first drops under ten seconds
    const active = clock[turn];
    const low = Number.isFinite(active) && active > 0 && active <= 10000;
    if (low && !this._clockWarned) { this._clockWarned = true; this.audio.clockWarn(); }
    else if (!low) this._clockWarned = false;
    row.replaceChildren(...clock.map((ms, i) => {
      const total = Math.max(0, Math.round(ms / 1000));
      const txt = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
      return el('span', { class: `clock${i === turn ? ' active' : ''}${total <= 10 ? ' low' : ''}`, text: `${T(this.session.state.players[i]?.name) || i}: ${txt}` });
    }));
  }

  _showLessonStep(lesson, step, idx) {
    this._coach = (fresh = true) => {
      const coach = document.getElementById('lesson-coach');
      if (!coach) return;
      coach.hidden = false;
      coach.replaceChildren(
        el('h3', { text: T('{title} — step {n}/{total}', { title: T(lesson.title), n: idx + 1, total: lesson.steps.length }) }),
        el('p', { class: 'lesson-text', text: T(step.text) }),
        step.kind === 'read'
          ? button(T('Continue'), () => this.lessonAdvance(), { kind: 'primary' })
          : el('p', { class: 'lesson-goal', text: T('Your turn — play the move.') }),
      );
      this._placeCoach();
      if (fresh) this.announce(T(step.text));
    };
    this._coach();
  }

  _lessonStepComplete(step) {
    this.audio.achievement();
    this._coach = (fresh = true) => {
      const coach = document.getElementById('lesson-coach');
      this._placeCoach();
      if (coach) {
        coach.hidden = false;
        coach.replaceChildren(
          el('h3', { text: T('Well played') }),
          el('p', { class: 'lesson-text', text: step.success ? T(step.success) : T('Step complete.') }),
          button(T('Continue'), () => this.lessonAdvance(), { kind: 'primary' }),
        );
        if (fresh) coach.querySelector('button')?.focus();
      }
      if (fresh) this.announce(step.success ? T(step.success) : T('Step complete.'), true);
    };
    this._coach();
    this.platform.track('tutorial_step', { mode: 'lesson', reason: 'step' });
  }
}

function objectiveTitle(config, lesson) {
  if (lesson) return T('Lesson: {title}', { title: T(lesson.title) });
  switch (config?.mode) {
    case 'practice': return T('Practice');
    case 'journey': return T('Journey · {stage}', { stage: config.contentId });
    case 'daily': return T('Daily Court');
    case 'challenge': return T('Challenge');
    case 'hosted': return T('Hosted round');
    case 'local': return T('Pass & Play');
    default: return T('Crown Draughts');
  }
}

function objectiveSub(config) {
  const bits = [];
  if (config?.ruleset) bits.push(T(RULESETS[config.ruleset]?.name || config.ruleset));
  if (config?.ranked) bits.push(T('ranked'));
  if (config?.goal?.maxPlies) bits.push(T('win in {n}', { n: config.goal.maxPlies }));
  return bits.join(' · ');
}

function modeLabel(config) {
  return objectiveTitle(config) + (config?.ruleset ? ` — ${T(RULESETS[config.ruleset]?.name)}` : '');
}
