import { defineManifest } from '@originals/game-sdk';
import { RTP, maxMultiplier } from './math';

export default defineManifest({
  id: 'snowball',
  name: 'Snowball',
  tagline: 'Every ball you draw brings a twin. Hold the majority at the end.',
  mechanic: 'urn',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: maxMultiplier(),
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#7dd3fc',
});
