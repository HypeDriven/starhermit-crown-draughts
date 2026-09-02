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
  saveSessionSnapshot, loadSessionSnapshot, clearSessionSnapshot,
} from '../core/storage.js';
import { applyRoundResult } from '../core/progress.js';
import { dailyDefinition } from '../content/daily.js';
import { contentSetup, JOURNEY_STAGES } from '../content/index.js';
import { THEMES } from '../content/themes.js';
import { lessonById, LESSONS } from '../content/lessons.js';
import { AI_LEVELS } from '../rules/ai.js';
import { playerStats, RULESETS } from '../rules/engine.js';
import { DomBoard } from './boarddom.js';
import { InputManager } from './input.js';
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
  }

  async boot() {
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
    this._wireLifecycle();
    this._applyTextSize();
    // idle attract board behind the title
    this._attractBoard();
    this.go('title');
    this._checkResumeOffer();
    this._maybeAskConsent();
    this._syncCloudSave();
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

  go(screen, data) {
    const prev = this._screen;
    this._screen = screen;
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
      // focus the screen heading for screen readers & keyboard flow
      requestAnimationFrame(() => {
        const h = active.querySelector('h1, h2, [autofocus]');
        if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
      });
      this.announce(`${active.querySelector('h1, h2')?.textContent || screen} screen`);
    }
    if (inGame) {
      requestAnimationFrame(() => this.domBoard.focusCursor());
    }
  }

  _showScreenless(name) { /* helper for dynamic-only screens */ }

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
    const steps = clocked ? ['3', '2', '1', 'Go!'] : ['Ready?'];
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
      this.startLocal({ ruleset: 'melee', names: ['Ivory', 'Jade', 'Onyx', 'Ember'], count: 4, challengeId: c.id });
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
    this.ui.toast(`Lesson complete: ${lesson.title}`, 'ok', 4000);
    this.platform.track('tutorial_step', { mode: 'lesson', reason: 'complete' });
    this.exitToTitle('learn');
  }

  // --- hosted ----------------------------------------------------------------

  async hostTable(state) {
    const res = await HostedSessionClient.create(this.platform, {
      ruleset: state.ruleset, name: this.profile.name, listed: state.listed,
      clockMs: null,
    });
    if (!res.ok) return this.ui.toast(res.error || 'Could not create table', 'warn');
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

  async joinByCode(code) {
    if (!code || code.length < 4) return this.ui.toast('Enter the 6-letter join code.', 'warn');
    const res = await HostedSessionClient.join(this.platform, { sessionIdOrCode: code, name: this.profile.name, joinCode: code });
    if (!res.ok) return this.ui.toast(res.error || 'Could not join', 'warn');
    this.hostedClient = res.client;
    this.hostedClient.connect();
    this._wireHostedOver();
    await this.hostedClient.refresh();
    this.go('table-room', this.hostedClient);
    this.hostedClient.on('state', () => {
      if (this.hostedClient.phase === 'active' && this._screen !== 'game') this._enterHostedGame();
    });
  }

  async refreshOpenTables(listWrap) {
    const res = await this.platform.listPublicSessions();
    if (!res.ok) {
      listWrap.replaceChildren(el('p', { text: 'Could not load open tables.', class: 'setup-note warn' }));
      return;
    }
    const rows = res.data.sessions || [];
    if (!rows.length) {
      listWrap.replaceChildren(el('p', { text: 'No open tables right now — host one!', class: 'setup-note' }));
      return;
    }
    listWrap.replaceChildren(...rows.map((s) => el('div', { class: 'open-table' }, [
      el('span', { text: `${RULESETS[s.ruleset].name} · ${s.seats}/${s.capacity} · host rating ${s.hostRating}` }),
      button('Join', async () => {
        const res2 = await HostedSessionClient.join(this.platform, { sessionIdOrCode: s.id, name: this.profile.name, joinCode: null });
        if (!res2.ok) return this.ui.toast(res2.error || 'Could not join', 'warn');
        this.hostedClient = res2.client;
        this.hostedClient.connect();
        this._wireHostedOver();
        await this.hostedClient.refresh();
        this.go('table-room', this.hostedClient);
        this.hostedClient.on('state', () => {
          if (this.hostedClient.phase === 'active' && this._screen !== 'game') this._enterHostedGame();
        });
      }),
    ])));
  }

  _wireHostedOver() {
    this.hostedClient.on('over', (over) => this._onGameOver(over));
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
    this.ui.toast('Round started. Good luck!', 'ok');
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
        outcome.nextAction = { label: `Next: ${nextStage.name}`, fn: () => this.startJourneyStage(nextStage) };
      }
    } else if (config.mode === 'daily') {
      outcome.nextAction = { label: 'Back to the garden', fn: () => this.exitToTitle() };
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
    screens.buildResults(this, active, { over, config, outcome });
    this.go('results');
    if (outcome.stars > 0) this.audio.starAward();
    if (outcome.recordBroken) this.audio.newRecord();
    if (outcome.unlocked?.length) this.audio.achievement();
    if (config.mode === 'daily' && outcome.iWon && this.progress.stats.dailyStreak >= 3) this.audio.streak();
    this.announce(`${over.winner === null ? 'Draw' : outcome.iWon ? 'Victory' : 'Round over'}. ${over.reasonText}`, true);
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
    const label = `${modeLabel(snap.config)} · ply ${snap.plyAtSave}`;
    return { snap, label };
  }

  resumeSnapshot() {
    const pending = this.pendingSnapshot();
    if (!pending) return;
    const { session, away } = Session.restore(pending.snap);
    this.session = session;
    this.lastConfig = session.config;
    this._enterGame(session.config.mode === 'lesson' ? this.lessonRun?.lesson : null);
    this.ui.toast(`Welcome back — the court is at ply ${away.resumedAtPly}.`, 'info', 4000);
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
        title: 'Paused',
        onClose: () => {
          this._pauseModal = null;
          this.session?.resume();
          this.renderer.setPaused(false);
          this.audio.resume();
        },
      });
      const box = this._pauseModal.box;
      box.appendChild(el('h2', { text: 'Paused' }));
      if (hosted) box.appendChild(el('p', { class: 'setup-note', text: 'Hosted round: the clock keeps running while you are away.' }));
      box.appendChild(el('div', { class: 'pause-actions' }, [
        button('Resume', () => this._pauseModal?.close(), { kind: 'primary', autofocus: true }),
        button('Settings', () => this.openSettings(), {}),
        button('Help', () => this.openHelp(), {}),
        button('How to play', () => this.openHelp(), { kind: 'ghost' }),
        button('Leave round', async () => {
          const ok = await confirmDialog(this.$overlay, { title: 'Leave this round?', body: 'The round will be saved locally unless it is finished.', confirmLabel: 'Leave' });
          if (ok) { this._pauseModal?.close(); this.exitToTitle(); }
        }, { kind: 'danger' }),
      ]));
      box.querySelector('.btn-primary')?.focus();
    } else if (!wantOpen && this._pauseModal) {
      this._pauseModal.close();
    }
  }

  openSettings() {
    const modal = new Modal(this.$overlay, { title: 'Settings', wide: true });
    screens.buildSettings(this, modal);
  }

  openProfile() {
    const modal = new Modal(this.$overlay, { title: 'Profile', wide: true });
    screens.buildProfile(this, modal);
  }

  openHelp() {
    const modal = new Modal(this.$overlay, { title: 'Help', wide: true });
    screens.buildHelp(this, modal);
  }

  _closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
    this._pauseModal = null;
  }

  // --- settings application -------------------------------------------------------

  saveSettings() { saveSettings(this.settings); }
  saveProfile() { saveProfile(this.profile); }

  applyAudioSettings() {
    this.audio.applySettings(this.settings.audio);
    this.saveSettings();
    this.platform.track('settings_change', { category: 'audio' });
  }

  applyGraphicsSettings() {
    const tier = this.settings.graphics.tier;
    if (tier === 'auto') {
      const coarse = matchMedia('(pointer: coarse)').matches;
      const small = Math.min(screen.width, screen.height) < 760;
      this.renderer?.setQuality(coarse || small ? 'medium' : 'high');
      if (coarse && small) this.renderer?.setQuality('medium');
    } else {
      this.renderer?.setQuality(tier);
    }
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
    this.renderer?.setReducedMotion(a.reducedMotion);
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
  }

  cycleCamera() {
    const order = ['classic', 'low', 'top'];
    const cur = order.indexOf(this.settings.camera.preset);
    const next = order[(cur + 1) % order.length];
    this.settings.camera.preset = next;
    this.saveSettings();
    this.renderer.setCameraPreset(next);
    this.ui.toast(`Camera: ${next}`);
  }

  // --- input routing ---------------------------------------------------------------

  _onInputAction(action, meta) {
    this.audio.ensure();
    if (action === 'mute') {
      this.settings.audio.muted = !this.settings.audio.muted;
      this.applyAudioSettings();
      this.ui.toast(this.settings.audio.muted ? 'Muted' : 'Sound on');
      return;
    }
    if (action === 'help') { this.openHelp(); return; }
    if (action === 'board') {
      this.$domBoardWrap.classList.toggle('pinned');
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
    const banner = el('div', { class: 'consent-banner', role: 'dialog', 'aria-label': 'Anonymous stats' }, [
      el('p', { class: 'consent-text', text: 'Help improve Crown Draughts with anonymous usage stats (round start/end, tutorial steps, errors). No text, pointers, or personal data — ever. Off by default.' }),
      el('div', { class: 'modal-actions' }, [
        button('No thanks', () => dismiss(false)),
        button('Allow', () => dismiss(true), { kind: 'primary' }),
      ]),
    ]);
    this.$overlay.appendChild(banner);
  }

  async _syncCloudSave() {
    const localDoc = loadProgressDoc();
    const cloudDoc = loadCloudSave();
    const cmp = compareSaves(localDoc, cloudDoc);
    if (cmp.status === 'cloud-ahead' && cmp.cloud) {
      archiveSave(localDoc);
      adoptProgressDoc(cmp.cloud);
      this.progress = loadProgress();
    } else if (cmp.status === 'local-ahead' && localDoc) {
      writeCloudSave(localDoc.payload, localDoc.id);
    } else if (cmp.status === 'conflict') {
      archiveSave(cmp.local);
      archiveSave(cmp.cloud);
      const useCloud = await confirmDialog(this.$overlay, {
        title: 'Two saves found',
        body: `Your local progress (${cmp.local?.at?.slice(0, 10) || 'unknown'}) and the synced save (${cmp.cloud?.at?.slice(0, 10) || 'unknown'}) diverged. Keep the synced save? Both copies are preserved.`,
        confirmLabel: 'Use synced save',
      });
      if (useCloud && cmp.cloud) {
        adoptProgressDoc(cmp.cloud);
        this.progress = loadProgress();
      } else if (localDoc) {
        writeCloudSave(localDoc.payload, localDoc.id);
      }
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

  _buildGameHud() {
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
        button('Pause', () => this.togglePause(true), { kind: 'ghost', class: 'btn btn-ghost pause-btn' }),
      ]),
    );
    // left rail: lesson coach or objective/progress + move log
    this.$railLeft.replaceChildren(
      el('section', { class: 'rail-card', id: 'lesson-coach', hidden: !lesson }),
      el('section', { class: 'rail-card' }, [
        el('h3', { text: 'Progress' }),
        el('div', { id: 'objective-detail' }),
      ]),
      el('section', { class: 'rail-card move-log-card' }, [
        el('h3', { text: 'Moves' }),
        el('ol', { id: 'move-log', class: 'move-log' }),
      ]),
    );
    // right rail: actions + players (+ chat when hosted)
    const actionsCard = el('section', { class: 'rail-card' }, [
      el('h3', { text: 'Actions' }),
      el('div', { class: 'action-grid' }, [
        button('Undo', () => this.game?.requestUndo(), { kind: 'ghost', id: 'btn-undo' }),
        button('Hint', () => this.game?.requestHint(), { kind: 'ghost', id: 'btn-hint' }),
        button('Offer draw', () => this._offerDraw(), { kind: 'ghost', id: 'btn-draw' }),
        button('Resign', () => this._resign(), { kind: 'ghost', id: 'btn-resign' }),
        button('Camera', () => this.cycleCamera(), { kind: 'ghost' }),
        button('HTML board', () => this.$domBoardWrap.classList.toggle('pinned'), { kind: 'ghost' }),
      ]),
    ]);
    const playersCard = el('section', { class: 'rail-card' }, [
      el('h3', { text: 'Houses' }),
      el('ul', { id: 'player-list', class: 'player-list' }),
    ]);
    const chatCard = el('section', { class: 'rail-card chat-card', id: 'chat-card', hidden: !hosted }, [
      el('h3', { text: 'Chat' }),
      el('div', { id: 'chat-log', class: 'chat-log', role: 'log', 'aria-live': 'polite' }),
      (() => {
        const input = el('input', { type: 'text', class: 'text-input', id: 'chat-input', maxlength: '240', placeholder: 'Message…', 'aria-label': 'Chat message' });
        const send = button('Send', async () => {
          const text = input.value.trim();
          if (!text) return;
          const res = await this.hostedClient?.sendChat(text);
          if (res && !res.ok) this.ui.toast(res.error === 'rate-limited' ? 'Slow down — 10 messages per minute.' : 'Message not sent', 'warn');
          else input.value = '';
        }, { kind: 'primary' });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send.click(); e.stopPropagation(); });
        return el('div', { class: 'chat-compose' }, [input, send]);
      })(),
    ]);
    this.$railRight.replaceChildren(...[actionsCard, playersCard, hosted ? chatCard : null].filter(Boolean));
    // bottom tray mirrors key actions on small screens
    this.$tray.replaceChildren(
      button('Undo', () => this.game?.requestUndo(), { kind: 'ghost' }),
      button('Hint', () => this.game?.requestHint(), { kind: 'ghost' }),
      button('Draw', () => this._offerDraw(), { kind: 'ghost' }),
      button('Pause', () => this.togglePause(true), { kind: 'ghost' }),
    );
    this.ui.updateHud({ state: s.state, session: s, config: s.config });
  }

  async _offerDraw() {
    if (!this.session || this.session.phase !== 'active') return;
    const ok = await confirmDialog(this.$overlay, { title: 'Offer a draw?', confirmLabel: 'Offer' });
    if (!ok) return;
    const seat = this.hostedClient ? this.hostedClient.seat : this.session.state.turn;
    this.session.submit({ type: 'offerDraw', player: seat }, seat);
  }

  async _resign() {
    if (!this.session || this.session.phase !== 'active') return;
    const ok = await confirmDialog(this.$overlay, { title: 'Resign this round?', confirmLabel: 'Resign', danger: true });
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

  _addLogEntry(text) {
    const log = document.getElementById('move-log');
    if (!log) return;
    const li = el('li', { text });
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
      turnEl.textContent = `${pl.name} to move${mine ? ' — you' : ''}`;
      turnEl.dataset.color = pl.color;
    }
    // players list with material
    const list = document.getElementById('player-list');
    if (list) {
      const stats = playerStats(state);
      list.replaceChildren(...state.players.map((pl, i) => {
        const st = stats[i];
        return el('li', { class: i === state.turn ? 'active' : '', dataset: { color: pl.color } }, [
          el('span', { class: 'player-chip', text: pl.name }),
          el('span', { class: 'player-mat', text: `${st.piecesLeft}⬤ ${st.crownedLeft}♛` }),
        ]);
      }));
    }
    // objective detail
    const detail = document.getElementById('objective-detail');
    if (detail) {
      const bits = [];
      if (config?.par) bits.push(`Par: ${config.par} plies (now ${state.ply})`);
      if (config?.goal?.maxPlies) bits.push(`Must win by ply ${config.goal.maxPlies} (now ${state.ply})`);
      if (config?.goal?.maxLost != null) bits.push(`Lose at most ${config.goal.maxLost} pieces`);
      bits.push(`Draw clock: ${state.sinceProgress}/${RULESETS[state.ruleset].drawPlies}`);
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
    row.replaceChildren(...clock.map((ms, i) => {
      const total = Math.max(0, Math.round(ms / 1000));
      const txt = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
      return el('span', { class: `clock${i === turn ? ' active' : ''}${total <= 10 ? ' low' : ''}`, text: `${this.session.state.players[i]?.name || i}: ${txt}` });
    }));
  }

  _showLessonStep(lesson, step, idx) {
    const coach = document.getElementById('lesson-coach');
    if (!coach) return;
    coach.hidden = false;
    coach.replaceChildren(
      el('h3', { text: `${lesson.title} — step ${idx + 1}/${lesson.steps.length}` }),
      el('p', { class: 'lesson-text', text: step.text }),
      step.kind === 'read'
        ? button('Continue', () => this.lessonAdvance(), { kind: 'primary' })
        : el('p', { class: 'lesson-goal', text: 'Your turn — play the move.' }),
    );
    this.announce(step.text);
  }

  _lessonStepComplete(step) {
    this.audio.achievement();
    const coach = document.getElementById('lesson-coach');
    if (coach) {
      coach.replaceChildren(
        el('h3', { text: 'Well played' }),
        el('p', { class: 'lesson-text', text: step.success || 'Step complete.' }),
        button('Continue', () => this.lessonAdvance(), { kind: 'primary' }),
      );
      coach.querySelector('button')?.focus();
    }
    this.announce(step.success || 'Step complete', true);
    this.platform.track('tutorial_step', { mode: 'lesson', reason: 'step' });
  }
}

function objectiveTitle(config, lesson) {
  if (lesson) return `Lesson: ${lesson.title}`;
  switch (config?.mode) {
    case 'practice': return 'Practice';
    case 'journey': return `Journey · ${config.contentId}`;
    case 'daily': return 'Daily Court';
    case 'challenge': return 'Challenge';
    case 'hosted': return 'Hosted round';
    case 'local': return 'Pass & Play';
    default: return 'Crown Draughts';
  }
}

function objectiveSub(config) {
  const bits = [];
  if (config?.ruleset) bits.push(RULESETS[config.ruleset]?.name || config.ruleset);
  if (config?.ranked) bits.push('ranked');
  if (config?.goal?.maxPlies) bits.push(`win in ${config.goal.maxPlies}`);
  return bits.join(' · ');
}

function modeLabel(config) {
  return objectiveTitle(config) + (config?.ruleset ? ` — ${RULESETS[config.ruleset]?.name}` : '');
}
