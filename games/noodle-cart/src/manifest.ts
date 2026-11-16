import { defineManifest } from '@originals/game-sdk';

export default defineManifest({
  id: 'noodle-cart',
  name: 'Noodle Cart',
  tagline: 'A cook runs one reel wild; in Dinner rush, orders pile up.',
  mechanic: 'slots',
  collection: 'slots',
  status: 'prototype',
  rtp: 0.96,
  maxMultiplier: 1000,
  volatility: ['medium'],
  checkpoints: false,
  accent: '#e6b450',
  revision: { kind: 'new', date: '2026-11-16', note: 'Dinner rush: every new order ticket adds a spin and +1 multiplier.' },
});
