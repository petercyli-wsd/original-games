import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'scales',
  name: 'Scales',
  tagline: 'Beads drop onto a balance; bet which pan ends heavier. The tilt is the lead, and the green bars on the strip are your exact chance.',
  mechanic: 'process',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e6b450', // ACCENTS.amber (docs/STYLE.md)
});
