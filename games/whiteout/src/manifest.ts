import { defineManifest } from '@originals/game-sdk';
import facts from './slot-facts.json';

export default defineManifest({
  id: 'whiteout',
  name: 'Whiteout',
  tagline: 'Wins slide away and climb a ladder. In the storm, one reel is buried in wild snow.',
  mechanic: 'slots',
  collection: 'slots',
  status: 'prototype',
  revision: {
    kind: 'new',
    date: '2026-11-16',
    note: 'Alpine slot: drift rows and slides that climb a ladder; every Whiteout spin buries reel 4, 5 or 6 in wild snow. Not yet rated by the team.',
  },
  rtp: facts.rtp,
  // measured by slots:eval (Monte Carlo, tier mc); see slot-facts.json
  maxMultiplier: facts.maxWin,
  volatility: ['extreme'],
  checkpoints: false,
  accent: '#5ec4e6',
});
