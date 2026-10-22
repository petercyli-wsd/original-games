import { defineEval, type Volatility } from '@originals/game-sdk';
import { ALL_SETTINGS, RTP, SHAPES, aimedCutChance, cutChance, direction, lineHits, offset, volatilityOf, winChance, winChanceAimed, type Setting } from './math';

// One config per volatility level. Each round picks one of the level's
// settings (shape, Hit or Miss, number of lines) at random, so between them
// the configs cover all 30 choices. The simulated player then samples a
// strategy: play every line, cash at a random checkpoint, cash when the win
// chance drops below a threshold, take profit above a target, or cash on a
// coin flip at each checkpoint. Lines are drawn from the raw process (a
// uniform direction and a uniform offset) and hit-tested against the shape.

const LEVELS: Volatility[] = ['low', 'medium', 'high', 'extreme'];

const byLevel = (level: Volatility) => ALL_SETTINGS.filter((s) => volatilityOf(winChance(s.shape, s.side, s.lines)) === level);

const pct = (p: number) => `${Math.round(p * 100)}%`;

function label(level: Volatility, settings: Setting[]) {
  const ps = settings.map((s) => winChance(s.shape, s.side, s.lines));
  return `${level} (${settings.length} settings, win ${pct(Math.min(...ps))}–${pct(Math.max(...ps))})`;
}

export default defineEval<{ settings: Setting[] }>({
  configs: LEVELS.map((level) => ({ label: label(level, byLevel(level)), params: { settings: byLevel(level) } })),
  playRound({ settings }, rng) {
    const { shape: id, side, lines } = settings[rng.int(settings.length)];
    const shape = SHAPES[id];
    const c = cutChance(shape);
    const prize = RTP / winChance(id, side, lines);

    const style = rng.next();
    const stopAt = 1 + rng.int(lines); // random-stop: cash at this checkpoint
    const floor = 0.05 + rng.next() * 0.5; // risk threshold: cash if P(win) falls below
    const target = 1.1 + rng.next() * 3; // take profit at this multiplier
    const shouldStop = (checkpoint: number, p: number) => {
      if (style < 0.3) return false; // play every line
      if (style < 0.55) return checkpoint >= stopAt;
      if (style < 0.75) return p < floor;
      if (style < 0.9) return prize * p >= target;
      return rng.next() < 0.3;
    };

    let steps = 0;
    for (let k = lines; k >= 1; k--) {
      const phi = direction(rng.next());
      steps++;
      const pWin = winChanceAimed(side, k, aimedCutChance(shape, phi), c);
      if (shouldStop(lines - k + 1, pWin)) return { multiplier: prize * pWin, steps };
      const at = offset(rng.next());
      steps++;
      if (lineHits(shape, phi, at)) return { multiplier: side === 'hit' ? prize : 0, steps };
    }
    return { multiplier: side === 'hit' ? 0 : prize, steps };
  },
});
