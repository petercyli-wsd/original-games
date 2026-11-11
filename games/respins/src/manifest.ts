import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'respins',
  name: 'Respins',
  tagline: 'Every spin lands on one of 15 cells: an empty one gets a coin and refills your respins, a full one costs a respin. Fill 14 cells before they run out.',
  mechanic: 'slots',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e6b450',
  revision: { kind: 'new', date: '2026-11-11', note: 'Sonnet-generated, not yet rated by the team. A slot hold-and-spin ladder: each spin fills an empty cell or costs a respin; cash out any time.' },
});
