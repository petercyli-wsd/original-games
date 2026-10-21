import { defineManifest } from '@originals/game-sdk';
import { RTP, VOLATILITY_NAMES, maxMultiplier } from './math';

export default defineManifest({
  id: 'drift',
  name: 'Drift',
  tagline: 'A dot drifts between a red wall and a green one. Where it sits is your odds.',
  mechanic: 'random-walk',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier,
  volatility: VOLATILITY_NAMES,
  checkpoints: true,
  accent: '#1ec8ff',
});
