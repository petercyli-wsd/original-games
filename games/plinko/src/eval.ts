import { defineEval } from '@originals/game-sdk';
import { dropBall, tableFor, type Risk } from './math';

// One config per volatility level. Each round samples the player's settings
// (rows, and risk where the level spans several) and drops one ball along a
// path of fair bounces, exactly as the game does. Every table returns exactly
// 99%, so no config needs its own rtp override.
const LEVELS: { label: string; risks: Risk[]; rows: number[] }[] = [
  { label: 'low (Low risk, 8–16 rows)', risks: ['low'], rows: [8, 9, 10, 11, 12, 13, 14, 15, 16] },
  { label: 'medium (Medium risk, 8–16 rows)', risks: ['medium'], rows: [8, 9, 10, 11, 12, 13, 14, 15, 16] },
  { label: 'high (High risk, 8–12 rows)', risks: ['high'], rows: [8, 9, 10, 11, 12] },
  { label: 'extreme (High risk, 13–16 rows)', risks: ['high'], rows: [13, 14, 15, 16] },
];

export default defineEval<{ risks: Risk[]; rows: number[] }>({
  configs: LEVELS.map(({ label, risks, rows }) => ({ label, params: { risks, rows } })),
  playRound({ risks, rows }, rng) {
    const risk = risks[rng.int(risks.length)];
    const n = rows[rng.int(rows.length)];
    const { bucket } = dropBall(() => rng.next(), n);
    return { multiplier: tableFor(n, risk).mults[bucket], steps: 1 };
  },
});
