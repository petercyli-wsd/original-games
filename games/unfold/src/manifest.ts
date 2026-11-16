import { defineManifest } from '@originals/game-sdk';

export default defineManifest({
  id: 'unfold',
  name: 'Unfold',
  tagline: 'In free folds, squares open into animals only.',
  collection: 'slots',
  mechanic: 'slots',
  status: 'prototype',
  revision: { kind: 'new', date: '2026-11-16', note: 'Paper-fold ways slot; in free folds, bigger squares open into animals only.' },
  rtp: 0.96,
  maxMultiplier: 1500,
  volatility: ['medium'],
  checkpoints: false,
  accent: '#c9b28f',
});
