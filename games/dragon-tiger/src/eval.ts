import { defineEval, type Rng } from '@originals/game-sdk';
import { SIDE_KINDS, deal, layoutRtp, settle, type Layout } from './math';

// Dragon Tiger bets carry different house edges, so every config declares its
// own exact rtp. Each config picks one layout uniformly from a family a real
// player places, then scales it by a random chip count. Scaling keeps a
// layout's RTP, so the config's RTP is the plain mean of its layouts' exact
// RTPs (layoutRtp: Σ sᵢ·RTPᵢ / Σ sᵢ, from the 52 × 52 enumeration).

const sides = ['dragon', 'tiger'] as const;

const FAMILIES: { label: string; layouts: Layout[] }[] = [
  {
    label: 'low (Dragon or Tiger)',
    layouts: [{ dragon: 1 }, { tiger: 1 }, { dragon: 2 }, { tiger: 3 }],
  },
  {
    label: 'medium (side bets, mixed tables)',
    layouts: [
      ...sides.flatMap((s) => SIDE_KINDS.map((k) => ({ [`${s}-${k}`]: 1 }))),
      { dragon: 3, 'dragon-big': 1 },
      { tiger: 2, 'tiger-red': 1, 'dragon-black': 1 },
      { dragon: 4, tie: 1 },
      { tiger: 5, tie: 1, suited: 1 },
    ],
  },
  {
    label: 'high (Tie)',
    layouts: [{ tie: 1 }, { tie: 2, dragon: 1 }],
  },
  {
    label: 'extreme (Suited tie)',
    layouts: [{ suited: 1 }, { suited: 2, tie: 1 }],
  },
];

const configRtp = (layouts: Layout[]) => layouts.reduce((a, l) => a + layoutRtp(l), 0) / layouts.length;

function scale(l: Layout, k: number): Layout {
  const out: Layout = {};
  for (const [id, v] of Object.entries(l)) out[id] = v * k;
  return out;
}

const pick = <T>(rng: Rng, xs: readonly T[]) => xs[Math.min(xs.length - 1, Math.floor(rng.next() * xs.length))];

export default defineEval<{ family: number }>({
  configs: FAMILIES.map((f, i) => ({ label: f.label, params: { family: i }, rtp: configRtp(f.layouts) })),
  playRound({ family }, rng) {
    const layout = scale(pick(rng, FAMILIES[family].layouts), 1 + Math.floor(rng.next() * 5));
    const { dragon, tiger } = deal(rng.next(), rng.next());
    return { multiplier: settle(layout, dragon, tiger).multiplier, steps: 1 };
  },
});

export { FAMILIES, configRtp };
