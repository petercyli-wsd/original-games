import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'homecoming',
  name: 'Homecoming',
  tagline: 'A random walk in 1, 2 or 3 dimensions has 30 steps to get home. Back Home or Away; Pólya prices both.',
  mechanic: 'random-walk',
  status: 'prototype',
  revision: { kind: 'improved', date: '2026-11-02', note: 'The walk is now drawn as distance from home on one-sided tracks, each press is one step, and the next step shows closer vs further moves.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e0aaff',
});
