// Static achievement set. Keys are stable lowercase identifiers; unlock
// evaluation is pure and idempotent — the same progress document always
// produces the same set, and re-unlocking is a no-op.

export const ACHIEVEMENTS = [
  {
    key: 'first_completion',
    name: 'First Verdict',
    desc: 'Finish your first round of Crown Draughts, in any mode.',
    check: (p) => p.stats.roundsCompleted >= 1,
  },
  {
    key: 'mechanic_mastery',
    name: 'Every Rule in Hand',
    desc: 'Complete all lessons in Learn mode.',
    check: (p) => p.lessonsComplete.length >= p.lessonsTotal && p.lessonsTotal > 0,
  },
  {
    key: 'sustained_streak',
    name: 'Seven Sunrises',
    desc: 'Win the Daily challenge on five different days.',
    check: (p) => p.stats.dailyWins >= 5,
  },
  {
    key: 'difficult_milestone',
    name: 'Keeper of the Stone Crown',
    desc: 'Complete the final Journey mastery stage, "The Throne Walk".',
    check: (p) => !!p.journey['ch6-s8']?.completed,
  },
  {
    key: 'long_term_goal',
    name: 'A Hundred Evenings',
    desc: 'Play one hundred rounds. Any mode, any pace — the garden is patient.',
    check: (p) => p.stats.roundsCompleted >= 100,
  },
  // Flavor achievements (still stable, idempotent):
  {
    key: 'first_crown',
    name: 'Crowned',
    desc: 'Crown a piece for the first time.',
    check: (p) => p.stats.crownsMade >= 1,
  },
  {
    key: 'triple_chain',
    name: 'Threefold Step',
    desc: 'Take three or more pieces in a single chain jump.',
    check: (p) => p.stats.bestChain >= 3,
  },
  {
    key: 'master_beaten',
    name: 'The Master Bows',
    desc: 'Defeat the Master AI in Practice.',
    check: (p) => p.stats.masterWins >= 1,
  },
];

/** Evaluate progress → array of newly unlocked keys (idempotent). */
export function evaluateAchievements(progress) {
  const have = new Set(progress.achievements || []);
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (have.has(a.key)) continue;
    let ok = false;
    try { ok = !!a.check(progress); } catch { ok = false; }
    if (ok) fresh.push(a.key);
  }
  return fresh;
}

export function achievementByKey(key) {
  return ACHIEVEMENTS.find((a) => a.key === key) || null;
}
