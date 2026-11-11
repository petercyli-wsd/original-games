import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'sixes',
  name: 'Sixes',
  tagline: 'Roll your dice up to three times; sixes stay put. Every die on six wins. The bar under each die is its chance.',
  mechanic: 'dice',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#7b93ff', // ACCENTS.blue (docs/STYLE.md)
  revision: { kind: 'new', date: '2026-11-02', note: 'Roll your dice up to three times; sixes stay put, and you win if every die shows a six.' },
});
