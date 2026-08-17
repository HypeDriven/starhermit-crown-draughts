import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalActions, apply } from '../js/rules/engine.js';
import { JOURNEY_STAGES, stageById, resolveStage, solveForcedWin } from '../js/content/journey.js';
import { CHALLENGES } from '../js/content/challenges.js';
import { LESSONS, lessonGoalMet } from '../js/content/lessons.js';
import { dailyDefinition } from '../js/content/daily.js';
import { contentSetup, starsForResult, stageUnlocked, journeyStats } from '../js/content/index.js';
import { validateResolved } from '../js/content/validate.js';
import { ACHIEVEMENTS, evaluateAchievements } from '../js/content/achievements.js';
import { THEMES, COSMETICS, MASTERY_TRACK, cosmeticsUnlockedAt } from '../js/content/themes.js';
import { BAKED } from '../js/content/baked.js';

test('content volume: 48 journey stages, 8 lessons, 10 challenges, 5 themes', () => {
  assert.equal(JOURNEY_STAGES.length, 48);
  assert.equal(LESSONS.length, 8);
  assert.equal(CHALLENGES.length, 10);
  assert.equal(Object.keys(THEMES).length, 5);
  assert.ok(COSMETICS.length >= 10);
  assert.ok(MASTERY_TRACK.length >= 8);
});

test('all journey ids and seeds are unique; chapters have 8 stages', () => {
  const ids = new Set(JOURNEY_STAGES.map((s) => s.id));
  assert.equal(ids.size, 48);
  const seeds = new Set(JOURNEY_STAGES.map((s) => s.seed));
  assert.equal(seeds.size, 48);
  for (let ch = 1; ch <= 6; ch++) {
    assert.equal(JOURNEY_STAGES.filter((s) => s.chapter === ch).length, 8);
  }
});

test('baked setups exist for every generated stage and are engine-legal', () => {
  for (const def of JOURNEY_STAGES) {
    if (def.setup === 'standard') continue;
    const setup = contentSetup(def);
    assert.ok(setup, `${def.id} has baked setup`);
    const st = createGame({ ruleset: def.ruleset, seed: def.seed, setup });
    assert.ok(legalActions(st).length > 0, `${def.id} side to move has actions`);
  }
  for (const def of CHALLENGES) {
    if (!def.setup || def.setup === 'standard') continue;
    const setup = contentSetup(def);
    assert.ok(setup, `challenge ${def.id} has baked setup`);
    createGame({ ruleset: def.ruleset, seed: def.seed, setup });
  }
});

test('baked setups match live regeneration (deterministic content)', () => {
  for (const id of ['ch2-s1', 'ch4-s4', 'ch6-s7', 'ch5-s5']) {
    const def = stageById(id);
    const baked = BAKED.journey[id];
    const live = resolveStage(def).setup;
    assert.deepEqual(live, baked, `${id} regenerates to the baked layout`);
  }
});

test('puzzle stages carry forced-win proofs with unique first moves', () => {
  for (const def of JOURNEY_STAGES) {
    if (!Number.isFinite(def.goal?.maxPlies)) continue;
    const baked = BAKED.journey[def.id];
    assert.ok(baked, `${def.id} baked`);
    const st = createGame({ ruleset: def.ruleset, seed: def.seed, setup: baked });
    const proof = solveForcedWin(st, def.goal.maxPlies);
    assert.ok(proof.win, `${def.id} is a forced win`);
    assert.equal(proof.solutions, 1, `${def.id} has a unique first move`);
  }
});

test('daily definitions are deterministic and vary across days', () => {
  const a1 = dailyDefinition('2026-01-15');
  const a2 = dailyDefinition('2026-01-15');
  assert.deepEqual(a1, a2, 'same day, same content');
  const b = dailyDefinition('2026-01-16');
  assert.notEqual(a1.seed, b.seed, 'different day, different seed');
  // daily games are legal and playable
  const st = createGame({ ruleset: a1.ruleset, seed: a1.seed });
  assert.ok(legalActions(st).length > 0);
  // a full week of dailies all construct legally
  for (let d = 1; d <= 7; d++) {
    const def = dailyDefinition(`2026-03-0${d}`);
    createGame({ ruleset: def.ruleset, seed: def.seed });
  }
});

test('lesson setups are legal and every action step is solvable', () => {
  for (const lesson of LESSONS) {
    for (const step of lesson.steps) {
      if (!step.setup) continue;
      const st = createGame({ ruleset: 'duel', seed: 1, setup: step.setup });
      const acts = legalActions(st);
      assert.ok(acts.length > 0, `${lesson.id} step has legal actions`);
      if (step.goal && ['any-move', 'capture', 'capture-crowned', 'crown'].includes(step.goal.kind)) {
        const meets = acts.filter((a) => lessonGoalMet(step.goal, a, st, st));
        assert.ok(meets.length > 0, `${lesson.id} goal is achievable immediately`);
      }
      if (step.allowPieces) {
        for (const [r, c] of step.allowPieces) {
          assert.ok(st.pieces.some((p) => p.r === r && p.c === c && !p.captured), `${lesson.id} allowPieces square has a piece`);
        }
      }
    }
  }
});

test('achievements: idempotent evaluation and stable lowercase keys', () => {
  const keys = ACHIEVEMENTS.map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of keys) assert.match(k, /^[a-z0-9_]+$/);
  const progress = {
    achievements: [], lessonsTotal: 8, lessonsComplete: ['a'],
    journey: {}, stats: { roundsCompleted: 0, dailyWins: 0, crownsMade: 0, bestChain: 0, masterWins: 0 },
  };
  assert.deepEqual(evaluateAchievements(progress), []);
  progress.stats.roundsCompleted = 1;
  const first = evaluateAchievements(progress);
  assert.deepEqual(first, ['first_completion']);
  progress.achievements.push('first_completion');
  assert.deepEqual(evaluateAchievements(progress), [], 're-evaluation is a no-op');
  progress.lessonsComplete = new Array(8).fill('x');
  progress.stats.dailyWins = 5;
  progress.journey['ch6-s8'] = { completed: true };
  progress.stats.roundsCompleted = 100;
  const rest = evaluateAchievements(progress);
  assert.ok(rest.includes('mechanic_mastery'));
  assert.ok(rest.includes('sustained_streak'));
  assert.ok(rest.includes('difficult_milestone'));
  assert.ok(rest.includes('long_term_goal'));
});

test('cosmetic unlocks are monotonic in stars', () => {
  const low = cosmeticsUnlockedAt(0);
  const high = cosmeticsUnlockedAt(200);
  assert.ok(low.length >= 5, 'base cosmetics available');
  assert.ok(high.length === COSMETICS.length);
  for (const id of low) assert.ok(high.includes(id));
});

test('journey unlock chain and stats', () => {
  const progress = { journey: {} };
  assert.ok(stageUnlocked(progress, stageById('ch1-s1')));
  assert.ok(!stageUnlocked(progress, stageById('ch1-s2')));
  progress.journey['ch1-s1'] = { completed: true, stars: 2 };
  assert.ok(stageUnlocked(progress, stageById('ch1-s2')));
  assert.ok(!stageUnlocked(progress, stageById('ch2-s1')));
  for (let i = 2; i <= 8; i++) progress.journey[`ch1-s${i}`] = { completed: true, stars: 3 };
  assert.ok(stageUnlocked(progress, stageById('ch2-s1')));
  const stats = journeyStats(progress);
  assert.equal(stats.completed, 8);
  assert.equal(stats.total, 48);
  assert.ok(stats.stars > 0);
});

test('starsForResult: completion / par / no-assists', () => {
  assert.equal(starsForResult({ won: false, plies: 5, par: 10, assistsUsed: false }), 0);
  assert.equal(starsForResult({ won: true, plies: 15, par: 10, assistsUsed: true }), 1);
  assert.equal(starsForResult({ won: true, plies: 9, par: 10, assistsUsed: true }), 2);
  assert.equal(starsForResult({ won: true, plies: 9, par: 10, assistsUsed: false }), 3);
});
