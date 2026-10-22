import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'lighthouse',
  name: 'Lighthouse',
  tagline: 'The beam stops at a random angle. Light your stretch of shore. The green slice of the lamp’s fan is your chance.',
  mechanic: 'geometry',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#ffe066',
});
