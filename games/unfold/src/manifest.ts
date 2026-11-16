import { defineManifest } from '@originals/game-sdk';

export default defineManifest({
  id: 'unfold',
  name: 'Unfold',
  tagline: 'Folded paper squares open into one animal.',
  collection: 'slots',
  mechanic: 'slots',
  status: 'prototype',
  revision: { kind: 'new', date: '2026-11-16', note: 'Paper-fold ways slot with mystery squares; Sonnet-built, not yet rated by the team.' },
  rtp: 0.96,
  maxMultiplier: 1500,
  volatility: ['low'],
  checkpoints: false,
  accent: '#c9b28f',
});
