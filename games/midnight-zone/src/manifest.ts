import { defineManifest } from '@originals/game-sdk';

export default defineManifest({
  id: 'midnight-zone',
  name: 'Midnight Zone',
  tagline: 'Pay-anywhere tumbles. In The Abyss each tumble opens a deeper row.',
  mechanic: 'slots',
  collection: 'slots',
  status: 'prototype',
  revision: {
    kind: 'new',
    date: '2026-11-16',
    note: 'Round 1 repair: The Abyss gets deeper, each tumble opens a row (6x5 to 6x8).',
  },
  rtp: 0.96,
  maxMultiplier: 15000,
  volatility: ['extreme'],
  checkpoints: false,
  accent: '#5ec4e6',
});
