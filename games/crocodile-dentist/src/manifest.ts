import { defineManifest } from '@originals/game-sdk';
import { DEFAULT_CONFIG as C } from './config';
import { maxMultiplier } from './math';

// Bite Bonus is a 0.1-step slider between min and max.
const biteBonuses = Array.from({ length: Math.round((C.biteBonusMax - C.biteBonusMin) / 0.1) + 1 }, (_, i) => C.biteBonusMin + i * 0.1);

export default defineManifest({
  id: 'crocodile-dentist',
  name: 'Croc Dentist',
  tagline: 'Take turns with the House pressing teeth. Whoever gets bitten loses.',
  mechanic: 'duel',
  status: 'prototype',
  rtp: C.rtp,
  maxMultiplier: maxMultiplier(C.teethOptions, C.badTeethOptions, biteBonuses, C.rtp),
  // Evals: std dev 0.8–1.5 on every board, even the 226× one, so low to medium.
  volatility: ['low', 'medium'],
  checkpoints: true,
  accent: '#46c463',
});
