import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'chicken',
  name: 'Chicken',
  tagline: 'Hop along a road with hidden hazards. Every safe lane raises the multiplier; cash out before you hit one.',
  mechanic: 'mines',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  revision: { kind: 'improved', date: '2026-11-13', note: 'Now matches Stake Chicken: 1/3/5/10 hazards hidden among 20 slots without replacement, 19/17/15/10 lanes, 98% RTP, payouts 1.03x up to 181,060.88x.' },
  accent: '#e6b450', // ACCENTS.amber (docs/STYLE.md)
});
