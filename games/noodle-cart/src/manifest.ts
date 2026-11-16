import { defineManifest } from '@originals/game-sdk';

export default defineManifest({
  id: 'noodle-cart',
  name: 'Noodle Cart',
  tagline: 'A cook walks the stalls, and one reel always runs wild.',
  mechanic: 'slots',
  collection: 'slots',
  status: 'prototype',
  rtp: 0.96,
  maxMultiplier: 1000,
  volatility: ['low'],
  checkpoints: false,
  accent: '#e6b450',
  revision: { kind: 'new', date: '2026-11-16', note: 'A walking-wild night-market slot, built by Sonnet and not yet rated by the team.' },
});
