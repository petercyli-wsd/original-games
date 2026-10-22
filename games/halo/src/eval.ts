import { defineEval } from '@originals/game-sdk';
import { CENTRE, VOLATILITY, cashOut, leg, prize, release, ringRadii, startChance, winChance, type Pt, type Rings } from './math';

// Each round samples one simulated player, using the game's own walk:
//  - plays every ring, then releases from the last one;
//  - stops at a random ring, then cashes out or releases there;
//  - cashes out once the chance climbs past a target or sinks below a floor;
//  - or picks Drift / Release / Cash out at random at every checkpoint.
// Every leg and the release is one step.
export default defineEval<{ arc: number; rings: Rings }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (${p.arc}° arc, ${p.rings} rings)`, params: p })),
  playRound({ arc, rings }, rng) {
    const radii = ringRadii(rings);
    const p0 = startChance(arc);
    const style = rng.next();

    let stopAt = radii.length;
    let atStop: 'cash' | 'release' = 'release';
    let high = Infinity;
    let low = -1;
    const randomChoices = style >= 0.75;
    if (style >= 0.25 && style < 0.5) {
      stopAt = 1 + rng.int(Math.max(1, radii.length));
      atStop = rng.next() < 0.5 ? 'cash' : 'release';
    } else if (style >= 0.5 && style < 0.75) {
      high = Math.min(0.97, p0 * (1.5 + 3 * rng.next()));
      low = p0 * (0.1 + 0.5 * rng.next());
    }

    let z: Pt = CENTRE;
    let steps = 0;
    for (let k = 0; k < radii.length; k++) {
      const path = leg(z, radii[k], rng.next);
      z = path[path.length - 1];
      steps++;
      const w = winChance(z, arc);
      let action: 'drift' | 'cash' | 'release' = 'drift';
      if (randomChoices) {
        const r = rng.next();
        action = r < 0.2 ? 'cash' : r < 0.35 ? 'release' : 'drift';
      } else if (w >= high || w <= low) action = 'cash';
      else if (k + 1 >= stopAt) action = atStop;
      if (action === 'cash') return { multiplier: cashOut(z, arc), steps };
      if (action === 'release') break;
    }

    const { win } = release(z, arc, rng.next());
    return { multiplier: win ? prize(arc) : 0, steps: steps + 1 };
  },
});
