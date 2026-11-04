import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'back-to-back',
  name: 'Back to Back',
  tagline: 'Cards are turned from a deck of four colours. First colour to come up twice in a row wins. Back one.',
  mechanic: 'process',
  status: 'prototype',
  revision: { kind: 'new', date: '2026-11-04', note: 'Snap from a thinning, uneven four-colour deck: back a colour, the first to come up twice in a row wins.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e8a23a',
});
