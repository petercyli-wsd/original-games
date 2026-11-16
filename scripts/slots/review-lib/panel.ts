// A panel of blind slot players merged into one review: the median per score
// (the lower one for an even panel), every player's factual answers kept for
// the designer to grade, and the confusions pooled.

import type { PlayerReview } from './prompts/player';
import { lowerMedian, PLAYER_KEYS, type PlayerKey } from './scores';

export interface MergedPanel {
  players: number;
  /** Median per score. */
  scores: Record<PlayerKey, number>;
  /** Each score's panel values, e.g. { fun: [3, 4, 2] }. */
  spread: Record<PlayerKey, number[]>;
  /** The reasoning of the player whose score equals the median, per key. */
  reasoning: Record<PlayerKey, string>;
  /** Pooled confusions (at most 3 per player, deduplicated). */
  confusions: string[];
  /** Panel labels A, B, C... in alias order. */
  labels: string[];
}

export const panelLabel = (i: number) => String.fromCharCode(65 + i);

/** Validates one blind player's review; returns the problems (empty = valid). */
export function playerProblems(p: unknown): string[] {
  const r = p as Partial<PlayerReview> | null;
  if (!r || typeof r !== 'object') return ['not an object'];
  const out: string[] = [];
  for (const k of ['first_impression', 'session', 'checks', 'moments', 'keep_spinning', 'criteria', 'confusions'] as const) if (!(k in r)) out.push(`missing ${k}`);
  const keys = new Map((r.criteria ?? []).map((c) => [c.key, c.score]));
  for (const k of PLAYER_KEYS) {
    const s = keys.get(k);
    if (s === undefined) out.push(`criteria lacks ${k}`);
    else if (![1, 2, 3, 4, 5].includes(s)) out.push(`${k} score ${s} is not 1–5`);
  }
  return out;
}

export function mergePanel(players: PlayerReview[]): MergedPanel {
  if (!players.length) throw new Error('No player reviews to merge.');
  const scores = {} as Record<PlayerKey, number>;
  const spread = {} as Record<PlayerKey, number[]>;
  const reasoning = {} as Record<PlayerKey, string>;
  for (const k of PLAYER_KEYS) {
    const values = players.map((p) => p.criteria.find((c) => c.key === k)!.score);
    const m = lowerMedian(values);
    scores[k] = m;
    spread[k] = values;
    const from = players.findIndex((p) => p.criteria.find((c) => c.key === k)!.score === m);
    reasoning[k] = `${players[from].criteria.find((c) => c.key === k)!.reasoning}${players.length > 1 ? ` [Player ${panelLabel(from)}; panel: ${values.join(', ')}]` : ''}`;
  }
  return {
    players: players.length,
    scores,
    spread,
    reasoning,
    confusions: [...new Set(players.flatMap((p) => p.confusions.slice(0, 3)))],
    labels: players.map((_, i) => panelLabel(i)),
  };
}

/** The panel as the designer reads it: median scores, then each player's understanding and checks. */
export function panelText(players: PlayerReview[], merged: MergedPanel, shortfalls: string[][]): string {
  const scoreLines = PLAYER_KEYS.map((k) => `- ${k}: ${merged.scores[k]}${merged.players > 1 ? ` (panel: ${merged.spread[k].join(', ')})` : ''}. ${merged.reasoning[k]}`).join('\n');
  const each = players
    .map((p, i) => {
      const short = shortfalls[i]?.length ? `\n  Session shortfalls (from the play log): ${shortfalls[i].join('; ')}` : '';
      return `### Player ${panelLabel(i)}
- First impression: ${p.first_impression}
- Session: ${p.session.spins} spins; Turbo ${p.session.turbo ? 'yes' : 'no'}; Autoplay ${p.session.autoplay ? 'yes' : 'no'}; feature seen ${p.session.feature_seen ? 'yes' : 'no'}; paytable opened ${p.session.paytable_opened ? 'yes' : 'no'}. Balance: ${p.session.balance}${short}
- What pays most: ${p.checks.top_pay}
- How the feature triggers: ${p.checks.feature_trigger}
- What the wild does: ${p.checks.wild}
- Biggest win seen: ${p.checks.biggest_win}
- The feature: ${p.checks.feature_story}
- Best moment: ${p.moments.best}. Dullest: ${p.moments.dullest}
- Would keep spinning: ${p.keep_spinning.answer}. ${p.keep_spinning.why}
- Confusions: ${p.confusions.length ? p.confusions.join(' | ') : 'none'}`;
    })
    .join('\n\n');
  return `Panel of ${merged.players} blind player(s). Median scores (these are final; you do not re-score them):
${scoreLines}

${each}`;
}
