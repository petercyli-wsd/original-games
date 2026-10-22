import { defineEval, type Rng } from '@originals/game-sdk';
import {
  AUTO_PICKS,
  RTP,
  SKIP_RULES,
  afterWin,
  autoRound,
  available,
  chance,
  drawCard,
  likelier,
  mainPair,
  maxWinReached,
  wins,
  withinCap,
  type Card,
  type Guess,
} from './math';

// One config per volatility level. Volatility in HiLo is how far the player
// pushes, so each level sets the cash-out targets / streak lengths players
// aim for. Every round samples one of the strategies players actually use:
//   - Auto, "cash out at ×T" with a random call rule and skip rule;
//   - Auto, "cash out after n correct calls";
//   - Manual with a plan: n calls (random sides, sometimes the long shot,
//     sometimes Red / Black / Same), random skips, then cash out;
//   - Manual risk threshold: keep calling the likelier side while it is at
//     least θ likely, skip the rest a few times, else cash out.
// Every strategy also takes profit at the level's top target (a stopping
// rule, so still exactly 99%), which keeps the sampled tails measurable.
// The RTP is exact for every one of them (see math.ts); the mix checks it.

interface Level {
  label: string;
  /** Cash-out targets, log-uniform in [lo, hi]. */
  target: [number, number];
  /** Correct calls before cashing out, uniform in [lo, hi]. */
  streak: [number, number];
}

const LEVELS: Level[] = [
  { label: 'low (cash out ×1.1–2)', target: [1.1, 2], streak: [1, 3] },
  { label: 'medium (×2–10)', target: [2, 10], streak: [3, 8] },
  { label: 'high (×10–100)', target: [10, 100], streak: [8, 18] },
  { label: 'extreme (×100–2,000)', target: [100, 2000], streak: [15, 30] },
];

const logUniform = (rng: Rng, [lo, hi]: [number, number]) => Math.exp(Math.log(lo) + rng.next() * (Math.log(hi) - Math.log(lo)));
const uniformInt = (rng: Rng, [lo, hi]: [number, number]) => lo + rng.int(hi - lo + 1);

/** A manual round: `decide` returns a call, 'skip' or 'cash' (only offered after a correct call). */
function manual(rng: Rng, decide: (card: Card, cash: number, won: number) => Guess | 'skip' | 'cash') {
  let card = drawCard(rng);
  let cash = RTP;
  let won = 0;
  let steps = 0;
  for (;;) {
    let a = decide(card, cash, won);
    if (a === 'cash' && won === 0) a = likelier(card.rank);
    if (a === 'cash') return { multiplier: cash, steps };
    steps++;
    if (a === 'skip') {
      card = drawCard(rng);
      continue;
    }
    // A call over the cap isn't offered; the player takes the likelier side or cashes.
    if (!withinCap(cash, a, card.rank)) {
      a = likelier(card.rank);
      if (!withinCap(cash, a, card.rank)) return { multiplier: cash, steps };
    }
    const next = drawCard(rng);
    if (!wins(a, card, next)) return { multiplier: 0, steps };
    cash = afterWin(cash, a, card.rank);
    won++;
    card = next;
    if (maxWinReached(cash)) return { multiplier: cash, steps };
  }
}

export default defineEval<Level>({
  configs: LEVELS.map((level) => ({ label: level.label, params: level })),
  playRound(level, rng) {
    const s = rng.next();

    if (s < 0.45) {
      const stop = s < 0.3 ? { kind: 'target' as const, value: logUniform(rng, level.target) } : { kind: 'streak' as const, value: uniformInt(rng, level.streak) };
      const start = rng.next() < 0.2 ? { rank: 1 + rng.int(13), suit: 0 } : null;
      const r = autoRound(
        { pick: AUTO_PICKS[rng.int(AUTO_PICKS.length)], skip: SKIP_RULES[rng.int(SKIP_RULES.length)], stop, start, limit: level.target[1] },
        rng,
      );
      return { multiplier: r.multiplier, steps: r.frames.length - 1 };
    }

    if (s < 0.75) {
      // A plan: n calls, then cash out. Mostly the likelier side, sometimes either side or an extended call.
      const n = uniformInt(rng, level.streak);
      const longShot = rng.next() < 0.15;
      const extended = rng.next() < 0.3;
      let skips = 0;
      return manual(rng, (card, cash, won) => {
        if (won >= n || cash >= level.target[1]) return 'cash';
        if (skips < 3 && rng.next() < 0.1) {
          skips++;
          return 'skip';
        }
        if (extended && rng.next() < 0.3) {
          const extra: Guess[] = ['red', 'black', 'same'];
          const g = extra[rng.int(3)];
          if (available(g, card.rank, 'extended')) return g;
        }
        const [up, down] = mainPair(card.rank);
        if (longShot) return rng.next() < 0.5 ? up : down;
        return likelier(card.rank);
      });
    }

    // Risk threshold: call the likelier side while it is at least θ; skip a bad card a few times; stop at a target.
    const theta = 0.55 + 0.35 * rng.next();
    const target = logUniform(rng, level.target);
    let skips = 0;
    return manual(rng, (card, cash, won) => {
      if (won > 0 && cash >= target) return 'cash';
      const g = likelier(card.rank);
      if (chance(g, card.rank) >= theta) return g;
      if (skips < 4) {
        skips++;
        return 'skip';
      }
      return won > 0 ? 'cash' : g;
    });
  },
});
