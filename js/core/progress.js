// Progression: folds a finished round into the progress document — journey
// stars, daily streaks, challenge records, stats, achievements, mastery,
// rating. Pure functions over plain data; storage handles persistence.

import { evaluateAchievements } from '../content/achievements.js';
import { starsForResult, journeyStats } from '../content/index.js';
import { MASTERY_TRACK } from '../content/themes.js';
import { AI_LEVELS } from '../rules/ai.js';
import { eloDelta } from '../rules/engine.js';

/**
 * config: the session config. over: session.over. stats: engine playerStats.
 * Returns { unlocked: [], mastery: [], ratingDelta, stars, recordBroken }.
 */
export function applyRoundResult(progress, profile, config, over, engineStats) {
  const out = { unlocked: [], mastery: [], ratingDelta: 0, stars: 0, recordBroken: false };
  const humanSeats = config.players
    .map((p, i) => ({ ...p, seat: i }))
    .filter((p) => p.kind === 'human');
  const primarySeat = humanSeats[0]?.seat ?? 0;
  const won = over.winner === primarySeat;
  const draw = over.winner === null;
  const s = progress.stats;

  s.roundsCompleted += 1;
  if (won) s.wins += 1;
  if (draw) s.draws += 1;
  const myStats = engineStats?.[primarySeat];
  if (myStats) {
    s.crownsMade += myStats.crownsMade;
    if (myStats.bestChain > s.bestChain) s.bestChain = myStats.bestChain;
  }

  // Journey
  if (config.mode === 'journey' && config.contentId) {
    const rec = progress.journey[config.contentId] || { completed: false, stars: 0, bestPlies: null, plays: 0 };
    rec.plays += 1;
    if (over.goalMet !== false && won) {
      rec.completed = true;
      const stars = starsForResult({ won: true, plies: over.plies, par: config.par ?? 999, assistsUsed: over.assistsUsed });
      if (stars > rec.stars) rec.stars = stars;
      if (rec.bestPlies === null || over.plies < rec.bestPlies) rec.bestPlies = over.plies;
      out.stars = stars;
    }
    progress.journey[config.contentId] = rec;
  }

  // Daily (ranked): streaks + rating
  if (config.mode === 'daily' && config.contentId) {
    const dateKey = config.contentId.replace('daily-', '');
    const rec = progress.daily[dateKey] || { completed: false, won: false, score: 0, excluded: false };
    if (!rec.completed) {
      rec.completed = true;
      rec.won = won;
      rec.score = over.breakdowns[primarySeat]?.total ?? 0;
      if (won) {
        s.dailyWins += 1;
        s.dailyStreak = s.lastDailyDate === prevDayKey(dateKey) ? s.dailyStreak + 1 : (s.lastDailyDate === dateKey ? s.dailyStreak : 1);
        if (s.dailyStreak > s.bestDailyStreak) s.bestDailyStreak = s.dailyStreak;
        const aiRating = AI_LEVELS[config.ai]?.rating ?? 1000;
        const d = eloDelta(profile.rating[config.ruleset] ?? 1000, aiRating, 1);
        profile.rating[config.ruleset] = (profile.rating[config.ruleset] ?? 1000) + d;
        out.ratingDelta = d;
      } else {
        s.dailyStreak = 0;
        const aiRating = AI_LEVELS[config.ai]?.rating ?? 1000;
        const d = eloDelta(profile.rating[config.ruleset] ?? 1000, aiRating, draw ? 0.5 : 0);
        profile.rating[config.ruleset] = (profile.rating[config.ruleset] ?? 1000) + d;
        out.ratingDelta = d;
      }
      s.lastDailyDate = dateKey;
    }
    progress.daily[dateKey] = rec;
  }

  // Challenges
  if (config.mode === 'challenge' && config.contentId) {
    const rec = progress.challenges[config.contentId] || { completed: false, bestScore: 0 };
    if (won && over.goalMet !== false) {
      rec.completed = true;
      const score = over.breakdowns[primarySeat]?.total ?? 0;
      if (score > rec.bestScore) { rec.bestScore = score; out.recordBroken = true; }
    }
    progress.challenges[config.contentId] = rec;
  }

  // Practice master wins (achievement)
  if (config.mode === 'practice' && won) {
    const opp = config.players.find((p) => p.kind === 'ai');
    if (opp?.aiLevel === 'master') s.masterWins += 1;
  }

  // Mastery track (journey stars)
  const { stars } = journeyStats(progress);
  for (const m of MASTERY_TRACK) {
    if (stars >= m.stars && !progress.masteryClaimed.includes(m.stars)) {
      progress.masteryClaimed.push(m.stars);
      out.mastery.push(m);
    }
  }

  // Achievements (idempotent)
  const fresh = evaluateAchievements(progress);
  progress.achievements.push(...fresh);
  out.unlocked = fresh;
  return out;
}

function prevDayKey(key) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
