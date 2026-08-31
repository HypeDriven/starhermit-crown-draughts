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

// --- title -------------------------------------------------------------------

export function buildTitle(app, root) {
  const resume = app.pendingSnapshot();
  root.replaceChildren(
    el('div', { class: 'title-block' }, [
      el('h1', { class: 'game-title', text: 'Crown Draughts' }),
      el('p', { class: 'tagline', text: 'A carved stone board in a royal garden.' }),
    ]),
    el('nav', { class: 'title-actions', 'aria-label': 'Main menu' }, [
      resume ? button(`Resume round — ${resume.label}`, () => app.resumeSnapshot(), { kind: 'primary', class: 'btn btn-primary btn-xl' }) : null,
      button('Play', () => app.go('modes'), { kind: 'primary', class: 'btn btn-primary btn-xl' }),
      button(`Daily Court — ${todayShort()}`, () => app.startDaily()),
      button('Journey', () => app.go('journey')),
      button('Learn the rules', () => app.go('learn')),
    ].filter(Boolean)),
    el('div', { class: 'title-footer' }, [
      button('Profile', () => app.openProfile(), { kind: 'ghost' }),
      button('Settings', () => app.openSettings(), { kind: 'ghost' }),
      button('Help', () => app.openHelp(), { kind: 'ghost' }),
    ]),
  );
}

function todayShort() {
  return new Date().toISOString().slice(5, 10);
}

// --- mode select ----------------------------------------------------------------

const MODES = [
  { id: 'learn', name: 'Learn', desc: 'Interactive lessons — one rule at a time, hands on the stones.', time: '2–5 min each', players: 'Solo', ranked: false },
  { id: 'journey', name: 'Journey', desc: '48 authored stages across six garden courts.', time: '3–10 min each', players: 'Solo vs AI', ranked: false },
  { id: 'daily', name: 'Daily Court', desc: 'One shared seed and ruleset per UTC day. Ranked.', time: '~10 min', players: 'Solo vs AI', ranked: true },
  { id: 'practice', name: 'Practice', desc: 'Pick a ruleset and difficulty. Undo and hints allowed; never ranked.', time: '5–15 min', players: 'Solo vs AI', ranked: false },
  { id: 'challenge', name: 'Challenge', desc: 'Move limits, speed trials, altered layouts, restricted tools.', time: '2–15 min', players: 'Solo / local', ranked: false },
  { id: 'hosted', name: 'Hosted Play', desc: 'Private invite codes and public matches against other players.', time: '10–20 min', players: '2–4 online', ranked: true },
  { id: 'local', name: 'Pass & Play', desc: 'Two to four commanders, one device, including Royal Melee.', time: '10–25 min', players: '2–4 local', ranked: false },
];

export function buildModes(app, root) {
  const grid = el('div', { class: 'mode-grid' });
  for (const m of MODES) {
    const card = el('button', {
      type: 'button', class: 'mode-card',
      onclick: () => app.openMode(m.id),
    }, [
      el('h3', { text: m.name }),
      el('p', { text: m.desc }),
      el('p', { class: 'mode-meta', text: `${m.players} · ${m.time} · ${m.ranked ? 'ranked' : 'unranked'}` }),
    ]);
    grid.appendChild(card);
  }
  root.replaceChildren(
    el('h2', { text: 'Choose your court' }),
    grid,
    button('Back', () => app.go('title'), { kind: 'ghost' }),
  );
}

// --- mode setups ------------------------------------------------------------------

export function buildPracticeSetup(app, root) {
  const state = { ruleset: 'duel', level: 'apprentice', side: 0, theme: app.settings.theme };
  const form = el('div', { class: 'setup-form' });
  form.appendChild(el('h2', { text: 'Practice' }));
  form.appendChild(radioGroup('Ruleset', Object.values(RULESETS).filter((r) => r.playerCount === 2).map((r) => ({
    value: r.id, label: r.name, desc: r.description,
  })), state.ruleset, (v) => { state.ruleset = v; }));
  form.appendChild(radioGroup('Opponent', Object.values(AI_LEVELS).map((l) => ({
    value: l.id, label: `${l.name} (${l.rating})`, desc: l.blurb,
  })), state.level, (v) => { state.level = v; }));
  form.appendChild(radioGroup('Your house', [
    { value: 0, label: 'Ivory (moves first)', desc: '' },
    { value: 1, label: 'Onyx', desc: '' },
  ], state.side, (v) => { state.side = v; }));
  form.appendChild(el('p', { class: 'setup-note', text: 'Undo and hints are allowed. Practice never touches your rating.' }));
  form.appendChild(el('div', { class: 'setup-actions' }, [
    button('Back', () => app.go('modes'), { kind: 'ghost' }),
    button('Take your seat', () => app.startPractice(state), { kind: 'primary' }),
  ]));
  root.replaceChildren(form);
}

export function buildLocalSetup(app, root) {
  const state = { ruleset: 'duel', names: ['Ivory', 'Onyx', 'Jade', 'Ember'], count: 2 };
  const form = el('div', { class: 'setup-form' });
  form.appendChild(el('h2', { text: 'Pass & Play' }));
  const nameWrap = el('div', { class: 'name-fields' });
  const renderNames = () => {
    nameWrap.replaceChildren();
    const cap = RULESETS[state.ruleset].playerCount;
    const n = state.ruleset === 'melee' ? state.count : 2;
    for (let i = 0; i < n; i++) {
      const input = el('input', {
        type: 'text', value: state.names[i], maxlength: '18', class: 'text-input',
        'aria-label': `Player ${i + 1} name`,
      });
      input.addEventListener('input', () => { state.names[i] = input.value; });
      nameWrap.appendChild(el('label', { class: 'field' }, [el('span', { text: `House ${i + 1} (${['Ivory', 'Jade', 'Onyx', 'Ember'][i] || ''})` }), input]));
    }
  };
  form.appendChild(radioGroup('Ruleset', [
    { value: 'duel', label: RULESETS.duel.name, desc: RULESETS.duel.description },
    { value: 'grand', label: RULESETS.grand.name, desc: RULESETS.grand.description },
    { value: 'melee', label: RULESETS.melee.name, desc: RULESETS.melee.description },
  ], state.ruleset, (v) => { state.ruleset = v; if (state.count > RULESETS[v].playerCount) state.count = RULESETS[v].playerCount; renderNames(); }));
  form.appendChild(nameWrap);
  const meleeCount = el('div', { class: 'melee-count' });
  const renderCount = () => {
    meleeCount.replaceChildren();
    if (state.ruleset !== 'melee') return;
    meleeCount.appendChild(radioGroup('Commanders', [2, 3, 4].map((n) => ({
      value: n, label: `${n} commanders`, desc: n < 4 ? 'Each extra house is passed around the table.' : '',
    })), state.count, (v) => { state.count = v; renderNames(); }));
  };
  renderNames();
  renderCount();
  form.appendChild(meleeCount);
  form.appendChild(el('div', { class: 'setup-actions' }, [
    button('Back', () => app.go('modes'), { kind: 'ghost' }),
    button('Begin', () => app.startLocal(state), { kind: 'primary' }),
  ]));
  root.replaceChildren(form);
}

function radioGroup(name, options, current, onChange) {
  const fieldset = el('fieldset', { class: 'radio-group' });
  fieldset.appendChild(el('legend', { text: name }));
  for (const opt of options) {
    const id = `rg-${name}-${opt.value}`.replace(/\W+/g, '-');
    const input = el('input', { type: 'radio', name, id, value: String(opt.value) });
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
  wrap.appendChild(el('h2', { text: 'Journey' }));
  wrap.appendChild(el('p', { class: 'journey-progress', text: `${stats.completed} of ${stats.total} stages · ${stats.stars} of ${stats.maxStars} stars` }));
  const next = nextMilestone(stats.stars);
  if (next) {
    wrap.appendChild(el('p', { class: 'journey-next', text: `Next mastery reward at ${next.stars} stars: ${next.label}` }));
  }
  for (const ch of JOURNEY_CHAPTERS) {
    const section = el('section', { class: 'chapter' });
    section.appendChild(el('h3', { text: `${ch.id.toUpperCase()} — ${ch.name}` }));
    section.appendChild(el('p', { class: 'chapter-blurb', text: ch.blurb }));
    const grid = el('div', { class: 'stage-grid' });
    for (const s of JOURNEY_STAGES.filter((x) => x.chapter === Number(ch.id.slice(2)))) {
      const rec = progress.journey[s.id];
      const unlocked = stageUnlocked(progress, s);
      const cell = el('button', {
        type: 'button',
        class: `stage-cell${rec?.completed ? ' done' : ''}${unlocked ? '' : ' locked'}${s.mastery ? ' mastery' : ''}`,
        disabled: !unlocked,
        'aria-label': `${s.name}${rec?.completed ? `, completed with ${rec.stars} stars` : unlocked ? ', available' : ', locked'}`,
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
  wrap.appendChild(button('Back', () => app.go('modes'), { kind: 'ghost' }));
  root.replaceChildren(wrap);
}

export function buildStageSetup(app, root, stage) {
  const ruleset = RULESETS[stage.ruleset];
  root.replaceChildren(el('div', { class: 'setup-form' }, [
    el('h2', { text: stage.name }),
    el('p', { class: 'chapter-blurb', text: `${JOURNEY_CHAPTERS[stage.chapter - 1].name} · Stage ${stage.index}${stage.mastery ? ' · Mastery trial' : ''}` }),
    stage.blurb ? el('p', { text: stage.blurb }) : null,
    el('dl', { class: 'setup-facts' }, [
      el('dt', { text: 'Court' }), el('dd', { text: `${ruleset.name} (${ruleset.size}×${ruleset.size})` }),
      el('dt', { text: 'Opponent' }), el('dd', { text: AI_LEVELS[stage.ai]?.name || 'None' }),
      el('dt', { text: 'Goal' }), el('dd', { text: goalText(stage.goal) }),
      el('dt', { text: 'Par' }), el('dd', { text: `${stage.par} plies` }),
      el('dt', { text: 'Ranked' }), el('dd', { text: 'No' }),
    ]),
    el('div', { class: 'setup-actions' }, [
      button('Back', () => app.go('journey'), { kind: 'ghost' }),
      button('Play stage', () => app.startJourneyStage(stage), { kind: 'primary' }),
    ]),
  ].filter(Boolean)));
}

export function goalText(goal) {
  if (!goal) return 'Win the round.';
  const parts = ['Win'];
  if (goal.maxPlies) parts.push(`within ${goal.maxPlies} plies`);
  if (Number.isFinite(goal.maxLost)) parts.push(`losing at most ${goal.maxLost} pieces`);
  if (goal.minPiecesLeft) parts.push(`with at least ${goal.minPiecesLeft} pieces left`);
  return parts.join(' ') + '.';
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
        el('span', { class: 'lesson-title', text: lesson.title }),
        el('span', { class: 'lesson-intro', text: lesson.intro }),
        el('span', { class: 'lesson-meta', text: `${lesson.minutes} min${isDone ? ' · complete ✓' : ''}` }),
      ]),
    ]));
  }
  root.replaceChildren(
    el('h2', { text: 'Learn the court' }),
    el('p', { text: 'Each lesson teaches one rule and asks you to play it. Lessons use the same legal-move engine as every other mode.' }),
    list,
    button('Back', () => app.go('modes'), { kind: 'ghost' }),
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
      el('h3', { text: c.name }),
      el('p', { text: c.desc }),
      el('p', { class: 'mode-meta', text: `${constraintSummary(c)}${rec?.completed ? ` · best ${rec.bestScore}` : ''}` }),
    ]));
  }
  root.replaceChildren(
    el('h2', { text: 'Challenges' }),
    list,
    button('Back', () => app.go('modes'), { kind: 'ghost' }),
  );
}

export function buildChallengeSetup(app, root, c) {
  root.replaceChildren(el('div', { class: 'setup-form' }, [
    el('h2', { text: c.name }),
    el('p', { text: c.desc }),
    el('dl', { class: 'setup-facts' }, [
      el('dt', { text: 'Court' }), el('dd', { text: RULESETS[c.ruleset].name }),
      el('dt', { text: 'Opponent' }), el('dd', { text: c.ai ? AI_LEVELS[c.ai].name : 'Local players' }),
      el('dt', { text: 'Constraints' }), el('dd', { text: constraintSummary(c) }),
      el('dt', { text: 'Ranked' }), el('dd', { text: 'No' }),
    ]),
    el('div', { class: 'setup-actions' }, [
      button('Back', () => app.go('challenges'), { kind: 'ghost' }),
      button('Begin challenge', () => app.startChallenge(c), { kind: 'primary' }),
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
    el('h2', { text: def.name }),
    el('p', { text: 'One seed and ruleset per UTC day — the same for every player. Ranked.' }),
    el('dl', { class: 'setup-facts' }, [
      el('dt', { text: 'Court' }), el('dd', { text: RULESETS[def.ruleset].name }),
      el('dt', { text: 'Opponent' }), el('dd', { text: AI_LEVELS[def.ai].name }),
      el('dt', { text: 'Goal' }), el('dd', { text: goalText(def.goal) }),
      el('dt', { text: 'Today' }), el('dd', { text: rec?.completed ? (rec.won ? `Won — score ${rec.score}` : 'Played') : 'Not yet played' }),
      el('dt', { text: 'Next court in' }), el('dd', { text: `${Math.floor(countdown / 3600000)}h ${Math.floor((countdown % 3600000) / 60000)}m` }),
      el('dt', { text: 'Streak' }), el('dd', { text: `${app.progress.stats.dailyStreak} day(s)` }),
    ]),
    excluded ? el('p', { class: 'setup-note warn', text: 'This day was marked defective and is excluded from ranking.' }) : null,
    buildDailyHistory(app),
    el('div', { class: 'setup-actions' }, [
      button('Back', () => app.go('title'), { kind: 'ghost' }),
      button(rec?.completed ? 'Play again (unranked)' : 'Play the Daily', () => app.startDaily(), { kind: 'primary' }),
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
  list.appendChild(el('h3', { text: 'Your recent dailies' }));
  for (const [date, rec] of entries) {
    list.appendChild(el('p', { class: 'daily-row', text: `${date} — ${rec.won ? 'won' : 'played'}, score ${rec.score}${rec.excluded ? ' (excluded from ranking)' : ''}` }));
  }
  return list;
}

// --- profile -------------------------------------------------------------------------

export function buildProfile(app, modal) {
  const p = app.profile;
  const s = app.progress.stats;
  const stats = journeyStats(app.progress);
  const box = modal.box;
  box.appendChild(el('h2', { text: 'Profile' }));
  const nameInput = el('input', { type: 'text', value: p.name, maxlength: '24', class: 'text-input', 'aria-label': 'Display name' });
  nameInput.addEventListener('change', () => {
    p.name = nameInput.value.trim() || 'Guest Gardener';
    app.saveProfile();
    audio.settingsSaved();
    app.ui.toast('Name saved.');
  });
  box.appendChild(el('label', { class: 'field' }, [el('span', { text: 'Display name' }), nameInput]));
  const colors = ['#d4af37', '#7fb2e0', '#4a8a68', '#b05038', '#9a5fd0', '#e8e0c0'];
  const swatches = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Avatar color' });
  for (const c of colors) {
    const sw = el('button', {
      type: 'button', class: `swatch${p.avatar.color === c ? ' active' : ''}`,
      style: `background:${c}`, 'aria-label': `Color ${c}`, 'aria-pressed': p.avatar.color === c,
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
    el('dt', { text: 'Rating (duel / grand)' }),
    el('dd', { text: `${p.rating.duel} / ${p.rating.grand}` }),
    el('dt', { text: 'Rounds played' }), el('dd', { text: String(s.roundsCompleted) }),
    el('dt', { text: 'Wins' }), el('dd', { text: String(s.wins) }),
    el('dt', { text: 'Daily wins' }), el('dd', { text: `${s.dailyWins} (best streak ${s.bestDailyStreak})` }),
    el('dt', { text: 'Journey' }), el('dd', { text: `${stats.completed}/${stats.total} stages, ${stats.stars} stars` }),
    el('dt', { text: 'Longest chain' }), el('dd', { text: String(s.bestChain) }),
  ]));
  // achievements
  const have = new Set(app.progress.achievements);
  const ach = el('div', { class: 'ach-grid' });
  for (const a of ACHIEVEMENTS) {
    ach.appendChild(el('div', { class: `ach-card${have.has(a.key) ? ' unlocked' : ''}`, title: a.desc }, [
      el('strong', { text: a.name }),
      el('span', { text: have.has(a.key) ? a.desc : '???' }),
    ]));
  }
  box.appendChild(el('h3', { text: 'Achievements' }));
  box.appendChild(ach);
  // mastery track
  const track = el('ol', { class: 'mastery-track' });
  for (const m of MASTERY_TRACK) {
    const claimed = stats.stars >= m.stars;
    track.appendChild(el('li', { class: claimed ? 'claimed' : '' }, [
      el('span', { text: `${m.stars}★` }),
      el('span', { text: m.label }),
      el('span', { text: claimed ? '✓' : '' }),
    ]));
  }
  box.appendChild(el('h3', { text: 'Mastery track' }));
  box.appendChild(track);
  // cosmetics
  box.appendChild(el('h3', { text: 'Cosmetics' }));
  box.appendChild(buildCosmetics(app));
}

function buildCosmetics(app) {
  const wrap = el('div', { class: 'cosmetics' });
  const stats = journeyStats(app.progress);
  const slots = ['material', 'trail', 'surround', 'flourish'];
  for (const slot of slots) {
    const sel = el('select', { class: 'select', 'aria-label': slot });
    for (const c of COSMETICS.filter((x) => x.slot === slot)) {
      const locked = stats.stars < c.unlockStars;
      const opt = el('option', { value: c.id, text: `${c.name}${locked ? ` (unlock at ${c.unlockStars}★)` : ''}` });
      opt.disabled = locked;
      if (app.settings.cosmetics[slot] === c.id) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      app.settings.cosmetics[slot] = sel.value;
      app.saveSettings();
      app.ui.toast('Cosmetic applied.');
    });
    wrap.appendChild(el('label', { class: 'field' }, [el('span', { text: slot[0].toUpperCase() + slot.slice(1) }), sel]));
  }
  return wrap;
}

// --- results ---------------------------------------------------------------------------

export function buildResults(app, root, { over, config, outcome }) {
  const me = outcome.mySeat;
  const myBreak = over.breakdowns[me];
  const wrap = el('div', { class: 'results' });
  const goalMissed = over.goalMet === false && over.winner !== null && outcome.iWon;
  const headline = goalMissed ? 'Goal Missed'
    : over.winner === null ? 'A Truce'
    : (outcome.iWon ? 'Victory' : (outcome.localMultiplayer ? `${over.winnerName || 'A house'} wins` : 'Defeat'));
  wrap.appendChild(el('h2', { class: `result-headline ${goalMissed ? 'loss' : over.winner === null ? 'draw' : outcome.iWon ? 'win' : 'loss'}`, text: headline }));
  wrap.appendChild(el('p', { class: 'result-reason', text: over.reasonText }));
  // score breakdown — components, never one unexplained total
  const table = el('table', { class: 'breakdown' });
  table.appendChild(el('caption', { text: 'Score breakdown' }));
  const rows = [
    ['Captures', myBreak.components.captures],
    ['Crowns taken', myBreak.components.crowns],
    ['Pieces preserved', myBreak.components.survival],
    ['Objective', myBreak.components.objective],
    ['Efficiency', myBreak.components.efficiency],
    ['Speed', myBreak.components.timeBonus],
    ['Slips', myBreak.components.penalties],
  ];
  for (const [label, val] of rows) {
    table.appendChild(el('tr', {}, [
      el('th', { scope: 'row', text: label }),
      el('td', { text: val > 0 ? `+${val}` : String(val), class: val < 0 ? 'neg' : '' }),
    ]));
  }
  table.appendChild(el('tr', { class: 'total' }, [el('th', { scope: 'row', text: 'Total' }), el('td', { text: String(myBreak.total) })]));
  wrap.appendChild(table);
  const facts = [`${over.plies} plies`];
  if (Number.isFinite(over.elapsedMs)) facts.push(`${(over.elapsedMs / 1000).toFixed(0)}s`);
  if (outcome.stars) facts.push(`${'★'.repeat(outcome.stars)} earned`);
  if (outcome.ratingDelta) facts.push(`rating ${outcome.ratingDelta > 0 ? '+' : ''}${outcome.ratingDelta}`);
  if (over.assistsUsed) facts.push('assists used');
  wrap.appendChild(el('p', { class: 'result-facts', text: facts.join(' · ') }));
  if (outcome.unlocked?.length) {
    const list = el('div', { class: 'unlock-list' });
    for (const key of outcome.unlocked) {
      const a = ACHIEVEMENTS.find((x) => x.key === key);
      if (a) list.appendChild(el('p', { class: 'unlock', text: `Achievement: ${a.name} — ${a.desc}` }));
    }
    for (const m of outcome.mastery || []) {
      list.appendChild(el('p', { class: 'unlock', text: `Mastery reward: ${m.label}` }));
    }
    wrap.appendChild(list);
  }
  const actions = el('div', { class: 'setup-actions' });
  if (outcome.nextAction) {
    actions.appendChild(button(outcome.nextAction.label, outcome.nextAction.fn, { kind: 'primary' }));
  }
  actions.appendChild(button('Play again', () => app.retryLast()));
  actions.appendChild(button('Leave', () => app.exitToTitle(), { kind: 'ghost' }));
  wrap.appendChild(actions);
  root.replaceChildren(wrap);
}

// --- help --------------------------------------------------------------------------------

export function buildHelp(app, modal) {
  const box = modal.box;
  box.appendChild(el('h2', { text: 'How the court works' }));
  const cards = [
    { title: 'Moving', body: 'Pieces step one square diagonally forward along the dark squares. Tap a piece to see where it may go; glowing squares are legal destinations.' },
    { title: 'Capturing', body: 'Jump over an adjacent enemy piece onto the empty square beyond to capture it. Captures are mandatory — if one exists, the court refuses quiet moves.' },
    { title: 'Chains', body: 'After a jump, if the same piece can jump again, it must. Chains end when no jump remains. Long chains are the soul of the game.' },
    { title: 'Crowning', body: 'A piece that reaches the far edge is crowned. Crowns move and capture in all four diagonal directions. Crowning ends the turn immediately.' },
    { title: 'Winning', body: 'Capture every enemy piece, or leave the enemy with no legal move. Draws come from threefold repetition, long capture-less stretches, or agreement.' },
    { title: 'Royal Melee', body: 'Four houses on a wide court, each advancing from its own edge. Last house standing takes the garden.' },
  ];
  const grid = el('div', { class: 'help-grid' });
  for (const c of cards) {
    grid.appendChild(el('article', { class: 'help-card' }, [el('h3', { text: c.title }), el('p', { text: c.body })]));
  }
  box.appendChild(grid);
  // controls from current bindings
  box.appendChild(el('h3', { text: 'Controls' }));
  const table = el('table', { class: 'controls-table' });
  for (const a of ACTIONS) {
    table.appendChild(el('tr', {}, [
      el('th', { scope: 'row', text: a.label }),
      el('td', { text: app.input.bindingText(a.id) || '—' }),
    ]));
  }
  box.appendChild(table);
  box.appendChild(el('p', { class: 'setup-note', text: 'Gamepad: d-pad or left stick moves the cursor, A confirms, B cancels, Start pauses. Rebind everything in Settings → Controls.' }));
}

// --- settings ------------------------------------------------------------------------------

export function buildSettings(app, modal) {
  const box = modal.box;
  const s = app.settings;
  box.appendChild(el('h2', { text: 'Settings' }));
  const tabs = el('div', { class: 'settings-tabs', role: 'tablist' });
  const panels = el('div', { class: 'settings-panels' });
  const defs = [
    ['audio', 'Audio', () => settingsAudio(app)],
    ['graphics', 'Graphics', () => settingsGraphics(app)],
    ['controls', 'Controls', () => settingsControls(app)],
    ['access', 'Accessibility', () => settingsAccess(app)],
    ['privacy', 'Privacy', () => settingsPrivacy(app)],
  ];
  let first = true;
  for (const [id, label, builder] of defs) {
    const tab = el('button', { type: 'button', role: 'tab', class: `tab${first ? ' active' : ''}`, text: label, 'aria-selected': first });
    tab.addEventListener('click', () => {
      audio.tabSwitch();
      tabs.querySelectorAll('.tab').forEach((t) => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      panels.replaceChildren(builder());
    });
    tabs.appendChild(tab);
    if (first) { panels.replaceChildren(builder()); first = false; }
  }
  box.appendChild(tabs);
  box.appendChild(panels);
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
  wrap.appendChild(sliderRow('Music', s.music, (v) => { s.music = v; app.applyAudioSettings(); }));
  wrap.appendChild(sliderRow('Effects', s.effects, (v) => { s.effects = v; app.applyAudioSettings(); }));
  wrap.appendChild(sliderRow('Ambience', s.ambience, (v) => { s.ambience = v; app.applyAudioSettings(); }));
  wrap.appendChild(sliderRow('Voice cues', s.voice, (v) => { s.voice = v; app.applyAudioSettings(); }));
  wrap.appendChild(toggleRow('Mute all', s.muted, (v) => { s.muted = v; app.applyAudioSettings(); }));
  wrap.appendChild(toggleRow('Spoken turn announcements', s.voiceCues, (v) => { s.voiceCues = v; app.applyAudioSettings(); }, 'Uses your device speech voice.'));
  return wrap;
}

function settingsGraphics(app) {
  const s = app.settings.graphics;
  const wrap = el('div', {});
  const tiers = [['auto', 'Auto (recommended)'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
  const sel = el('select', { class: 'select', 'aria-label': 'Quality tier' });
  for (const [v, label] of tiers) {
    const o = el('option', { value: v, text: label });
    if (s.tier === v) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => { s.tier = sel.value; app.applyGraphicsSettings(); });
  wrap.appendChild(el('label', { class: 'field' }, [el('span', { text: 'Quality tier' }), sel]));
  const cam = el('select', { class: 'select', 'aria-label': 'Camera' });
  for (const [v, label] of [['classic', 'Classic'], ['low', 'Low (near the stone)'], ['top', 'Top-down']]) {
    const o = el('option', { value: v, text: label });
    if (app.settings.camera.preset === v) o.selected = true;
    cam.appendChild(o);
  }
  cam.addEventListener('change', () => { app.settings.camera.preset = cam.value; app.saveSettings(); app.renderer.setCameraPreset(cam.value); });
  wrap.appendChild(el('label', { class: 'field' }, [el('span', { text: 'Camera' }), cam]));
  const theme = el('select', { class: 'select', 'aria-label': 'Theme' });
  for (const t of Object.values(THEMES)) {
    const o = el('option', { value: t.id, text: t.name });
    if (app.settings.theme === t.id) o.selected = true;
    theme.appendChild(o);
  }
  theme.addEventListener('change', () => {
    app.settings.theme = theme.value;
    app.saveSettings();
    app.applyTheme();
  });
  wrap.appendChild(el('label', { class: 'field' }, [el('span', { text: 'Garden theme' }), theme]));
  return wrap;
}

function settingsControls(app) {
  const wrap = el('div', {});
  wrap.appendChild(el('p', { class: 'setup-note', text: 'Select an action, then press the new key or gamepad button.' }));
  const table = el('table', { class: 'controls-table' });
  for (const a of ACTIONS) {
    const keyBtn = button(app.input.bindingText(a.id) || '—', async () => {
      keyBtn.textContent = 'press a key…';
      const code = await app.input.recordNext(a.id, 'keyboard');
      app.settings.bindings = app.settings.bindings || {};
      app.settings.bindings[a.id] = [code];
      app.input.applyOverrides(app.settings.bindings);
      app.saveSettings();
      keyBtn.textContent = app.input.bindingText(a.id);
    }, { kind: 'ghost' });
    const padBtn = button((app.input.gamepad[a.id] || []).map((b) => `B${b}`).join('/') || '—', async () => {
      padBtn.textContent = 'press a button…';
      const idx = await app.input.recordNext(a.id, 'gamepad');
      app.settings.gamepad = app.settings.gamepad || {};
      app.settings.gamepad[a.id] = [idx];
      app.input.applyGamepadOverrides(app.settings.gamepad);
      app.saveSettings();
      padBtn.textContent = `B${idx}`;
    }, { kind: 'ghost' });
    table.appendChild(el('tr', {}, [el('th', { scope: 'row', text: a.label }), el('td', {}, [keyBtn]), el('td', {}, [padBtn])]));
  }
  wrap.appendChild(table);
  wrap.appendChild(button('Reset to defaults', () => {
    app.settings.bindings = null;
    app.settings.gamepad = null;
    app.input.keyboard = structuredClone(DEFAULT_KEYBOARD);
    app.input.gamepad = structuredClone(DEFAULT_GAMEPAD);
    app.saveSettings();
    app.ui.toast('Bindings reset to defaults.');
  }, { kind: 'ghost' }));
  return wrap;
}

function settingsAccess(app) {
  const a = app.settings.accessibility;
  const wrap = el('div', {});
  wrap.appendChild(toggleRow('Reduced motion', a.reducedMotion, (v) => { a.reducedMotion = v; app.applyAccessSettings(); }, 'No camera swoops, shake, or dense particles.'));
  wrap.appendChild(toggleRow('High contrast', a.highContrast, (v) => { a.highContrast = v; app.applyAccessSettings(); }));
  wrap.appendChild(toggleRow('Larger text', a.largeText, (v) => { a.largeText = v; app.applyAccessSettings(); }));
  wrap.appendChild(toggleRow('Left-handed controls', a.leftHanded, (v) => { a.leftHanded = v; app.applyAccessSettings(); }, 'Moves the action tray to the left.'));
  wrap.appendChild(toggleRow('Always show HTML board', a.domBoard, (v) => { a.domBoard = v; app.applyAccessSettings(); }, 'A fully playable semantic board beside the 3D scene.'));
  wrap.appendChild(toggleRow('Timing assistance', a.timingAssist, (v) => { a.timingAssist = v; app.saveSettings(); }, 'Clocks run at half speed for you in solo play.'));
  wrap.appendChild(toggleRow('Haptics', a.haptics, (v) => { a.haptics = v; app.saveSettings(); }));
  const pal = el('select', { class: 'select', 'aria-label': 'Color palette' });
  for (const [v, label] of [['default', 'Default palette'], ['deuteranopia', 'Deuteranopia-safe'], ['protanopia', 'Protanopia-safe'], ['tritanopia', 'Tritanopia-safe']]) {
    const o = el('option', { value: v, text: label });
    if (a.colorPalette === v) o.selected = true;
    pal.appendChild(o);
  }
  pal.addEventListener('change', () => { a.colorPalette = pal.value; app.applyAccessSettings(); });
  wrap.appendChild(el('label', { class: 'field' }, [el('span', { text: 'Color-vision palette' }), pal]));
  wrap.appendChild(button('Replay tutorial lessons', () => app.go('learn'), { kind: 'ghost' }));
  return wrap;
}

function settingsPrivacy(app) {
  const wrap = el('div', {});
  const consent = app.settings.telemetryConsent === true;
  wrap.appendChild(toggleRow('Anonymous usage stats', consent, (v) => {
    app.settings.telemetryConsent = v;
    app.platform.setTelemetryConsent(v);
    app.saveSettings();
  }, 'Only funnel events: start, tutorial step, round end, retry, settings change, error. Never text or pointers.'));
  wrap.appendChild(el('p', { class: 'setup-note', text: 'Progress is stored on this device and, when signed in through the host, synced as a versioned cloud save. No credentials or chat content are ever placed in saves.' }));
  return wrap;
}

// --- lobby ------------------------------------------------------------------------------------

export function buildLobby(app, root) {
  const wrap = el('div', { class: 'setup-form' });
  wrap.appendChild(el('h2', { text: 'Hosted play' }));
  if (!app.platform.online) {
    wrap.appendChild(el('p', { class: 'setup-note warn', text: 'Hosted play needs a connection to a game host. You are playing standalone, so only Pass & Play is available.' }));
    wrap.appendChild(el('div', { class: 'setup-actions' }, [
      button('Back', () => app.go('modes'), { kind: 'ghost' }),
      button('Pass & Play instead', () => app.openMode('local'), { kind: 'primary' }),
    ]));
    root.replaceChildren(wrap);
    return;
  }
  const state = { ruleset: 'duel', listed: false, joinCode: '', clock: false };
  wrap.appendChild(el('h3', { text: 'Host a table' }));
  wrap.appendChild(radioGroup('Ruleset', Object.values(RULESETS).map((r) => ({ value: r.id, label: `${r.name} (${r.playersLabel})`, desc: r.description })), state.ruleset, (v) => { state.ruleset = v; }));
  wrap.appendChild(toggleRow('List publicly (open matching)', false, (v) => { state.listed = v; }));
  wrap.appendChild(toggleRow('90-second turn deadline', false, (v) => { state.clock = v; }));
  const hostRow = el('div', { class: 'setup-actions' }, [
    button('Create table', async () => {
      await app.hostTable(state);
    }, { kind: 'primary' }),
  ]);
  wrap.appendChild(hostRow);
  wrap.appendChild(el('h3', { text: 'Join with a code' }));
  const codeInput = el('input', { type: 'text', class: 'text-input code-input', maxlength: '6', placeholder: 'ABC123', 'aria-label': 'Join code' });
  codeInput.addEventListener('input', () => { state.joinCode = codeInput.value.toUpperCase(); });
  wrap.appendChild(el('div', { class: 'join-row' }, [codeInput, button('Join', () => app.joinByCode(state.joinCode))]));
  wrap.appendChild(el('h3', { text: 'Open tables' }));
  const listWrap = el('div', { class: 'open-tables' });
  wrap.appendChild(listWrap);
  wrap.appendChild(button('Refresh list', () => app.refreshOpenTables(listWrap), { kind: 'ghost' }));
  wrap.appendChild(el('div', { class: 'setup-actions' }, [button('Back', () => app.go('modes'), { kind: 'ghost' })]));
  root.replaceChildren(wrap);
  app.refreshOpenTables(listWrap);
}

export function buildTableRoom(app, root, client) {
  const wrap = el('div', { class: 'setup-form' });
  wrap.appendChild(el('h2', { text: 'Your table' }));
  const codeEl = el('p', { class: 'join-code', text: `Join code: ${client.joinCode || '—'}` });
  wrap.appendChild(codeEl);
  const roster = el('ul', { class: 'roster' });
  wrap.appendChild(roster);
  const update = () => {
    roster.replaceChildren();
    for (const p of client.players) {
      roster.appendChild(el('li', { text: `${p.name} ${p.connected ? '' : '(away)'} — rating ${p.rating}` }));
    }
  };
  update();
  client.on('players', update);
  const isHost = client.seat === 0;
  const startBtn = button('Start the round', async () => {
    const res = await client.startGame();
    if (!res.ok) app.ui.toast(res.error || 'Could not start', 'warn');
  }, { kind: 'primary' });
  startBtn.disabled = !isHost;
  if (!isHost) startBtn.textContent = 'Waiting for the host…';
  wrap.appendChild(startBtn);
  // voice is an explicit opt-in and only when the host platform supports it
  const voiceNote = el('p', { class: 'setup-note', text: app.platform.mode === 'hosted'
    ? 'Voice rooms are available from the host shell once everyone joins. Voice is never required to play.'
    : 'Voice rooms need a hosting platform; this table is voice-free. Chat works once the round starts.' });
  wrap.appendChild(voiceNote);
  wrap.appendChild(button('Leave table', () => app.leaveHosted(), { kind: 'ghost' }));
  root.replaceChildren(wrap);
}

export { confirmDialog, Modal };
