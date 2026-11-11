import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export const RULE = 'Roll the dice and close open tiles that add up to the total; shut every tile to win.';

export default defineManifest({
  id: 'shut',
  name: 'Shut',
  tagline: 'Shut the Box: close open tiles that add up to each dice roll. The green share of the totals band is your next roll.',
  mechanic: 'dice',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#7b93ff', // ACCENTS.blue (docs/STYLE.md)
  revision: { kind: 'new', date: '2026-11-02', note: RULE },
});
