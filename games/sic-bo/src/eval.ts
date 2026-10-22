import { defineEval, type Rng } from '@originals/game-sdk';
import { layoutRtp, rollDice, settle, type Layout } from './math';

// Sic Bo bets carry different house edges, so every config declares its own
// exact rtp. Each config picks one layout uniformly from a family a real
// player places, then scales it by a random chip count. Scaling keeps a
// layout's RTP, so the config's RTP is the plain mean of its layouts' exact
// RTPs (layoutRtp: Σ sᵢ·RTPᵢ / Σ sᵢ, from the 216-outcome enumeration).

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const FAMILIES: { label: string; layouts: Layout[] }[] = [
  {
    label: 'low (Big / Small / Odd / Even)',
    layouts: [{ big: 1 }, { small: 1 }, { odd: 1 }, { even: 1 }, { big: 1, odd: 1 }, { small: 2, even: 1 }],
  },
  {
    label: 'medium (single numbers, combinations, mixed tables)',
    layouts: [
      ...range(1, 6).map((n) => ({ [`single-${n}`]: 1 })),
      { 'combo-1-2': 1 },
      { 'combo-3-5': 1 },
      { 'combo-4-6': 1 },
      { big: 3, 'total-11': 1, 'single-6': 1 },
      { small: 3, 'total-10': 1, 'combo-1-2': 1 },
      { odd: 2, 'single-1': 1, 'single-3': 1, 'single-5': 1 },
    ],
  },
  {
    label: 'high (totals, doubles, any triple)',
    layouts: [...range(4, 17).map((t) => ({ [`total-${t}`]: 1 })), ...range(1, 6).map((n) => ({ [`double-${n}`]: 1 })), { anyTriple: 1 }],
  },
  {
    label: 'extreme (specific triple)',
    layouts: range(1, 6).map((n) => ({ [`triple-${n}`]: 1 })),
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
    const dice = rollDice(rng.next(), rng.next(), rng.next());
    return { multiplier: settle(layout, dice).multiplier, steps: 1 };
  },
});

export { FAMILIES, configRtp };
