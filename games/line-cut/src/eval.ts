import { defineEval, type Volatility } from '@originals/game-sdk';
import { RTP, SHAPES, SHAPE_IDS, aimedCutChance, direction, lineHits, offset, volatilityOf, winChance, type ShapeId } from './math';

// One config per volatility level. Each round picks one of the level's shapes
// at random, so between them the configs cover all five. The simulated player
// then samples a strategy at the one checkpoint (the line aimed, its shadow
// shown): always drop the line, always cash out, cash out when the shadow is
// narrower than a threshold, cash out when the cash-out beats a target, or a
// coin flip. Lines are drawn from the raw process (a uniform direction and a
// uniform offset) and hit-tested against the shape.

const LEVELS: Volatility[] = ['low', 'medium', 'high', 'extreme'];

const byLevel = (level: Volatility) => SHAPE_IDS.filter((id) => volatilityOf(winChance(id)) === level);

const pct = (p: number) => `${Math.round(p * 100)}%`;

const label = (level: Volatility, shapes: ShapeId[]) => `${level} (${shapes.map((id) => `${id} ${pct(winChance(id))}`).join(', ')})`;

export default defineEval<{ shapes: ShapeId[] }>({
  configs: LEVELS.map((level) => ({ label: label(level, byLevel(level)), params: { shapes: byLevel(level) } })),
  playRound({ shapes }, rng) {
    const id = shapes[rng.int(shapes.length)];
    const shape = SHAPES[id];
    const prize = RTP / winChance(id);

    const style = rng.next();
    const floor = rng.next() * winChance(id) * 1.5; // cash if the shadow is narrower than this
    const target = 0.5 + rng.next() * 1.5; // take profit at this multiplier

    // Stage 1: the direction. The checkpoint's win chance is the shadow share.
    const phi = direction(rng.next());
    const s = aimedCutChance(shape, phi);
    const stop =
      style < 0.35 ? false : style < 0.5 ? true : style < 0.7 ? s < floor : style < 0.85 ? prize * s >= target : rng.next() < 0.5;
    if (stop) return { multiplier: prize * s, steps: 1 };

    // Stage 2: the offset. The line lands and cuts or misses.
    return { multiplier: lineHits(shape, phi, offset(rng.next())) ? prize : 0, steps: 2 };
  },
});
