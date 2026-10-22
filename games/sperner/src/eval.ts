import { defineEval } from '@originals/game-sdk';
import {
  VOLATILITY,
  betShort,
  chances,
  decided,
  freshColours,
  geometry,
  nextVertex,
  paint,
  prizeFor,
  rowRest,
  startChance,
  type Bet,
  type Size,
} from './math';

// Each round colours a fresh board with the game's own reveal rules and
// samples a simulated player, so the eval covers many stopping rules at once.
// Every decision is "colour the next vertex" or "colour the rest of the row"
// (a burst), picked per player style: vertex by vertex, row by row, or a
// random mix. A burst stops early, like the game, once the bet is decided.
// Steps count decisions; the Bet itself colours the first vertex.
//   - random stop: cash out after a random number of decisions;
//   - risk threshold: cash out once the win chance falls below a random
//     fraction of the starting chance;
//   - lock-in: cash out once the win chance climbs above a random level;
//   - play to the end: never cash out.
export default defineEval<{ size: Size; bet: Bet }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (${p.size * p.size} triangles, ${betShort(p.bet)} rainbow${p.bet === 1 ? '' : 's'})`,
    params: p,
  })),
  playRound({ size: m, bet }, rng) {
    const g = geometry(m);
    const prize = prizeFor(m, bet);
    const p0 = startChance(m, bet);
    const style = rng.next();
    const plan = rng.next();
    const stopAfter = plan < 0.3 ? 1 + rng.int(g.order.length) : Infinity;
    const floor = plan >= 0.3 && plan < 0.5 ? p0 * (0.1 + 0.8 * rng.next()) : -1;
    const ceiling = plan >= 0.5 && plan < 0.65 ? p0 + (1 - p0) * (0.1 + 0.8 * rng.next()) : 2;

    let colours = freshColours(m);
    const colour = (v: number) => {
      const allowed = g.vertices[v].allowed;
      colours = paint(colours, v, allowed[rng.int(allowed.length)]);
      return chances(m, bet, colours);
    };

    let c = colour(nextVertex(m, colours)!);
    let steps = 1;
    for (;;) {
      const d = decided(c);
      if (d) return { multiplier: d === 'won' ? prize : 0, steps };
      if (steps >= stopAfter || c.p < floor || c.p > ceiling) return { multiplier: prize * c.p, steps };
      const burst = style < 0.4 ? false : style < 0.7 ? true : rng.next() < 0.5;
      const targets = burst ? rowRest(m, colours) : [nextVertex(m, colours)!];
      for (const v of targets) {
        c = colour(v);
        if (decided(c)) break;
      }
      steps++;
    }
  },
});
