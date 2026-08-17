// Challenge mode: constrained goals — move limits, speed targets, altered
// layouts, restricted tools. All constraints are enforced by the session,
// which reads them from this data (never hard-coded per challenge).

export const CHALLENGES = [
  {
    id: 'sprint-crown', name: 'Sprint Crown', chapter: 'speed',
    desc: 'Win a full game in 48 plies or fewer against the Novice.',
    ruleset: 'duel', seed: 51001, setup: 'standard',
    goal: { kind: 'win', maxPlies: 48 }, par: 40,
    constraints: {}, ai: 'novice', theme: 'tide-terrace',
  },
  {
    id: 'blitz-garden', name: 'Blitz Garden', chapter: 'speed',
    desc: 'Ninety seconds on each clock. Beat the Apprentice before your time wilts.',
    ruleset: 'duel', seed: 51002, setup: 'standard',
    goal: { kind: 'win' }, par: 70,
    constraints: { clockMs: 90000 }, ai: 'apprentice', theme: 'royal-garden',
  },
  {
    id: 'surgical-strike', name: 'Surgical Strike', chapter: 'puzzle',
    desc: 'One exact line wins in five plies. Find it.',
    ruleset: 'duel', seed: 451003, setup: { w: [3, 0], b: [4, 0], capture: true },
    goal: { kind: 'win', maxPlies: 5 }, par: 5,
    constraints: { noUndo: true, noHints: true }, ai: 'apprentice', theme: 'dusk-conservatory',
  },
  {
    id: 'thin-ice', name: 'Thin Ice', chapter: 'nerve',
    desc: 'Face the Adept with no undo and no hints. Every step is final.',
    ruleset: 'duel', seed: 51004, setup: 'standard',
    goal: { kind: 'win' }, par: 70,
    constraints: { noUndo: true, noHints: true }, ai: 'adept', theme: 'frost-arbor',
  },
  {
    id: 'cornered', name: 'Cornered', chapter: 'material',
    desc: 'You start two pieces down against the Apprentice. Win anyway.',
    ruleset: 'duel', seed: 51005, setup: { w: [4, 0], b: [6, 0] },
    goal: { kind: 'win' }, par: 40,
    constraints: {}, ai: 'apprentice', theme: 'ember-court',
  },
  {
    id: 'kings-trial', name: 'Trial of Crowns', chapter: 'endgame',
    desc: 'An endgame of crowns alone against the Adept. Precision decides it.',
    ruleset: 'duel', seed: 51006, setup: { w: [2, 2], b: [2, 2] },
    goal: { kind: 'win' }, par: 40,
    constraints: {}, ai: 'adept', theme: 'royal-garden',
  },
  {
    id: 'royal-rumble', name: 'Royal Rumble', chapter: 'melee',
    desc: 'Four houses, one court. Local play for 2–4 commanders — last house standing.',
    ruleset: 'melee', seed: 51007, setup: 'standard',
    goal: { kind: 'win' }, par: 120,
    constraints: { localMultiplayer: true }, ai: null, theme: 'ember-court',
  },
  {
    id: 'perfection', name: 'Perfection', chapter: 'nerve',
    desc: 'Beat the Apprentice losing no more than two of your pieces.',
    ruleset: 'duel', seed: 51008, setup: 'standard',
    goal: { kind: 'win', maxLost: 2 }, par: 70,
    constraints: {}, ai: 'apprentice', theme: 'tide-terrace',
  },
  {
    id: 'the-long-game', name: 'The Long Game', chapter: 'endgame',
    desc: 'The grand court against the Adept. Twenty pieces a side; no shortcuts.',
    ruleset: 'grand', seed: 51009, setup: 'standard',
    goal: { kind: 'win' }, par: 140,
    constraints: {}, ai: 'adept', theme: 'dusk-conservatory',
  },
  {
    id: 'master-trial', name: 'Master Trial', chapter: 'nerve',
    desc: 'The Master, unassisted. The hardest seat in the garden.',
    ruleset: 'duel', seed: 51010, setup: 'standard',
    goal: { kind: 'win' }, par: 80,
    constraints: { noUndo: true, noHints: true }, ai: 'master', theme: 'frost-arbor',
  },
];

export function challengeById(id) {
  return CHALLENGES.find((c) => c.id === id) || null;
}

/** Human-readable constraint summary for the setup screen. */
export function constraintSummary(c) {
  const out = [];
  if (c.goal?.maxPlies) out.push(`win within ${c.goal.maxPlies} plies`);
  if (Number.isFinite(c.goal?.maxLost)) out.push(`lose at most ${c.goal.maxLost} pieces`);
  if (c.constraints?.clockMs) out.push(`${Math.round(c.constraints.clockMs / 1000)}s clock each`);
  if (c.constraints?.noUndo) out.push('no undo');
  if (c.constraints?.noHints) out.push('no hints');
  if (c.constraints?.localMultiplayer) out.push('2–4 local players');
  return out.length ? out.join(' · ') : 'no special constraints';
}
