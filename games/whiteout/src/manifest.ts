import { defineManifest } from '@originals/game-sdk';
import facts from './slot-facts.json';

export default defineManifest({
  id: 'whiteout',
  name: 'Whiteout',
  tagline: 'Drift rows shift every spin. Wins slide away and every slide hits harder.',
  mechanic: 'slots',
  collection: 'slots',
  status: 'prototype',
  revision: {
    kind: 'new',
    date: '2026-11-16',
    note: 'Alpine slot: drift rows, slides that climb a ladder, Whiteout spins. Sonnet-built, not yet rated by the team.',
  },
  rtp: facts.rtp,
  // measured by slots:eval (Monte Carlo, tier mc); see slot-facts.json
  maxMultiplier: facts.maxWin,
  volatility: ['extreme'],
  checkpoints: false,
  accent: '#5ec4e6',
});
