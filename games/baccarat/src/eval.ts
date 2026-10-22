import { defineEval, type Rng } from '@originals/game-sdk';
import { deal, layoutRtp, resultOf, settle, type Layout, type Variant } from './math';

// Baccarat bets carry different house edges, so every config declares its own
// exact rtp. Each config picks one (layout, table rules) uniformly from a
// family a real player places, then scales it by a random chip count. Scaling
// keeps a layout's RTP, so the config's RTP is the plain mean of its layouts'
// exact RTPs (layoutRtp: Σ sᵢ·RTPᵢ / Σ sᵢ, from the exact joint table).

interface Spot {
  layout: Layout;
  variant: Variant;
}

const FAMILIES: { label: string; spots: Spot[] }[] = [
  {
    label: 'low (Banker or Player)',
    spots: [
      { layout: { banker: 1 }, variant: 'classic' },
      { layout: { player: 1 }, variant: 'classic' },
      { layout: { banker: 1 }, variant: 'nocomm' },
      { layout: { player: 2 }, variant: 'nocomm' },
      { layout: { banker: 3, player: 1 }, variant: 'classic' },
    ],
  },
  {
    label: 'medium (main bet plus sides)',
    spots: [
      { layout: { banker: 4, tie: 1 }, variant: 'classic' },
      { layout: { player: 3, eitherPair: 1 }, variant: 'classic' },
      { layout: { banker: 5, playerPair: 1, bankerPair: 1 }, variant: 'nocomm' },
      { layout: { eitherPair: 1 }, variant: 'classic' },
      { layout: { player: 4, tie: 1, perfectPair: 1 }, variant: 'nocomm' },
    ],
  },
  {
    label: 'high (Tie and pairs)',
    spots: [
      { layout: { tie: 1 }, variant: 'classic' },
      { layout: { playerPair: 1 }, variant: 'classic' },
      { layout: { bankerPair: 1 }, variant: 'nocomm' },
      { layout: { tie: 2, playerPair: 1, bankerPair: 1 }, variant: 'classic' },
    ],
  },
  {
    label: 'extreme (Perfect Pair)',
    spots: [
      { layout: { perfectPair: 1 }, variant: 'classic' },
      { layout: { perfectPair: 2, tie: 1 }, variant: 'nocomm' },
    ],
  },
];

const configRtp = (spots: Spot[]) => spots.reduce((a, s) => a + layoutRtp(s.layout, s.variant), 0) / spots.length;

function scale(l: Layout, k: number): Layout {
  const out: Layout = {};
  for (const [id, v] of Object.entries(l)) out[id as keyof Layout] = (v ?? 0) * k;
  return out;
}

const pick = <T>(rng: Rng, xs: readonly T[]) => xs[Math.min(xs.length - 1, Math.floor(rng.next() * xs.length))];

export default defineEval<{ family: number }>({
  configs: FAMILIES.map((f, i) => ({ label: f.label, params: { family: i }, rtp: configRtp(f.spots) })),
  playRound({ family }, rng) {
    const s = pick(rng, FAMILIES[family].spots);
    const layout = scale(s.layout, 1 + Math.floor(rng.next() * 5));
    const d = deal(() => rng.next());
    return { multiplier: settle(layout, resultOf(d), s.variant).multiplier, steps: 1 };
  },
});

export { FAMILIES, configRtp };
