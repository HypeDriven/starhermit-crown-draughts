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
    // The session config carries the opponent on its player entry, not as `ai`.
    const aiLevelId = config.ai ?? config.players.find((p) => p.kind === 'ai')?.aiLevel;
    if (!rec.completed) {
      rec.completed = true;
      rec.won = won;
      rec.score = over.breakdowns[primarySeat]?.total ?? 0;
      if (won) {
        s.dailyWins += 1;
        s.dailyStreak = s.lastDailyDate === prevDayKey(dateKey) ? s.dailyStreak + 1 : (s.lastDailyDate === dateKey ? s.dailyStreak : 1);
        if (s.dailyStreak > s.bestDailyStreak) s.bestDailyStreak = s.dailyStreak;
        const aiRating = AI_LEVELS[aiLevelId]?.rating ?? 1000;
        const d = eloDelta(profile.rating[config.ruleset] ?? 1000, aiRating, 1);
        profile.rating[config.ruleset] = (profile.rating[config.ruleset] ?? 1000) + d;
        out.ratingDelta = d;
      } else {
        s.dailyStreak = 0;
        const aiRating = AI_LEVELS[aiLevelId]?.rating ?? 1000;
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

/**
 * Merge two progress payloads after a cloud-save conflict (another device
 * saved since this one last loaded). Nothing earned on either side is lost:
 * completions and unlocks are unions, records keep the better value, counters
 * keep the larger one, and the daily streak follows the side that played the
 * later daily.
 */
export function mergeProgress(remote, local) {
  const a = remote && typeof remote === 'object' ? remote : {};
  const b = local && typeof local === 'object' ? local : {};
  const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  const arr = (x) => (Array.isArray(x) ? x : []);
  const union = (x, y) => [...new Set([...arr(x), ...arr(y)])];
  const max = (x, y) => Math.max(Number(x) || 0, Number(y) || 0);
  const out = { ...a, ...b };

  out.journey = {};
  for (const id of new Set([...Object.keys(obj(a.journey)), ...Object.keys(obj(b.journey))])) {
    const x = obj(a.journey)[id], y = obj(b.journey)[id];
    if (!x || !y) { out.journey[id] = { ...(x || y) }; continue; }
    const plies = [x.bestPlies, y.bestPlies].filter((v) => Number.isFinite(v));
    out.journey[id] = {
      completed: !!(x.completed || y.completed),
      stars: max(x.stars, y.stars),
      bestPlies: plies.length ? Math.min(...plies) : null,
      plays: max(x.plays, y.plays),
    };
  }

  out.challenges = {};
  for (const id of new Set([...Object.keys(obj(a.challenges)), ...Object.keys(obj(b.challenges))])) {
    const x = obj(a.challenges)[id], y = obj(b.challenges)[id];
    out.challenges[id] = !x || !y ? { ...(x || y) } : { completed: !!(x.completed || y.completed), bestScore: max(x.bestScore, y.bestScore) };
  }

  out.daily = {};
  const rank = (r) => (r ? (r.completed ? 2 : 1) + (r.won ? 1 : 0) : 0);
  for (const day of new Set([...Object.keys(obj(a.daily)), ...Object.keys(obj(b.daily))])) {
    const x = obj(a.daily)[day], y = obj(b.daily)[day];
    const best = !x ? y : !y ? x : rank(y) > rank(x) || (rank(y) === rank(x) && (y.score || 0) >= (x.score || 0)) ? y : x;
    out.daily[day] = { ...best, excluded: !!((x && x.excluded) || (y && y.excluded)) };
  }

  out.lessonsComplete = union(a.lessonsComplete, b.lessonsComplete);
  out.lessonsTotal = max(a.lessonsTotal, b.lessonsTotal);
  out.achievements = union(a.achievements, b.achievements);
  out.masteryClaimed = union(a.masteryClaimed, b.masteryClaimed).sort((m, n) => m - n);

  const sa = obj(a.stats), sb = obj(b.stats);
  out.stats = { ...sa, ...sb };
  for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
    if (typeof sa[k] === 'number' || typeof sb[k] === 'number') out.stats[k] = max(sa[k], sb[k]);
  }
  const la = sa.lastDailyDate || '', lb = sb.lastDailyDate || '';
  out.stats.lastDailyDate = (la > lb ? la : lb) || null;
  if (la !== lb) out.stats.dailyStreak = Number((la > lb ? sa : sb).dailyStreak) || 0;
  out.stats.bestDailyStreak = Math.max(out.stats.bestDailyStreak || 0, out.stats.dailyStreak || 0);
  return out;
}
