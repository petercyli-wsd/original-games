import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'quadrant',
  name: 'Quadrant',
  tagline: 'A point lands in a tilted Gaussian cloud: x first, then y. The green share of the cloud is your chance.',
  mechanic: 'geometry',
  status: 'prototype',
  revision: { kind: 'improved', date: '2026-11-13', note: 'Back from the Archive: after the fairness fixes it passed the AI gate on a panel of 3 (3.50), and it is restyled to the flat house style.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#5ec4e6',
});
