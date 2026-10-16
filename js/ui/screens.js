// Menu screens: title, mode select, setups, journey map, learn list,
// challenges, lobby, profile, results, help, settings. All semantic HTML;
// the canvas stays live behind menus.

import { el, button, Modal, confirmDialog } from './widgets.js';
import { audio } from '../core/audio.js';
import { RULESETS } from '../rules/engine.js';
import { AI_LEVELS } from '../rules/ai.js';
import { JOURNEY_STAGES, JOURNEY_CHAPTERS, stageUnlocked, journeyStats } from '../content/index.js';
import { LESSONS } from '../content/lessons.js';
import { CHALLENGES, constraintSummary } from '../content/challenges.js';
import { THEMES, COSMETICS, MASTERY_TRACK, nextMilestone } from '../content/themes.js';
import { ACHIEVEMENTS } from '../content/achievements.js';
import { dailyDefinition, msUntilNextDaily } from '../content/daily.js';
import { ACTIONS, DEFAULT_KEYBOARD, DEFAULT_GAMEPAD } from './input.js';
import { CATEGORIES, PRESETS, presetTier, choosePreset, describe } from '../render/gfx.js';
import { gfxStrings, fmt } from './gfx-i18n.js';
import { platformStrings, pfmt } from './platform-i18n.js';
import { T, N } from '../i18n/index.js';

// --- title -------------------------------------------------------------------

export function buildTitle(app, root) {
  const resume = app.pendingSnapshot();
  root.replaceChildren(...[
    el('div', { class: 'title-block' }, [
      el('img', {
        class: 'title-emblem', src: 'assets/title-emblem.webp', alt: '', width: '112', height: '112',
        decoding: 'async', onerror: (e) => e.target.remove(),
      }),
      el('h1', { class: 'game-title', text: T('Crown Draughts') }),
      el('p', { class: 'tagline', text: T('A carved stone board in a royal garden.') }),
    ]),
    el('nav', { class: 'title-actions', 'aria-label': T('Main menu') }, [
      resume ? button(T('Resume round — {label}', { label: resume.label }), () => app.resumeSnapshot(), { kind: 'primary', class: 'btn btn-primary btn-xl' }) : null,
      button(T('Play'), () => app.go('modes'), { kind: 'primary', class: 'btn btn-primary btn-xl' }),
      button(T('Daily Court — {date}', { date: todayShort() }), () => app.startDaily()),
      button(T('Journey'), () => app.go('journey')),
      button(T('Learn the rules'), () => app.go('learn')),
    ].filter(Boolean)),
    el('div', { class: 'title-footer' }, [
      button(T('Profile'), () => app.openProfile(), { kind: 'ghost' }),
      button(T('Settings'), () => app.openSettings(), { kind: 'ghost' }),
      button(T('Help'), () => app.openHelp(), { kind: 'ghost' }),
    ]),
    platformRow(app),
  ].filter(Boolean));
}

/** StarHermit row: sign-in (on *.starhermit.com without a token) or the
 *  signed-in player name + Invite a friend. Empty when running locally. */
function platformRow(app) {
  const PT = platformStrings();
  const p = app.platform;
  if (p.canSignIn()) {
    return el('div', { class: 'title-footer platform-row' }, [button(PT.signIn, () => p.signIn(), { kind: 'ghost', class: 'btn btn-ghost btn-signin' })]);
  }
  if (!p.hosted) return null;
  return el('div', { class: 'title-footer platform-row' }, [
    el('p', { class: 'setup-note platform-name', text: pfmt(PT.playingAs, { name: app.profile.name }) }),
    p.inviteLink() ? button(PT.invite, () => app.copyInviteLink(), { kind: 'ghost', class: 'btn btn-ghost btn-invite' }) : null,
  ].filter(Boolean));
}

function todayShort() {
  return new Date().toISOString().slice(5, 10);
}

// --- mode select ----------------------------------------------------------------

const MODES = [
  { id: 'learn', name: N('Learn'), desc: N('Interactive lessons — one rule at a time, hands on the stones.'), time: N('2–5 min each'), players: N('Solo'), ranked: false },
  { id: 'journey', name: N('Journey'), desc: N('48 authored stages across six garden courts.'), time: N('3–10 min each'), players: N('Solo vs AI'), ranked: false },
  { id: 'daily', name: N('Daily Court'), desc: N('One shared seed and ruleset per UTC day. Ranked.'), time: N('~10 min'), players: N('Solo vs AI'), ranked: true },
  { id: 'practice', name: N('Practice'), desc: N('Pick a ruleset and difficulty. Undo and hints allowed; never ranked.'), time: N('5–15 min'), players: N('Solo vs AI'), ranked: false },
  { id: 'challenge', name: N('Challenge'), desc: N('Move limits, speed trials, altered layouts, restricted tools.'), time: N('2–15 min'), players: N('Solo / local'), ranked: false },
  { id: 'hosted', name: N('Hosted Play'), desc: N('Private invite codes and public matches against other players.'), time: N('10–20 min'), players: N('2–4 online'), ranked: true },
  { id: 'local', name: N('Pass & Play'), desc: N('Two to four commanders, one device, including Royal Melee.'), time: N('10–25 min'), players: N('2–4 local'), ranked: false },
];

export function buildModes(app, root) {
  const grid = el('div', { class: 'mode-grid' });
  for (const m of MODES) {
    const card = el('button', {
      type: 'button', class: 'mode-card',
      onclick: () => app.openMode(m.id),
    }, [
      el('h3', { text: T(m.name) }),
      el('p', { text: T(m.desc) }),
      el('p', { class: 'mode-meta', text: `${T(m.players)} · ${T(m.time)} · ${m.ranked ? T('ranked') : T('unranked')}` }),
    ]);
    grid.appendChild(card);
  }
  root.replaceChildren(
    el('h2', { text: T('Choose your court') }),
    grid,
    button(T('Back'), () => app.go('title'), { kind: 'ghost' }),
  );
}

// --- mode setups ------------------------------------------------------------------

export function buildPracticeSetup(app, root) {
  // Kept on the app so a language change re-renders without resetting choices.
  const state = app.formState('practice', () => ({ ruleset: 'duel', level: 'apprentice', side: 0, theme: app.settings.theme }));
  const form = el('div', { class: 'setup-form' });
  form.appendChild(el('h2', { text: T('Practice') }));
  form.appendChild(radioGroup(T('Ruleset'), Object.values(RULESETS).filter((r) => r.playerCount === 2).map((r) => ({
    value: r.id, label: T(r.name), desc: T(r.description),
  })), state.ruleset, (v) => { state.ruleset = v; }));
  form.appendChild(radioGroup(T('Opponent'), Object.values(AI_LEVELS).map((l) => ({
    value: l.id, label: `${T(l.name)} (${l.rating})`, desc: T(l.blurb),
  })), state.level, (v) => { state.level = v; }));
  form.appendChild(radioGroup(T('Your house'), [
    { value: 0, label: T('Ivory (moves first)'), desc: '' },
    { value: 1, label: T('Onyx'), desc: '' },
  ], state.side, (v) => { state.side = v; }));
  form.appendChild(el('p', { class: 'setup-note', text: T('Undo and hints are allowed. Practice never touches your rating.') }));
  form.appendChild(el('div', { class: 'setup-actions' }, [
    button(T('Back'), () => app.go('modes'), { kind: 'ghost' }),
    button(T('Take your seat'), () => app.startPractice(state), { kind: 'primary' }),
  ]));
  root.replaceChildren(form);
}

export function buildLocalSetup(app, root) {
  const state = app.formState('local', () => ({ ruleset: 'duel', names: [T('Ivory'), T('Onyx'), T('Jade'), T('Ember')], count: 2 }));
  const form = el('div', { class: 'setup-form' });
  form.appendChild(el('h2', { text: T('Pass & Play') }));
  const nameWrap = el('div', { class: 'name-fields' });
  const renderNames = () => {
    nameWrap.replaceChildren();
    const cap = RULESETS[state.ruleset].playerCount;
    const n = state.ruleset === 'melee' ? state.count : 2;
    for (let i = 0; i < n; i++) {
      const input = el('input', {
        type: 'text', value: state.names[i], maxlength: '18', class: 'text-input',
        'aria-label': T('Player {n} name', { n: i + 1 }),
      });
      input.addEventListener('input', () => { state.names[i] = input.value; });
      nameWrap.appendChild(el('label', { class: 'field' }, [el('span', { text: T('House {n} ({house})', { n: i + 1, house: T(['Ivory', 'Jade', 'Onyx', 'Ember'][i] || '') }) }), input]));
    }
  };
  form.appendChild(radioGroup(T('Ruleset'), [
    { value: 'duel', label: T(RULESETS.duel.name), desc: T(RULESETS.duel.description) },
    { value: 'grand', label: T(RULESETS.grand.name), desc: T(RULESETS.grand.description) },
    { value: 'melee', label: T(RULESETS.melee.name), desc: T(RULESETS.melee.description) },
  ], state.ruleset, (v) => {
    state.ruleset = v;
    if (state.count > RULESETS[v].playerCount) state.count = RULESETS[v].playerCount;
    renderNames();
    renderCount();
  }));
  form.appendChild(nameWrap);
  const meleeCount = el('div', { class: 'melee-count' });
  const renderCount = () => {
    meleeCount.replaceChildren();
    if (state.ruleset !== 'melee') return;
    meleeCount.appendChild(radioGroup(T('Commanders'), [2, 3, 4].map((n) => ({
      value: n, label: T('{n} commanders', { n }), desc: n < 4 ? T('Each extra house is passed around the table.') : '',
    })), state.count, (v) => { state.count = v; renderNames(); }));
  };
  renderNames();
  renderCount();
  form.appendChild(meleeCount);
  form.appendChild(el('div', { class: 'setup-actions' }, [
    button(T('Back'), () => app.go('modes'), { kind: 'ghost' }),
    button(T('Begin'), () => app.startLocal(state), { kind: 'primary' }),
  ]));
  root.replaceChildren(form);
}

// Every built group gets a fresh name/id prefix. Screens stay in the DOM while
// hidden, so a reused id would make `<label for>` target the *other* screen's
// radio and the visible one would never change.
let radioGroupSeq = 0;

function radioGroup(name, options, current, onChange) {
  const groupName = `rg${radioGroupSeq++}-${name}`.replace(/\W+/g, '-');
  const fieldset = el('fieldset', { class: 'radio-group' });
  fieldset.appendChild(el('legend', { text: name }));
  for (const opt of options) {
    const id = `${groupName}-${opt.value}`.replace(/\W+/g, '-');
    const input = el('input', { type: 'radio', name: groupName, id, value: String(opt.value) });
    input.checked = opt.value === current;
    input.addEventListener('change', () => onChange(opt.value));
    fieldset.appendChild(el('label', { for: id, class: 'radio-card' }, [
      input,
      el('span', { class: 'radio-label', text: opt.label }),
      opt.desc ? el('span', { class: 'radio-desc', text: opt.desc }) : null,
    ]));
  }
  return fieldset;
}

// --- journey map ------------------------------------------------------------------

export function buildJourney(app, root) {
  const progress = app.progress;
  const stats = journeyStats(progress);
  const wrap = el('div', { class: 'journey-map' });
  wrap.appendChild(el('h2', { text: T('Journey') }));
  wrap.appendChild(el('p', { class: 'journey-progress', text: T('{done} of {total} stages · {stars} of {maxStars} stars', { done: stats.completed, total: stats.total, stars: stats.stars, maxStars: stats.maxStars }) }));
  const next = nextMilestone(stats.stars);
  if (next) {
    wrap.appendChild(el('p', { class: 'journey-next', text: T('Next mastery reward at {stars} stars: {reward}', { stars: next.stars, reward: T(next.label) }) }));
  }
  for (const ch of JOURNEY_CHAPTERS) {
    const section = el('section', { class: 'chapter' });
    section.appendChild(el('h3', { text: `${ch.id.toUpperCase()} — ${T(ch.name)}` }));
    section.appendChild(el('p', { class: 'chapter-blurb', text: T(ch.blurb) }));
    const grid = el('div', { class: 'stage-grid' });
    for (const s of JOURNEY_STAGES.filter((x) => x.chapter === Number(ch.id.slice(2)))) {
      const rec = progress.journey[s.id];
      const unlocked = stageUnlocked(progress, s);
      const cell = el('button', {
        type: 'button',
        class: `stage-cell${rec?.completed ? ' done' : ''}${unlocked ? '' : ' locked'}${s.mastery ? ' mastery' : ''}`,
        disabled: !unlocked,
        'aria-label': rec?.completed ? T('{name}, completed with {stars} stars', { name: T(s.name), stars: rec.stars }) : T(unlocked ? '{name}, available' : '{name}, locked', { name: T(s.name) }),
        onclick: () => unlocked && app.openStageSetup(s),
      }, [
        el('span', { class: 'stage-num', text: String(s.index) }),
        el('span', { class: 'stage-stars', text: rec?.completed ? '★'.repeat(rec.stars) : (unlocked ? (s.mastery ? '👑' : '·') : '🔒') }),
      ]);
      grid.appendChild(cell);
    }
    section.appendChild(grid);
    wrap.appendChild(section);
  }
  wrap.appendChild(button(T('Back'), () => app.go('modes'), { kind: 'ghost' }));
  root.replaceChildren(wrap);
}

export function buildStageSetup(app, root, stage) {
  const ruleset = RULESETS[stage.ruleset];
  root.replaceChildren(el('div', { class: 'setup-form' }, [
    el('h2', { text: T(stage.name) }),
    el('p', { class: 'chapter-blurb', text: `${T(JOURNEY_CHAPTERS[stage.chapter - 1].name)} · ${T('Stage {n}', { n: stage.index })}${stage.mastery ? ` · ${T('Mastery trial')}` : ''}` }),
    stage.blurb ? el('p', { text: T(stage.blurb) }) : null,
    el('dl', { class: 'setup-facts' }, [
      el('dt', { text: T('Court') }), el('dd', { text: `${T(ruleset.name)} (${ruleset.size}×${ruleset.size})` }),
      el('dt', { text: T('Opponent') }), el('dd', { text: T(AI_LEVELS[stage.ai]?.name || 'None') }),
      el('dt', { text: T('Goal') }), el('dd', { text: goalText(stage.goal) }),
      el('dt', { text: T('Par') }), el('dd', { text: T('{n} plies', { n: stage.par }) }),
      el('dt', { text: T('Ranked') }), el('dd', { text: T('No') }),
    ]),
    el('div', { class: 'setup-actions' }, [
      button(T('Back'), () => app.go('journey'), { kind: 'ghost' }),
      button(T('Play stage'), () => app.startJourneyStage(stage), { kind: 'primary' }),
    ]),
  ].filter(Boolean)));
}

export function goalText(goal) {
  if (!goal || (!goal.maxPlies && !Number.isFinite(goal.maxLost) && !goal.minPiecesLeft)) return T('Win the round.');
  const parts = [];
  if (goal.maxPlies) parts.push(T('within {n} plies', { n: goal.maxPlies }));
  if (Number.isFinite(goal.maxLost)) parts.push(T('losing at most {n} pieces', { n: goal.maxLost }));
  if (goal.minPiecesLeft) parts.push(T('with at least {n} pieces left', { n: goal.minPiecesLeft }));
  return T('Win {conditions}.', { conditions: parts.join(T(', ')) });
}

// --- learn --------------------------------------------------------------------------

export function buildLearn(app, root) {
  const done = new Set(app.progress.lessonsComplete);
  const list = el('ol', { class: 'lesson-list' });
  for (const lesson of LESSONS) {
    const isDone = done.has(lesson.id);
    list.appendChild(el('li', {}, [
      el('button', {
        type: 'button', class: `lesson-card${isDone ? ' done' : ''}`,
        onclick: () => app.startLesson(lesson.id),
      }, [
        el('span', { class: 'lesson-title', text: T(lesson.title) }),
        el('span', { class: 'lesson-intro', text: T(lesson.intro) }),
        el('span', { class: 'lesson-meta', text: `${T('{n} min', { n: lesson.minutes })}${isDone ? ` · ${T('complete ✓')}` : ''}` }),
      ]),
    ]));
  }
  root.replaceChildren(
    el('h2', { text: T('Learn the court') }),
    el('p', { text: T('Each lesson teaches one rule and asks you to play it. Lessons use the same legal-move engine as every other mode.') }),
    list,
    button(T('Back'), () => app.go('modes'), { kind: 'ghost' }),
  );
}

// --- challenges ---------------------------------------------------------------------

export function buildChallenges(app, root) {
  const list = el('div', { class: 'challenge-list' });
  for (const c of CHALLENGES) {
    const rec = app.progress.challenges[c.id];
    list.appendChild(el('button', {
      type: 'button', class: `challenge-card${rec?.completed ? ' done' : ''}`,
      onclick: () => app.openChallengeSetup(c),
    }, [
      el('h3', { text: T(c.name) }),
      el('p', { text: T(c.desc) }),
      el('p', { class: 'mode-meta', text: `${constraintSummary(c, T)}${rec?.completed ? ` · ${T('best {score}', { score: rec.bestScore })}` : ''}` }),
    ]));
  }
  root.replaceChildren(
    el('h2', { text: T('Challenges') }),
    list,
    button(T('Back'), () => app.go('modes'), { kind: 'ghost' }),
  );
}

export function buildChallengeSetup(app, root, c) {
  root.replaceChildren(el('div', { class: 'setup-form' }, [
    el('h2', { text: T(c.name) }),
    el('p', { text: T(c.desc) }),
    el('dl', { class: 'setup-facts' }, [
      el('dt', { text: T('Court') }), el('dd', { text: T(RULESETS[c.ruleset].name) }),
      el('dt', { text: T('Opponent') }), el('dd', { text: c.ai ? T(AI_LEVELS[c.ai].name) : T('Local players') }),
      el('dt', { text: T('Constraints') }), el('dd', { text: constraintSummary(c, T) }),
      el('dt', { text: T('Ranked') }), el('dd', { text: T('No') }),
    ]),
    el('div', { class: 'setup-actions' }, [
      button(T('Back'), () => app.go('challenges'), { kind: 'ghost' }),
      button(T('Begin challenge'), () => app.startChallenge(c), { kind: 'primary' }),
    ]),
  ]));
}

// --- daily ---------------------------------------------------------------------------

export function buildDailySetup(app, root) {
  const def = app.dailyDef;
  const rec = app.progress.daily[def.date];
  const excluded = rec?.excluded;
  const countdown = msUntilNextDaily(app.platformNow ? new Date(app.platformNow()) : new Date());
  root.replaceChildren(el('div', { class: 'setup-form' }, [
    el('h2', { text: T('Daily Court — {date}', { date: def.date }) }),
    el('p', { text: T('One seed and ruleset per UTC day — the same for every player. Ranked.') }),
    el('dl', { class: 'setup-facts' }, [
      el('dt', { text: T('Court') }), el('dd', { text: T(RULESETS[def.ruleset].name) }),
      el('dt', { text: T('Opponent') }), el('dd', { text: T(AI_LEVELS[def.ai].name) }),
      el('dt', { text: T('Goal') }), el('dd', { text: goalText(def.goal) }),
      el('dt', { text: T('Today') }), el('dd', { text: rec?.completed ? (rec.won ? T('Won — score {score}', { score: rec.score }) : T('Played')) : T('Not yet played') }),
      el('dt', { text: T('Next court in') }), el('dd', { text: `${Math.floor(countdown / 3600000)}h ${Math.floor((countdown % 3600000) / 60000)}m` }),
      el('dt', { text: T('Streak') }), el('dd', { text: T('{n} day(s)', { n: app.progress.stats.dailyStreak }) }),
    ]),
    excluded ? el('p', { class: 'setup-note warn', text: T('This day was marked defective and is excluded from ranking.') }) : null,
    buildDailyHistory(app),
    el('div', { class: 'setup-actions' }, [
      button(T('Back'), () => app.go('title'), { kind: 'ghost' }),
      button(rec?.completed ? T('Play again (unranked)') : T('Play the Daily'), () => app.startDaily(), { kind: 'primary' }),
    ]),
  ].filter(Boolean)));
}

/** Local daily board: your recent results with full submission metadata. */
function buildDailyHistory(app) {
  const entries = Object.entries(app.progress.daily)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 7);
  if (!entries.length) return null;
  const list = el('div', { class: 'daily-history' });
  list.appendChild(el('h3', { text: T('Your recent dailies') }));
  for (const [date, rec] of entries) {
    list.appendChild(el('p', { class: 'daily-row', text: `${date} — ${T(rec.won ? 'won, score {score}' : 'played, score {score}', { score: rec.score })}${rec.excluded ? ` ${T('(excluded from ranking)')}` : ''}` }));
  }
  return list;
}

// --- profile -------------------------------------------------------------------------

export function buildProfile(app, modal) {
  const p = app.profile;
  const s = app.progress.stats;
  const stats = journeyStats(app.progress);
  const box = modal.box;
  box.appendChild(el('h2', { text: T('Profile') }));
  const nameInput = el('input', { type: 'text', value: p.name, maxlength: '24', class: 'text-input', 'aria-label': T('Display name') });
  nameInput.addEventListener('change', () => {
    p.name = nameInput.value.trim() || T('Guest Gardener');
    app.saveProfile();
    audio.settingsSaved();
    app.ui.toast(T('Name saved.'));
  });
  box.appendChild(el('label', { class: 'field' }, [el('span', { text: T('Display name') }), nameInput]));
  const colors = ['#d4af37', '#7fb2e0', '#4a8a68', '#b05038', '#9a5fd0', '#e8e0c0'];
  const swatches = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': T('Avatar color') });
  for (const c of colors) {
    const sw = el('button', {
      type: 'button', class: `swatch${p.avatar.color === c ? ' active' : ''}`,
      style: `background:${c}`, 'aria-label': T('Color {value}', { value: c }), 'aria-pressed': p.avatar.color === c,
    });
    sw.addEventListener('click', () => {
      p.avatar.color = c;
      app.saveProfile();
      swatches.querySelectorAll('.swatch').forEach((x) => { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
      sw.classList.add('active');
      sw.setAttribute('aria-pressed', 'true');
    });
    swatches.appendChild(sw);
  }
  box.appendChild(swatches);
  box.appendChild(el('dl', { class: 'setup-facts' }, [
    el('dt', { text: T('Rating (duel / grand)') }),
    el('dd', { text: `${p.rating.duel} / ${p.rating.grand}` }),
    el('dt', { text: T('Rounds played') }), el('dd', { text: String(s.roundsCompleted) }),
    el('dt', { text: T('Wins') }), el('dd', { text: String(s.wins) }),
    el('dt', { text: T('Daily wins') }), el('dd', { text: T('{n} (best streak {best})', { n: s.dailyWins, best: s.bestDailyStreak }) }),
    el('dt', { text: T('Journey') }), el('dd', { text: T('{done}/{total} stages, {stars} stars', { done: stats.completed, total: stats.total, stars: stats.stars }) }),
    el('dt', { text: T('Longest chain') }), el('dd', { text: String(s.bestChain) }),
  ]));
  // achievements
  const have = new Set(app.progress.achievements);
  const ach = el('div', { class: 'ach-grid' });
  for (const a of ACHIEVEMENTS) {
    ach.appendChild(el('div', { class: `ach-card${have.has(a.key) ? ' unlocked' : ''}`, title: T(a.desc) }, [
      el('strong', { text: T(a.name) }),
      el('span', { text: have.has(a.key) ? T(a.desc) : '???' }),
    ]));
  }
  box.appendChild(el('h3', { text: T('Achievements') }));
  box.appendChild(ach);
  // mastery track
  const track = el('ol', { class: 'mastery-track' });
  for (const m of MASTERY_TRACK) {
    const claimed = stats.stars >= m.stars;
    track.appendChild(el('li', { class: claimed ? 'claimed' : '' }, [
      el('span', { text: `${m.stars}★` }),
      el('span', { text: T(m.label) }),
      el('span', { text: claimed ? '✓' : '' }),
    ]));
  }
  box.appendChild(el('h3', { text: T('Mastery track') }));
  box.appendChild(track);
  // cosmetics
  box.appendChild(el('h3', { text: T('Cosmetics') }));
  box.appendChild(buildCosmetics(app));
}

function buildCosmetics(app) {
  const wrap = el('div', { class: 'cosmetics' });
  const stats = journeyStats(app.progress);
  const slots = ['material', 'trail', 'surround', 'flourish'];
  for (const slot of slots) {
    const slotLabel = T({ material: N('Material'), trail: N('Trail'), surround: N('Surround'), flourish: N('Flourish') }[slot]);
    const sel = el('select', { class: 'select', 'aria-label': slotLabel });
    for (const c of COSMETICS.filter((x) => x.slot === slot)) {
      const locked = stats.stars < c.unlockStars;
      const opt = el('option', { value: c.id, text: `${T(c.name)}${locked ? ` ${T('(unlock at {n}★)', { n: c.unlockStars })}` : ''}` });
      opt.disabled = locked;
      if (app.settings.cosmetics[slot] === c.id) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      app.settings.cosmetics[slot] = sel.value;
      app.saveSettings();
      app.ui.toast(T('Cosmetic applied.'));
    });
    wrap.appendChild(el('label', { class: 'field' }, [el('span', { text: slotLabel }), sel]));
  }
  return wrap;
}

// --- results ---------------------------------------------------------------------------

export function buildResults(app, root, { over, config, outcome }) {
  const me = outcome.mySeat;
  const myBreak = over.breakdowns[me];
  const wrap = el('div', { class: 'results' });
  const goalMissed = over.goalMet === false && over.winner !== null && outcome.iWon;
  const headline = goalMissed ? T('Goal Missed')
    : over.winner === null ? T('A Truce')
    : (outcome.iWon ? T('Victory') : (outcome.localMultiplayer ? T('{name} wins', { name: T(over.winnerName || 'A house') }) : T('Defeat')));
  // illustration: a crowned stone for a decided round, a fallen stone for a defeat; truces show none
  const banner = over.winner === null ? null
    : (goalMissed || (!outcome.iWon && !outcome.localMultiplayer)) ? 'results-defeat' : 'results-victory';
  if (banner) {
    wrap.appendChild(el('img', {
      class: 'result-banner', src: `assets/${banner}.webp`, alt: '', width: '896', height: '384',
      decoding: 'async', onerror: (e) => e.target.remove(),
    }));
  }
  wrap.appendChild(el('h2', { class: `result-headline ${goalMissed ? 'loss' : over.winner === null ? 'draw' : outcome.iWon ? 'win' : 'loss'}`, text: headline }));
  wrap.appendChild(el('p', { class: 'result-reason', text: T(over.reasonText) }));
  // score breakdown — components, never one unexplained total
  const table = el('table', { class: 'breakdown' });
  table.appendChild(el('caption', { text: T('Score breakdown') }));
  const rows = [
    [T('Captures'), myBreak.components.captures],
    [T('Crowns taken'), myBreak.components.crowns],
    [T('Pieces preserved'), myBreak.components.survival],
    [T('Objective'), myBreak.components.objective],
    [T('Efficiency'), myBreak.components.efficiency],
    [T('Speed'), myBreak.components.timeBonus],
    [T('Slips'), myBreak.components.penalties],
  ];
  for (const [label, val] of rows) {
    table.appendChild(el('tr', {}, [
      el('th', { scope: 'row', text: label }),
      el('td', { text: val > 0 ? `+${val}` : String(val), class: val < 0 ? 'neg' : '' }),
    ]));
  }
  table.appendChild(el('tr', { class: 'total' }, [el('th', { scope: 'row', text: T('Total') }), el('td', { text: String(myBreak.total) })]));
  wrap.appendChild(table);
  const facts = [T('{n} plies', { n: over.plies })];
  if (Number.isFinite(over.elapsedMs)) facts.push(`${(over.elapsedMs / 1000).toFixed(0)}s`);
  if (outcome.stars) facts.push(T('{stars} earned', { stars: '★'.repeat(outcome.stars) }));
  if (outcome.ratingDelta) facts.push(T('rating {delta}', { delta: `${outcome.ratingDelta > 0 ? '+' : ''}${outcome.ratingDelta}` }));
  if (over.assistsUsed) facts.push(T('assists used'));
  wrap.appendChild(el('p', { class: 'result-facts', text: facts.join(' · ') }));
  if (outcome.unlocked?.length) {
    const list = el('div', { class: 'unlock-list' });
    for (const key of outcome.unlocked) {
      const a = ACHIEVEMENTS.find((x) => x.key === key);
      if (a) list.appendChild(el('p', { class: 'unlock', text: T('Achievement: {name} — {desc}', { name: T(a.name), desc: T(a.desc) }) }));
    }
    for (const m of outcome.mastery || []) {
      list.appendChild(el('p', { class: 'unlock', text: T('Mastery reward: {reward}', { reward: T(m.label) }) }));
    }
    wrap.appendChild(list);
  }
  wrap.appendChild(el('p', { class: 'result-facts result-lb', role: 'status', hidden: true }));
  const actions = el('div', { class: 'setup-actions' });
  if (outcome.nextAction) {
    actions.appendChild(button(typeof outcome.nextAction.label === 'function' ? outcome.nextAction.label() : T(outcome.nextAction.label), outcome.nextAction.fn, { kind: 'primary' }));
  }
  actions.appendChild(button(T('Play again'), () => app.retryLast()));
  actions.appendChild(button(T('Leave'), () => app.exitToTitle(), { kind: 'ghost' }));
  wrap.appendChild(actions);
  root.replaceChildren(wrap);
}

// --- help --------------------------------------------------------------------------------

export function buildHelp(app, modal) {
  const box = modal.box;
  box.appendChild(el('h2', { text: T('How the court works') }));
  const cards = [
    { title: T('Moving'), body: T('Pieces step one square diagonally forward along the dark squares. Tap a piece to see where it may go; glowing squares are legal destinations.') },
    { title: T('Capturing'), body: T('Jump over an adjacent enemy piece onto the empty square beyond to capture it. Captures are mandatory — if one exists, the court refuses quiet moves.') },
    { title: T('Chains'), body: T('After a jump, if the same piece can jump again, it must. Chains end when no jump remains. Long chains are the soul of the game.') },
    { title: T('Crowning'), body: T('A piece that reaches the far edge is crowned. Crowns move and capture in all four diagonal directions. Crowning ends the turn immediately.') },
    { title: T('Winning'), body: T('Capture every enemy piece, or leave the enemy with no legal move. Draws come from threefold repetition, long capture-less stretches, or agreement.') },
    { title: T('Royal Melee'), body: T('Four houses on a wide court, each advancing from its own edge. Last house standing takes the garden.') },
  ];
  const grid = el('div', { class: 'help-grid' });
  for (const c of cards) {
    grid.appendChild(el('article', { class: 'help-card' }, [el('h3', { text: c.title }), el('p', { text: c.body })]));
  }
  box.appendChild(grid);
  // controls from current bindings
  box.appendChild(el('h3', { text: T('Controls') }));
  const table = el('table', { class: 'controls-table' });
  for (const a of ACTIONS) {
    table.appendChild(el('tr', {}, [
      el('th', { scope: 'row', text: T(a.label) }),
      el('td', { text: app.input.bindingText(a.id) || '—' }),
    ]));
  }
  box.appendChild(table);
  box.appendChild(el('p', { class: 'setup-note', text: T('Gamepad: d-pad or left stick moves the cursor, A confirms, B cancels, Start pauses. Rebind everything in Settings → Controls.') }));
}

// --- settings ------------------------------------------------------------------------------

export function buildSettings(app, modal) {
  const box = modal.box;
  const s = app.settings;
  box.appendChild(el('h2', { text: T('Settings') }));
  const tabs = el('div', { class: 'settings-tabs', role: 'tablist' });
  const panels = el('div', { class: 'settings-panels' });
  const defs = [
    ['audio', N('Audio'), () => settingsAudio(app)],
    ['graphics', N('Graphics'), () => settingsGraphics(app)],
    ['controls', N('Controls'), () => settingsControls(app)],
    ['access', N('Accessibility'), () => settingsAccess(app)],
    ['privacy', N('Privacy'), () => settingsPrivacy(app)],
  ];
  let first = true;
  let active = defs[0];
  for (const def of defs) {
    const [id, label, builder] = def;
    const tab = el('button', { type: 'button', role: 'tab', class: `tab${first ? ' active' : ''}`, text: T(label), 'aria-selected': String(first), 'data-tab': id, id: `settings-tab-${id}` });
    tab.addEventListener('click', () => {
      audio.tabSwitch();
      tabs.querySelectorAll('.tab').forEach((t) => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      active = def;
      panels.replaceChildren(builder());
    });
    tabs.appendChild(tab);
    if (first) { panels.replaceChildren(builder()); first = false; }
  }
  box.appendChild(tabs);
  box.appendChild(panels);
  // Language change: relabel in place. The Graphics tab only swaps the game's
  // own blocks, so the shared Language / Sound / Report sections (game-options.js)
  // and the select the player is using stay where they are.
  modal.relabel = () => {
    modal.setTitle(T('Settings'));
    box.querySelector('h2').textContent = T('Settings');
    for (const [id, label] of defs) { const t = tabs.querySelector(`[data-tab="${id}"]`); if (t) t.textContent = T(label); }
    const gfx = panels.querySelector('#gfx-panel');
    if (active[0] === 'graphics' && gfx) {
      gfx.querySelector('.gfx-quality')?.replaceWith(buildGraphicsQuality(app));
      gfx.querySelector('.gfx-own')?.replaceWith(graphicsOwnRows(app));
    } else {
      panels.replaceChildren(active[2]());
    }
  };
}

function sliderRow(label, value, onInput, { min = 0, max = 1, step = 0.05 } = {}) {
  const input = el('input', { type: 'range', min, max, step, value, class: 'slider' });
  const val = el('span', { class: 'slider-val', text: `${Math.round(value * 100)}%` });
  input.addEventListener('input', () => {
    val.textContent = `${Math.round(Number(input.value) * 100)}%`;
    audio.sliderDrag();
    onInput(Number(input.value));
  });
  return el('label', { class: 'field slider-row' }, [el('span', { text: label }), input, val]);
}

function toggleRow(label, checked, onChange, hint = '') {
  const input = el('input', { type: 'checkbox', class: 'toggle' });
  input.checked = checked;
  input.addEventListener('change', () => { audio.toggle(); onChange(input.checked); });
  return el('label', { class: 'field toggle-row' }, [input, el('span', { text: label }), hint ? el('small', { text: hint }) : null]);
}

function settingsAudio(app) {
  const s = app.settings.audio;
  const wrap = el('div', {});
  wrap.appendChild(sliderRow(T('Music'), s.music, (v) => { s.music = v; app.applyAudioSettings(); }));
  wrap.appendChild(sliderRow(T('Effects'), s.effects, (v) => { s.effects = v; app.applyAudioSettings(); }));
  wrap.appendChild(sliderRow(T('Ambience'), s.ambience, (v) => { s.ambience = v; app.applyAudioSettings(); }));
  wrap.appendChild(sliderRow(T('Voice cues'), s.voice, (v) => { s.voice = v; app.applyAudioSettings(); }));
  wrap.appendChild(toggleRow(T('Mute all'), s.muted, (v) => { s.muted = v; app.applyAudioSettings(); }));
  wrap.appendChild(toggleRow(T('Spoken turn announcements'), s.voiceCues, (v) => { s.voiceCues = v; app.applyAudioSettings(); }, T('Uses your device speech voice.')));
  return wrap;
}

function settingsGraphics(app) {
  const wrap = el('div', { class: 'gfx-panel', id: 'gfx-panel' });
  wrap.appendChild(buildGraphicsQuality(app));
  wrap.appendChild(graphicsOwnRows(app));
  return wrap;
}

/** Camera and garden theme rows (rebuilt alone on a language change). */
function graphicsOwnRows(app) {
  const wrap = el('div', { class: 'gfx-own' });
  const cam = el('select', { class: 'select', 'aria-label': T('Camera') });
  for (const [v, label] of [['classic', N('Classic')], ['low', N('Low (near the stone)')], ['top', N('Top-down')]]) {
    const o = el('option', { value: v, text: T(label) });
    if (app.settings.camera.preset === v) o.selected = true;
    cam.appendChild(o);
  }
  cam.addEventListener('change', () => { app.settings.camera.preset = cam.value; app.saveSettings(); app.renderer.setCameraPreset(cam.value); });
  wrap.appendChild(el('label', { class: 'field' }, [el('span', { text: T('Camera') }), cam]));
  const theme = el('select', { class: 'select', 'aria-label': T('Theme') });
  for (const t of Object.values(THEMES)) {
    const o = el('option', { value: t.id, text: T(t.name) });
    if (app.settings.theme === t.id) o.selected = true;
    theme.appendChild(o);
  }
  theme.addEventListener('change', () => {
    app.settings.theme = theme.value;
    app.saveSettings();
    app.applyTheme();
  });
  wrap.appendChild(el('label', { class: 'field' }, [el('span', { text: T('Garden theme') }), theme]));
  return wrap;
}

/**
 * Graphics quality block: preset, render scale, per-category overrides,
 * adaptive resolution, frame-rate readout and a live cost summary. Every
 * change applies immediately and is saved with the other settings.
 */
function buildGraphicsQuality(app) {
  const G = gfxStrings();
  const box = el('div', { class: 'gfx-quality' });
  const save = () => { app.applyGraphicsSettings(); refresh(); };
  const info = () => app.renderer?.graphicsInfo?.() || { gpu: 'unknown GPU', detected: 'low', resolved: null, pixels: [0, 0], postFailed: false };
  box.appendChild(el('h3', { class: 'gfx-heading', text: G.heading }));

  // quality preset
  const presetSel = el('select', { class: 'select', id: 'gfx-preset', 'data-gfx': 'preset' });
  const autoOpt = el('option', { value: 'auto' });
  presetSel.appendChild(autoOpt);
  for (const p of PRESETS) presetSel.appendChild(el('option', { value: p, text: G.presets[p] }));
  presetSel.addEventListener('change', () => {
    app.settings.graphics = choosePreset(app.settings.graphics, presetSel.value);
    save();
  });
  box.appendChild(el('label', { class: 'field', for: 'gfx-preset' }, [el('span', { text: G.quality }), presetSel]));

  // render scale 50–200 %
  const scale = el('input', { type: 'range', min: 0.5, max: 2, step: 0.05, class: 'slider', id: 'gfx-scale', 'data-gfx': 'render_scale' });
  const scaleVal = el('span', { class: 'slider-val' });
  scale.addEventListener('input', () => {
    scaleVal.textContent = `${Math.round(Number(scale.value) * 100)}%`;
    audio.sliderDrag();
  });
  scale.addEventListener('change', () => { app.settings.graphics.render_scale = Number(scale.value); save(); });
  box.appendChild(el('label', { class: 'field slider-row gfx-scale-row', for: 'gfx-scale' }, [el('span', { text: G.renderScale }), scale, scaleVal]));

  // per-category overrides
  const catSels = {};
  const grid = el('div', { class: 'gfx-grid' });
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    const sel = el('select', { class: 'select', id: `gfx-${cat}`, 'data-gfx-cat': cat });
    sel.appendChild(el('option', { value: 'preset' }));
    for (const t of tiers) sel.appendChild(el('option', { value: t, text: G.tiers[t] || t }));
    sel.addEventListener('change', () => {
      if (sel.value === 'preset') delete app.settings.graphics[cat];
      else app.settings.graphics[cat] = sel.value;
      save();
    });
    catSels[cat] = sel;
    grid.appendChild(el('label', { class: 'field', for: `gfx-${cat}` }, [el('span', { text: G.cats[cat] }), sel]));
  }
  box.appendChild(grid);

  // toggles
  const mkToggle = (id, label, key, def, hint) => {
    const input = el('input', { type: 'checkbox', class: 'toggle', id, 'data-gfx': key });
    input.addEventListener('change', () => { audio.toggle(); app.settings.graphics[key] = input.checked; save(); });
    box.appendChild(el('label', { class: 'field toggle-row', for: id }, [input, el('span', { text: label }), hint ? el('small', { text: hint }) : null]));
    return () => { input.checked = app.settings.graphics[key] ?? def; };
  };
  const syncAdaptive = mkToggle('gfx-adaptive', G.adaptive, 'adaptive', true, G.adaptiveHint);
  const syncFps = mkToggle('gfx-fps', G.showFps, 'show_fps', false, '');

  const summary = el('p', { class: 'gfx-summary', id: 'gfx-summary', 'aria-live': 'polite' });
  const note = el('p', { class: 'setup-note gfx-post-note', id: 'gfx-post-note', text: G.postNote, hidden: true });
  box.appendChild(summary);
  box.appendChild(note);

  function refresh() {
    const g = app.settings.graphics;
    const inf = info();
    const r = inf.resolved;
    autoOpt.textContent = fmt(G.auto, { tier: G.presets[inf.detected] || inf.detected });
    presetSel.value = PRESETS.includes(g.preset) ? g.preset : 'auto';
    const rs = Number(g.render_scale) || 1;
    scale.value = String(rs);
    scaleVal.textContent = `${Math.round(rs * 100)}%`;
    const preset = r?.preset || inf.detected;
    for (const [cat, sel] of Object.entries(catSels)) {
      const pt = presetTier(preset, cat);
      sel.options[0].textContent = fmt(G.fromPreset, { tier: G.tiers[pt] || pt });
      sel.value = CATEGORIES[cat].includes(g[cat]) ? g[cat] : 'preset';
    }
    syncAdaptive();
    syncFps();
    summary.textContent = r ? `${inf.gpu} · ${describe(r, inf.pixels, G.sum)}` : inf.gpu;
    summary.dataset.gfxPreset = r?.preset || '';
    note.hidden = !inf.postFailed;
  }
  refresh();
  // the post chain builds on the next frame; re-check for a failure note
  setTimeout(refresh, 250);
  return box;
}

function settingsControls(app) {
  const wrap = el('div', {});
  wrap.appendChild(el('p', { class: 'setup-note', text: T('Select an action, then press the new key or gamepad button.') }));
  const table = el('table', { class: 'controls-table' });
  for (const a of ACTIONS) {
    const keyBtn = button(app.input.bindingText(a.id) || '—', async () => {
      keyBtn.textContent = T('press a key…');
      const code = await app.input.recordNext(a.id, 'keyboard');
      app.settings.bindings = app.settings.bindings || {};
      app.settings.bindings[a.id] = [code];
      app.input.applyOverrides(app.settings.bindings);
      app.saveSettings();
      app.platform.setControl(a.id, [code]); // platform controls (signed in only)
      keyBtn.textContent = app.input.bindingText(a.id);
    }, { kind: 'ghost' });
    const padBtn = button((app.input.gamepad[a.id] || []).map((b) => `B${b}`).join('/') || '—', async () => {
      padBtn.textContent = T('press a button…');
      const idx = await app.input.recordNext(a.id, 'gamepad');
      app.settings.gamepad = app.settings.gamepad || {};
      app.settings.gamepad[a.id] = [idx];
      app.input.applyGamepadOverrides(app.settings.gamepad);
      app.saveSettings();
      padBtn.textContent = `B${idx}`;
    }, { kind: 'ghost' });
    table.appendChild(el('tr', {}, [el('th', { scope: 'row', text: T(a.label) }), el('td', {}, [keyBtn]), el('td', {}, [padBtn])]));
  }
  wrap.appendChild(table);
  wrap.appendChild(button(T('Reset to defaults'), () => {
    app.settings.bindings = null;
    app.settings.gamepad = null;
    app.input.keyboard = structuredClone(DEFAULT_KEYBOARD);
    app.input.gamepad = structuredClone(DEFAULT_GAMEPAD);
    app.saveSettings();
    app.platform.resetControls();
    app.ui.toast(T('Bindings reset to defaults.'));
  }, { kind: 'ghost' }));
  return wrap;
}

function settingsAccess(app) {
  const a = app.settings.accessibility;
  const wrap = el('div', {});
  wrap.appendChild(toggleRow(T('Reduced motion'), a.reducedMotion, (v) => { a.reducedMotion = v; app.applyAccessSettings(); }, T('No camera swoops, shake, or dense particles.')));
  wrap.appendChild(toggleRow(T('High contrast'), a.highContrast, (v) => { a.highContrast = v; app.applyAccessSettings(); }));
  wrap.appendChild(toggleRow(T('Larger text'), a.largeText, (v) => { a.largeText = v; app.applyAccessSettings(); }));
  wrap.appendChild(toggleRow(T('Left-handed controls'), a.leftHanded, (v) => { a.leftHanded = v; app.applyAccessSettings(); }, T('Moves the action tray to the left.')));
  wrap.appendChild(toggleRow(T('Always show HTML board'), a.domBoard, (v) => { a.domBoard = v; app.applyAccessSettings(); }, T('A fully playable semantic board beside the 3D scene.')));
  wrap.appendChild(toggleRow(T('Timing assistance'), a.timingAssist, (v) => { a.timingAssist = v; app.saveSettings(); }, T('Clocks run at half speed for you in solo play.')));
  wrap.appendChild(toggleRow(T('Haptics'), a.haptics, (v) => { a.haptics = v; app.saveSettings(); }));
  const pal = el('select', { class: 'select', 'aria-label': T('Color palette') });
  for (const [v, label] of [['default', N('Default palette')], ['deuteranopia', N('Deuteranopia-safe')], ['protanopia', N('Protanopia-safe')], ['tritanopia', N('Tritanopia-safe')]]) {
    const o = el('option', { value: v, text: T(label) });
    if (a.colorPalette === v) o.selected = true;
    pal.appendChild(o);
  }
  pal.addEventListener('change', () => { a.colorPalette = pal.value; app.applyAccessSettings(); });
  wrap.appendChild(el('label', { class: 'field' }, [el('span', { text: T('Color-vision palette') }), pal]));
  wrap.appendChild(button(T('Replay tutorial lessons'), () => app.go('learn'), { kind: 'ghost' }));
  return wrap;
}

function settingsPrivacy(app) {
  const wrap = el('div', {});
  const consent = app.settings.telemetryConsent === true;
  wrap.appendChild(toggleRow(T('Anonymous usage stats'), consent, (v) => {
    app.settings.telemetryConsent = v;
    app.platform.setTelemetryConsent(v);
    app.saveSettings();
  }, T('Only funnel events: start, tutorial step, round end, retry, settings change, error. Never text or pointers.')));
  wrap.appendChild(el('p', { class: 'setup-note', text: T('Progress is stored on this device and, when signed in through the host, synced as a versioned cloud save. No credentials or chat content are ever placed in saves.') }));
  return wrap;
}

// --- lobby ------------------------------------------------------------------------------------

export function buildLobby(app, root) {
  const wrap = el('div', { class: 'setup-form' });
  wrap.appendChild(el('h2', { text: T('Hosted play') }));
  if (!app.platform.online) {
    wrap.appendChild(el('p', { class: 'setup-note warn', text: T('Hosted play needs a connection to a game host. You are playing standalone, so only Pass & Play is available.') }));
    wrap.appendChild(el('div', { class: 'setup-actions' }, [
      button(T('Back'), () => app.go('modes'), { kind: 'ghost' }),
      button(T('Pass & Play instead'), () => app.openMode('local'), { kind: 'primary' }),
    ]));
    root.replaceChildren(wrap);
    return;
  }
  const state = app.formState('lobby', () => ({ ruleset: 'duel', listed: false, joinCode: '', clock: false }));
  wrap.appendChild(el('h3', { text: T('Host a table') }));
  wrap.appendChild(radioGroup(T('Ruleset'), Object.values(RULESETS).map((r) => ({ value: r.id, label: `${T(r.name)} (${T(r.playersLabel)})`, desc: T(r.description) })), state.ruleset, (v) => { state.ruleset = v; }));
  wrap.appendChild(toggleRow(T('List publicly (open matching)'), state.listed, (v) => { state.listed = v; }));
  wrap.appendChild(toggleRow(T('90-second turn deadline'), state.clock, (v) => { state.clock = v; }));
  const hostRow = el('div', { class: 'setup-actions' }, [
    button(T('Create table'), async () => {
      await app.hostTable(state);
    }, { kind: 'primary' }),
  ]);
  wrap.appendChild(hostRow);
  wrap.appendChild(el('h3', { text: T('Join a table') }));
  wrap.appendChild(el('div', { class: 'setup-actions' }, [
    button(T('Join an open table'), async () => { await app.quickJoinTable(); }, { kind: 'primary' }),
  ]));
  wrap.appendChild(el('p', { class: 'setup-note', text: T('Open tables fill instantly. Private tables arrive as friend invites — there are no join codes on the platform.') }));
  wrap.appendChild(tableInvites(app));
  wrap.appendChild(el('div', { class: 'setup-actions' }, [button(T('Back'), () => app.go('modes'), { kind: 'ghost' })]));
  root.replaceChildren(wrap);
}

export function buildTableRoom(app, root, client) {
  const wrap = el('div', { class: 'setup-form' });
  wrap.appendChild(el('h2', { text: T('Your table') }));
  const codeEl = el('p', { class: 'join-code', text: T('Join code: {code}', { code: client.joinCode || '—' }) });
  wrap.appendChild(codeEl);
  const roster = el('ul', { class: 'roster' });
  wrap.appendChild(roster);
  const update = () => {
    roster.replaceChildren();
    for (const p of client.players) {
      roster.appendChild(el('li', { text: T(p.connected ? '{name} — rating {rating}' : '{name} (away) — rating {rating}', { name: T(p.name), rating: p.rating }) }));
    }
  };
  update();
  // Re-rendered on a language change: drop the old screen's listener.
  root._unsubPlayers?.();
  root._unsubPlayers = client.on('players', update);
  const isHost = client.seat === 0;
  const startBtn = button(T('Start the round'), async () => {
    const res = await client.startGame();
    if (!res.ok) app.ui.toast(res.error === 'only the host can start' ? T('Only the host can start the round.') : T('Could not start'), 'warn');
  }, { kind: 'primary' });
  startBtn.disabled = !isHost;
  if (!isHost) startBtn.textContent = T('Waiting for the host…');
  wrap.appendChild(startBtn);
  if (isHost && app.platform.hosted) wrap.appendChild(friendsPicker(app, client));
  // voice is an explicit opt-in and only when the host platform supports it
  const voiceNote = el('p', { class: 'setup-note', text: app.platform.mode === 'hosted'
    ? T('Voice rooms are available from the host shell once everyone joins. Voice is never required to play.')
    : T('Voice rooms need a hosting platform; this table is voice-free. Chat works once the round starts.') });
  wrap.appendChild(voiceNote);
  wrap.appendChild(button(T('Leave table'), () => app.leaveHosted(), { kind: 'ghost' }));
  root.replaceChildren(wrap);
}

/** Incoming realtime-room invites from friends, each with a Join button. */
function tableInvites(app) {
  const PT = platformStrings();
  const box = el('section', { class: 'platform-invites', 'aria-labelledby': 'table-invites-h' });
  box.appendChild(el('h3', { id: 'table-invites-h', text: PT.tableInvites }));
  const list = el('ul', { class: 'roster invite-list' }, [el('li', { class: 'setup-note', text: '…' })]);
  box.appendChild(list);
  app.platform.pollInvites().then(async (res) => {
    const raw = res.ok ? (Array.isArray(res.data) ? res.data : res.data?.incoming || res.data?.items || []) : [];
    if (!raw.length) { list.replaceChildren(el('li', { class: 'setup-note', text: PT.noInvites })); return; }
    const rows = await Promise.all(raw.map(async (inv) => {
      const from = inv.fromUserId || inv.hostUserId || inv.userId;
      const name = inv.fromName || (from ? await app.platform.profileFor(from) : '—');
      return el('li', { class: 'invite-row' }, [
        el('span', { text: pfmt(PT.from, { name }) }),
        button(PT.join, () => app.acceptTableInvite(inv.id || inv.inviteId), { kind: 'primary' }),
      ]);
    }));
    list.replaceChildren(...rows);
  }).catch(() => list.replaceChildren(el('li', { class: 'setup-note', text: PT.noInvites })));
  return box;
}

/** Host: invite StarHermit friends (online first) to this table. */
function friendsPicker(app, client) {
  const PT = platformStrings();
  const box = el('section', { class: 'platform-invites', 'aria-labelledby': 'friends-h' });
  box.appendChild(el('h3', { id: 'friends-h', text: PT.inviteFriends }));
  const list = el('ul', { class: 'roster invite-list' }, [el('li', { class: 'setup-note', text: '…' })]);
  box.appendChild(list);
  app.platform.listFriends().then((res) => {
    const friends = (res.data || []).slice().sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));
    if (!friends.length) { list.replaceChildren(el('li', { class: 'setup-note', text: PT.noFriends })); return; }
    list.replaceChildren(...friends.map((f) => {
      const btn = button(PT.sendInvite, async () => {
        btn.disabled = true;
        const r = await app.platform.inviteToRoom(client.roomId, f.userId);
        if (r.ok) btn.textContent = PT.invited;
        else { btn.disabled = false; app.ui.toast(PT.inviteFailed, 'warn'); }
      }, { kind: 'secondary' });
      return el('li', { class: 'invite-row' }, [
        el('span', { text: `${f.name} · ${f.online ? PT.online : PT.offline}` }),
        btn,
      ]);
    }));
  }).catch(() => list.replaceChildren(el('li', { class: 'setup-note', text: PT.noFriends })));
  return box;
}

export { confirmDialog, Modal };
