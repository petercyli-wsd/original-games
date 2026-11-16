import { defineManifest } from '@originals/game-sdk';
import facts from './slot-facts.json';

export default defineManifest({
  id: 'honeycomb',
  name: 'Honeycomb',
  tagline: 'Honey on every reel fills the comb; the queen multiplies it.',
  mechanic: 'slots',
  collection: 'slots',
  status: 'prototype',
  rtp: facts.rtp,
  maxMultiplier: facts.maxWin,
  volatility: ['high'],
  checkpoints: false,
  accent: '#e6b450',
  revision: { kind: 'new', date: '2026-11-16', note: 'Round 2: a queen on the last respin multiplies the harvest; full comb reachable.' },
});
