import { defineEval } from '@originals/game-sdk';
import { playKeno, randomPicks, type Risk } from './math';

// Every (risk, picks) table pays exactly 99%, so all configs share the
// manifest RTP. Volatility comes from risk and the picks count; each config
// samples a picks range and the way numbers are chosen (a fixed block, a
// fresh random set, or Auto's re-pick every bet), since the choice of
// numbers must not matter.
const LEVELS: { label: string; risk: Risk; picks: number[] }[] = [
  { label: 'low (Low risk, 1, 2 or 10 picks)', risk: 'low', picks: [1, 2, 10] },
  { label: 'medium (Classic risk, 1–10 picks)', risk: 'classic', picks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  { label: 'high (Medium risk, 3–7 picks)', risk: 'medium', picks: [3, 4, 5, 6, 7] },
  { label: 'extreme (High risk, 3–7 picks)', risk: 'high', picks: [3, 4, 5, 6, 7] },
];

export default defineEval<{ risk: Risk; picks: number[] }>({
  configs: LEVELS.map(({ label, risk, picks }) => ({ label, params: { risk, picks } })),
  playRound({ risk, picks }, rng) {
    const n = picks[rng.int(picks.length)];
    const style = rng.int(3);
    if (style === 2) return { multiplier: playKeno(rng, risk, [], n).multiplier, steps: 1 };
    const chosen = style === 0 ? Array.from({ length: n }, (_, i) => i + 1) : randomPicks(rng, n);
    return { multiplier: playKeno(rng, risk, chosen).multiplier, steps: 1 };
  },
});
