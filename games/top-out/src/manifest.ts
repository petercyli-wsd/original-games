import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'top-out',
  name: 'Top Out',
  tagline: 'Four climbers go one at a time to a hidden slip. Back a wall; the highest climb wins.',
  mechanic: 'process',
  status: 'prototype',
  revision: { kind: 'new', date: '2026-11-23', note: 'Sonnet-generated, not yet rated by the team. Four climbers take turns on walls of 2, 4, 8 and 16 holds, and the highest climb wins.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e6b450', // ACCENTS.amber (docs/STYLE.md)
});
