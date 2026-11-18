import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'fleet',
  name: 'Fleet',
  tagline: 'Five rockets climb together to 2×. Win if enough are still flying. Height is each rocket\'s chance.',
  mechanic: 'crash',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#5ec4e6', // ACCENTS.sky (docs/STYLE.md)
  revision: { kind: 'new', date: '2026-11-18', note: 'Sonnet-generated, not yet rated by the team. Five rockets climb to 2× on a linear axis and you win if at least k are still flying.' },
});
