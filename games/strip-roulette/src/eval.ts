import { defineEval, type Rng } from '@originals/game-sdk';
import { BET_KEYS, EMPTY_LAYOUT, STRIPS, spin, type BetKey, type Layout, type StripSize } from './math';

// Every bet on every strip returns exactly 99%, so no config needs its own rtp.
// Each config samples a family of layouts a real player would place, from the
// safe red/black hedge to a lone green on the 55-slot strip.

type Style = 'colour' | 'mixed' | 'long-shot' | 'marathon';
interface Params {
  style: Style;
}

const pick = <T>(rng: Rng, xs: readonly T[]) => xs[Math.min(xs.length - 1, Math.floor(rng.next() * xs.length))];
const chips = (rng: Rng) => 1 + Math.floor(rng.next() * 5);

function sample(style: Style, rng: Rng): { layout: Layout; n: StripSize } {
  const layout: Layout = { ...EMPTY_LAYOUT };
  switch (style) {
    case 'colour': {
      // One colour (most rounds) or a red + black hedge, on the classic strip.
      if (rng.next() < 0.8) layout[pick(rng, ['red', 'black'] as BetKey[])] = chips(rng);
      else {
        layout.red = chips(rng);
        layout.black = chips(rng);
      }
      return { layout, n: 15 };
    }
    case 'mixed': {
      // Any strip; each bet joins with probability ½ at a random size.
      for (const k of BET_KEYS) if (rng.next() < 0.5) layout[k] = chips(rng);
      if (BET_KEYS.every((k) => layout[k] === 0)) layout[pick(rng, BET_KEYS)] = chips(rng);
      return { layout, n: pick(rng, STRIPS) };
    }
    case 'long-shot': {
      // Green or edge (sometimes both) on the 15/25/37 strips.
      const r = rng.next();
      if (r < 0.45) layout.green = chips(rng);
      else if (r < 0.8) layout.edge = chips(rng);
      else {
        layout.green = chips(rng);
        layout.edge = chips(rng);
      }
      return { layout, n: pick(rng, [15, 25, 37] as StripSize[]) };
    }
    case 'marathon':
      // A lone green on the 55-slot strip.
      layout.green = chips(rng);
      return { layout, n: 55 };
  }
}

export default defineEval<Params>({
  configs: [
    { label: 'low (red / black, classic strip)', params: { style: 'colour' } },
    { label: 'medium (random mix, any strip)', params: { style: 'mixed' } },
    { label: 'high (green / edge, 15–37 slots)', params: { style: 'long-shot' } },
    { label: 'extreme (green, 55 slots)', params: { style: 'marathon' } },
  ],
  playRound({ style }, rng) {
    const { layout, n } = sample(style, rng);
    return { multiplier: spin(layout, n, rng.next()).multiplier, steps: 1 };
  },
});
