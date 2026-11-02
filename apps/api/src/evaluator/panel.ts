// A panel of blind players: several independent plays of the same game merged
// into one review, so one lucky or confused run can't move a game's score.
// Scores take the median (the lower one for an even panel), the factual checks
// take a majority vote with ties going to the stricter answer, and the prose
// comes from the run whose scores sit closest to the medians.

import type { PlayerOutput } from './service.js';

/** Stricter answers last: a tie goes to the answer that caps more. */
const OUTCOME_ORDER = ['direct', 'pattern', 'hidden'];
const ODDS_ORDER = ['see_why', 'trust', 'unclear'];

const lowerMedian = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];

function vote(values: string[], order: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = Math.max(...counts.values());
  return [...counts].filter(([, n]) => n === top).sort((a, b) => order.indexOf(b[0]) - order.indexOf(a[0]))[0][0];
}

export function mergePlayers(players: PlayerOutput[]): PlayerOutput {
  if (players.length === 1) return players[0];
  if (!players.length) throw new Error('No player reviews to merge.');
  const keys = players[0].criteria.map((c) => c.key);
  const median = new Map(keys.map((k) => [k, lowerMedian(players.map((p) => p.criteria.find((c) => c.key === k)?.score ?? 1))]));
  // The run closest to the panel's medians speaks for the panel.
  const distance = (p: PlayerOutput) => p.criteria.reduce((s, c) => s + Math.abs(c.score - (median.get(c.key) ?? c.score)), 0);
  const voice = [...players].sort((a, b) => distance(a) - distance(b))[0];
  const checks = players.map((p) => p.checks).filter((c): c is NonNullable<PlayerOutput['checks']> => !!c);
  return {
    ...voice,
    criteria: keys.map((key) => {
      const score = median.get(key)!;
      const from = players.map((p) => p.criteria.find((c) => c.key === key)!).find((c) => c.score === score)!;
      return { key, score, reasoning: `${from.reasoning} [Panel of ${players.length}: ${players.map((p) => p.criteria.find((c) => c.key === key)?.score).join(', ')}]` };
    }),
    checks: checks.length
      ? {
          outcome: vote(checks.map((c) => c.outcome), OUTCOME_ORDER),
          known_casino_game: checks.filter((c) => c.known_casino_game).length * 2 > checks.length,
          odds_source: vote(checks.map((c) => c.odds_source), ODDS_ORDER),
          reasoning: voice.checks?.reasoning ?? checks[0].reasoning,
        }
      : undefined,
    confusions: [...new Set(players.flatMap((p) => p.confusions.slice(0, 2)))],
  };
}
