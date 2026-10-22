import { defineEval } from '@originals/game-sdk';
import {
  VOLATILITY,
  bestOther,
  canOpen,
  cashValue,
  closedDoors,
  hostPick,
  lockedPrize,
  newState,
  openDoor,
  openingsFor,
  otherDoor,
  switchTo,
  winChance,
  type DoorCount,
  type Plan,
} from './math';

// Each round samples a player:
// - when to stop: play to the reveal, cash out at a random checkpoint, or a
//   risk rule (cash out once your door's chance is below a floor, or once the
//   cash-out has grown past a target);
// - mid-round choices: never switch, chase the brightest door now and then,
//   or switch to random closed doors now and then;
// - at the final two: the plan (stay or switch) applies.
export default defineEval<{ doors: DoorCount; plan: Plan }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (${p.doors} doors, ${p.plan})`, params: p })),
  playRound({ doors, plan }, rng) {
    const prizeDoor = rng.int(doors);
    let s = newState(doors, rng.int(doors));

    const u = rng.next();
    const stopAt = u < 0.25 ? 1 + rng.int(openingsFor(doors)) : Infinity;
    const riskRule = u >= 0.25 && u < 0.4;
    const floor = 0.02 + rng.next() * 0.3;
    const target = 1.1 + rng.next() * 3;

    const v = rng.next();
    const style = v < 0.6 ? 'hold' : v < 0.8 ? 'favourite' : 'random';
    const switchRate = 0.1 + rng.next() * 0.3;

    for (let steps = 1; ; steps++) {
      s = openDoor(s, hostPick(s, prizeDoor, rng));
      const last = !canOpen(s);

      if (last) {
        if (plan === 'switch') s = switchTo(s, otherDoor(s));
      } else if (style === 'favourite' && rng.next() < switchRate) {
        const b = bestOther(s);
        if (b !== null) s = switchTo(s, b);
      } else if (style === 'random' && rng.next() < switchRate) {
        const others = closedDoors(s).filter((d) => d !== s.held);
        s = switchTo(s, others[rng.int(others.length)]);
      }

      if (steps === stopAt || (riskRule && (winChance(s) < floor || cashValue(s) > target))) return { multiplier: cashValue(s), steps };
      if (last) return { multiplier: s.held === prizeDoor ? lockedPrize(s) : 0, steps: steps + 1 };
    }
  },
});
