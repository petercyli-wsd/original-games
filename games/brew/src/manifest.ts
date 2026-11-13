import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'brew',
  name: 'Brew',
  tagline: 'Draw chips from an open bag: green chips fill your potion, white chips heat it. Fill the potion before the heat passes 7.',
  mechanic: 'process',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#5ec4e6', // ACCENTS.sky (docs/STYLE.md)
  revision: { kind: 'new', date: '2026-11-13', note: 'Sonnet-generated, not yet rated by the team. Draw chips from an open bag: green chips fill your potion, white chips add their number to the heat, and you win by filling the potion before the heat passes 7.' },
});
