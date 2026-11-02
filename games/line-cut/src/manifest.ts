import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'line-cut',
  name: 'Line Cut',
  tagline: 'A random line crosses the arena; win if it cuts your shape. Its shadow on the ruler is your chance.',
  mechanic: 'geometry',
  status: 'prototype',
  revision: { kind: 'improved', date: '2026-11-02', note: 'One line, Hit only: your shape is the one setting, it sits alone on the board, and the share of the ruler its shadow covers is your chance.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#80ed99',
});
