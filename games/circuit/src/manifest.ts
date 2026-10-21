import { defineManifest } from '@originals/game-sdk';
import { RTP, maxMultiplier } from './math';

export default defineManifest({
  id: 'circuit',
  name: 'Circuit',
  tagline: 'Get power from S to T across a network whose wires fail at random.',
  mechanic: 'graph',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: maxMultiplier(),
  // Evals (random cash-out step): std dev 0.50 Parallel, 0.74 Bridge, 1.63 Ladder,
  // 4.43 Series; playing every round to the end: 0.67, 0.99, 2.44, 7.8.
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#d9f99d',
});
