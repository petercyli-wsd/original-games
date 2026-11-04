import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'derby-v2',
  name: 'Derby v2',
  tagline: 'Back a runner; first past the line wins. Steady or erratic, the tote shows every runner’s live odds.',
  mechanic: 'process',
  status: 'prototype',
  revision: { kind: 'improved', date: '2026-11-04', note: 'Fixes the Derby complaint about switching runners midway confusing the odds: you now back one runner and it stays yours to the end.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#2a9d8f',
});
