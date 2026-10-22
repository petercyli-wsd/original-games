import { defineEval } from '@originals/game-sdk';
import { playRound, reelSet, type Vol } from './math';

// One config per volatility level. Each round samples the player's line count
// within the level (the lines knob never moves the RTP) and plays the paid spin
// plus every free spin it leads to, exactly as the game does. The three reel
// sets have slightly different exact RTPs, and the feature buy has its own, so
// every config declares its exact rtp.
interface Params {
  vol: Vol;
  lines: number[];
  buy?: boolean;
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const CONFIGS: { label: string; params: Params }[] = [
  { label: 'low (Low reels, 20 lines)', params: { vol: 'low', lines: [20] } },
  { label: 'medium (Medium reels, 1–20 lines)', params: { vol: 'medium', lines: range(1, 20) } },
  { label: 'high (High reels, 10–20 lines)', params: { vol: 'high', lines: range(10, 20) } },
  { label: 'extreme (High reels, 1–3 lines)', params: { vol: 'high', lines: range(1, 3) } },
  { label: 'feature buy (Low reels)', params: { vol: 'low', lines: range(1, 20), buy: true } },
  { label: 'feature buy (Medium reels)', params: { vol: 'medium', lines: range(1, 20), buy: true } },
  { label: 'feature buy (High reels)', params: { vol: 'high', lines: range(1, 20), buy: true } },
];

export default defineEval<Params>({
  configs: CONFIGS.map(({ label, params }) => {
    const set = reelSet(params.vol);
    return { label, params, rtp: params.buy ? set.buyRtp : set.rtp };
  }),
  playRound({ vol, lines, buy }, rng) {
    const n = lines[rng.int(lines.length)];
    const r = playRound(reelSet(vol), n, () => rng.next(), !!buy);
    return { multiplier: r.multiplier, steps: r.spins.length };
  },
});
