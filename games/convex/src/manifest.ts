import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'convex',
  name: 'Convex',
  tagline: 'Dots drop into a square one at a time. Each must land in green; land in red and you lose. Cash out any time.',
  mechanic: 'geometry',
  status: 'prototype',
  revision: { kind: 'improved', date: '2026-11-02', note: 'Every dot now simply lands in green (safe) or red (lose), the triangle arena is gone, and the numbers shown are the live ones.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#43aa8b',
});
