import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'turf',
  name: 'Turf',
  tagline: 'Two paints spread over a 4 by 4 grid along random arrows, and walled-off pockets fill. Hold your target cells before the house does.',
  mechanic: 'process',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#7b93ff', // ACCENTS.blue (docs/STYLE.md)
  revision: { kind: 'new', date: '2026-11-24', note: 'Sonnet-generated, not yet rated by the team. Two paints spread over a 4 by 4 grid along random arrows, walled-off pockets fill, and you win by holding your target number of cells.' },
});
