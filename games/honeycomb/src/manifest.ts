import { defineManifest } from '@originals/game-sdk';
import facts from './slot-facts.json';

export default defineManifest({
  id: 'honeycomb',
  name: 'Honeycomb',
  tagline: 'Land six honey cells and the comb starts filling.',
  mechanic: 'slots',
  collection: 'slots',
  status: 'prototype',
  rtp: facts.rtp,
  maxMultiplier: facts.maxWin,
  volatility: ['high'],
  checkpoints: false,
  accent: '#e6b450',
  revision: { kind: 'new', date: '2026-11-16', note: 'Sonnet-built hold-and-respin slot, not yet rated by the team.' },
});
