import { defineEval, type Rng } from '@originals/game-sdk';
import { RTP, mod, relock, startPrize, tick, winChance, winsAt, type Fuse, type SeatCount, type Side } from './math';

interface Params {
  n: SeatCount;
  fuse: Fuse;
  side: Side;
  seats: number;
  /** Only back seats at least this far round from the start (the far side). */
  minDist: number;
}

const dist = (s: number, n: number) => Math.min(s, n - s);

function samplePicks(n: number, count: number, minDist: number, rng: Rng): number[] {
  const pool = Array.from({ length: n }, (_, s) => s).filter((s) => dist(s, n) >= minDist);
  return rng.shuffle(pool).slice(0, count).sort((a, b) => a - b);
}

const TARGETS = [1.2, 1.5, 2, 3, 5, 10];

// One config per volatility level. Each round samples the seats and the
// player's habit: play to the end, stop after a few hops, the Auto rule
// "cash out at ×N", or bail out once the odds have fallen. Some players also
// switch seats or side at checkpoints (value kept, prize relocked).
export default defineEval<Params>({
  configs: [
    { label: 'low (6 seats, medium fuse, not on 2)', params: { n: 6, fuse: 'medium', side: 'off', seats: 2, minDist: 0 } },
    { label: 'medium (10 seats, medium fuse, on 2)', params: { n: 10, fuse: 'medium', side: 'on', seats: 2, minDist: 0 } },
    { label: 'high (12 seats, long fuse, on 1)', params: { n: 12, fuse: 'long', side: 'on', seats: 1, minDist: 0 } },
    { label: 'extreme (16 seats, short fuse, on 2 far seats)', params: { n: 16, fuse: 'short', side: 'on', seats: 2, minDist: 5 } },
  ],
  playRound({ n, fuse, side: side0, seats, minDist }, rng) {
    let picks = samplePicks(n, seats, minDist, rng);
    let side = side0;
    let prize = startPrize(n, fuse, picks, side);
    const habit = rng.next();
    const stopAfter = habit < 0.25 ? Infinity : habit < 0.55 ? 1 + rng.int(8) : Infinity;
    const target = habit >= 0.55 && habit < 0.75 ? TARGETS[rng.int(TARGETS.length)] : Infinity;
    const bail = habit >= 0.75 ? (0.2 + 0.6 * rng.next()) * RTP : 0;
    const switcher = rng.next() < 0.2;
    let x = 0;
    let steps = 0;
    for (;;) {
      const { dir, blows } = tick(rng.next, fuse);
      x = mod(x + dir, n);
      steps++;
      if (blows) return { multiplier: winsAt(x, picks, side) ? prize : 0, steps };
      const cash = prize * winChance(n, fuse, x, picks, side);
      if (steps >= stopAfter || cash >= target || cash < bail) return { multiplier: cash, steps };
      if (switcher && rng.next() < 0.3) {
        const np = samplePicks(n, 1 + rng.int(3), 0, rng);
        const ns: Side = rng.next() < 0.5 ? 'on' : 'off';
        const r = relock(cash, n, fuse, x, np, ns);
        if (r !== null) {
          picks = np;
          side = ns;
          prize = r;
        }
      }
    }
  },
});
