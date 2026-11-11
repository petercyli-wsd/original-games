import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'seven-out',
  name: 'Seven Out',
  tagline: 'Roll two dice. Light k different totals before a 7 shows up. The green cells against the 6 red ones are your chance.',
  mechanic: 'dice',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#5ec4e6',
  revision: { kind: 'new', date: '2026-11-11', note: 'Sonnet-generated, not yet rated by the team. A craps twist: make k different dice totals before a 7 turns up; cash out between rolls.' },
});
