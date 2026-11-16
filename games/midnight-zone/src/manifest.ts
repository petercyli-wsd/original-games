import { defineManifest } from '@originals/game-sdk';

export default defineManifest({
  id: 'midnight-zone',
  name: 'Midnight Zone',
  tagline: 'Deep-sea creatures pay anywhere. Jellyfish multiply the chain.',
  mechanic: 'slots',
  collection: 'slots',
  status: 'prototype',
  revision: {
    kind: 'new',
    date: '2026-11-16',
    note: 'Pay-anywhere tumbles with jellyfish orb sums. Sonnet-built, not yet rated by the team.',
  },
  rtp: 0.96,
  maxMultiplier: 15000,
  volatility: ['extreme'],
  checkpoints: false,
  accent: '#5ec4e6',
});
