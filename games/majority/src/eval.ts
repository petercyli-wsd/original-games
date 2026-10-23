import { defineEval } from '@originals/game-sdk';
import { LINES, MAPS, SIDES, callRegion, decided, emptyCalls, relock, startPrize, winChance, type Bet, type MapKey } from './math';

interface Params {
  map: MapKey;
  bet: Bet;
}

const TARGETS = [1.2, 1.5, 2, 3, 5, 10, 20];

// One config per volatility level. Each round samples the player's habit:
// play to the end, stop after a few calls, the Auto rule "cash out at ×N", or
// bail out once the cash-out has fallen. Some players also switch side or
// line at checkpoints (value kept, prize relocked).
export default defineEval<Params>({
  configs: [
    { label: 'low (Heartland, Blue majority)', params: { map: 'heartland', bet: { side: 'blue', line: 51 } } },
    { label: 'medium (Toss-up, Red majority)', params: { map: 'tossup', bet: { side: 'red', line: 51 } } },
    { label: 'high (Toss-up, Blue landslide)', params: { map: 'tossup', bet: { side: 'blue', line: 65 } } },
    { label: 'extreme (Heartland, Red landslide)', params: { map: 'heartland', bet: { side: 'red', line: 65 } } },
  ],
  playRound({ map, bet: bet0 }, rng) {
    const m = MAPS[map];
    const calls = emptyCalls(m);
    const order = rng.shuffle(m.regions.map((_, i) => i));
    let bet = bet0;
    let prize = startPrize(map, bet);
    const habit = rng.next();
    const stopAfter = habit < 0.3 ? Infinity : habit < 0.55 ? 1 + rng.int(10) : Infinity;
    const target = habit >= 0.55 && habit < 0.8 ? TARGETS[rng.int(TARGETS.length)] : Infinity;
    const bail = habit >= 0.8 ? (0.15 + 0.6 * rng.next()) * prize * winChance(m, calls, bet) : 0;
    const switcher = rng.next() < 0.1;
    let steps = 0;
    for (const j of order) {
      calls[j] = callRegion(rng.next(), m.regions[j].p);
      steps++;
      const dec = decided(m, calls, bet);
      if (dec) return { multiplier: dec === 'win' ? prize : 0, steps };
      const cash = prize * winChance(m, calls, bet);
      if (steps >= stopAfter || cash >= target || cash < bail) return { multiplier: cash, steps };
      if (switcher && rng.next() < 0.25) {
        const nb: Bet = { side: SIDES[rng.int(2)], line: LINES[rng.int(2)] };
        // Switchers move between bets they still rate (15%+), not onto long shots.
        const r = winChance(m, calls, nb) >= 0.15 ? relock(cash, m, calls, nb) : null;
        if (r !== null) {
          bet = nb;
          prize = r;
        }
      }
    }
    // Unreachable: once every region is called the bet is decided.
    throw new Error('round did not resolve');
  },
});
