import { defineEval, type Rng } from '@originals/game-sdk';
import { CALL_KEYS, SPOTS, addCall, addNeighbours, addTo, spin, type Layout, type SpotKind } from './math';

// Every bet on the table returns exactly 36/37, so no config needs its own rtp.
// Each config samples the layouts a real player builds at that volatility:
// even-money and dozen/column hedges, a random mix of anything (racetrack
// calls and neighbours included), single inside bets, and straight-ups.

type Style = 'outside' | 'mixed' | 'inside' | 'straight';

const pick = <T>(rng: Rng, xs: readonly T[]) => xs[Math.min(xs.length - 1, Math.floor(rng.next() * xs.length))];
const chips = (rng: Rng) => 1 + Math.floor(rng.next() * 5);
const ofKind = (...kinds: SpotKind[]) => SPOTS.filter((s) => kinds.includes(s.kind));

const EVEN_MONEY = ofKind('red', 'black', 'odd', 'even', 'low', 'high');
const COLUMNS = ofKind('column');
const DOZENS = ofKind('dozen');
const INSIDE = ofKind('split', 'street', 'trio', 'corner', 'basket', 'line');
const STRAIGHTS = ofKind('straight');

function sample(style: Style, rng: Rng): Layout {
  let layout: Layout = {};
  switch (style) {
    case 'outside': {
      const r = rng.next();
      if (r < 0.55) layout = addTo(layout, pick(rng, EVEN_MONEY).id, chips(rng));
      else {
        // Two of the three columns or dozens: covers 24 numbers.
        const group = r < 0.78 ? COLUMNS : DOZENS;
        const skip = Math.floor(rng.next() * 3);
        const c = chips(rng);
        group.forEach((s, i) => i !== skip && (layout = addTo(layout, s.id, c)));
      }
      return layout;
    }
    case 'mixed': {
      const n = 1 + Math.floor(rng.next() * 5);
      for (let i = 0; i < n; i++) layout = addTo(layout, pick(rng, SPOTS).id, chips(rng));
      if (rng.next() < 0.25) layout = addCall(layout, pick(rng, CALL_KEYS), 1);
      if (rng.next() < 0.15) layout = addNeighbours(layout, pick(rng, STRAIGHTS).nums[0], Math.floor(rng.next() * 5), 1);
      return layout;
    }
    case 'inside':
      return addTo(layout, pick(rng, INSIDE).id, chips(rng));
    case 'straight': {
      layout = addTo(layout, pick(rng, STRAIGHTS).id, chips(rng));
      if (rng.next() < 0.25) layout = addTo(layout, pick(rng, STRAIGHTS).id, chips(rng));
      return layout;
    }
  }
}

export default defineEval<{ style: Style }>({
  configs: [
    { label: 'low (even money, two columns / dozens)', params: { style: 'outside' } },
    { label: 'medium (random mix, calls, neighbours)', params: { style: 'mixed' } },
    { label: 'high (one split / street / corner / line)', params: { style: 'inside' } },
    { label: 'extreme (straight-ups)', params: { style: 'straight' } },
  ],
  playRound({ style }, rng) {
    return { multiplier: spin(sample(style, rng), rng.next()).multiplier, steps: 1 };
  },
});
