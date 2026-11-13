import { defineEval } from '@originals/game-sdk';
import { playRound, reelSet } from './math';

// One config per volatility level. The lines knob never moves the RTP; it
// moves the spread. Each round samples a line count within the level and plays
// the paid spin (or the bought feature) plus every free spin it leads to,
// exactly as the game does. The buy has its own exact RTP.
interface Params {
  lines: number[];
  buy?: boolean;
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const CONFIGS: { label: string; params: Params }[] = [
  { label: 'low (20 lines)', params: { lines: [20] } },
  { label: 'medium (8–19 lines)', params: { lines: range(8, 19) } },
  { label: 'high (2–7 lines)', params: { lines: range(2, 7) } },
  { label: 'extreme (1 line)', params: { lines: [1] } },
  { label: 'feature buy (1–20 lines)', params: { lines: range(1, 20), buy: true } },
];

export default defineEval<Params>({
  configs: CONFIGS.map(({ label, params }) => {
    const set = reelSet();
    return { label, params, rtp: params.buy ? set.buyRtp : set.rtp };
  }),
  playRound({ lines, buy }, rng) {
    const n = lines[rng.int(lines.length)];
    const r = playRound(reelSet(), n, () => rng.next(), !!buy);
    return { multiplier: r.multiplier, steps: r.spins.length };
  },
});
