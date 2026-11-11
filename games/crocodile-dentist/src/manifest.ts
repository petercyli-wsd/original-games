import { defineManifest } from '@originals/game-sdk';
import { DEFAULT_CONFIG as C } from './config';
import { maxMultiplier } from './math';

export default defineManifest({
  id: 'crocodile-dentist',
  name: 'Croc Dentist (vs House)',
  tagline: 'Take turns with the House pressing teeth. Press the bad tooth and you lose; if the House does, you win.',
  mechanic: 'duel',
  status: 'prototype',
  revision: { kind: 'improved', date: '2026-11-02', note: 'One setting now (bad teeth on a 20-tooth jaw), one cash-out number per round, and a live win-chance bar that moves after every press.' },
  rtp: C.rtp,
  maxMultiplier: maxMultiplier(C.teeth, C.badTeethOptions, C.rtp),
  // One knob (bad teeth on a 20-tooth jaw): 1 bad tooth is a calm 50% duel,
  // 19 bad teeth is a 5% shot at 19.8x.
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#5ec4e6', // ACCENTS.sky (docs/STYLE.md)
});
