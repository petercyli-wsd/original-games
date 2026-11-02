import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'tally',
  name: 'Tally',
  tagline: 'Balls drop onto unequal bins; back the first bin to stack three. A bin’s width is its chance to catch each ball.',
  mechanic: 'process',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#7aa2f7',
  revision: { kind: 'new', date: '2026-11-02', note: 'Balls drop onto a floor of unequal bins; back the bin that is first to stack three balls.' },
});
