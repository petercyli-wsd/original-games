import { defineManifest } from '@originals/game-sdk';
import facts from './slot-facts.json';

export default defineManifest({
  id: 'grand-finale',
  name: 'Grand Finale',
  tagline: 'A 7×5 fireworks show: 10 matching bursts win anywhere, rockets add to the multiplier, and the finale builds ×1, ×2, ×3 spin by spin.',
  mechanic: 'slots',
  status: 'prototype',
  collection: 'slots',
  revision: { kind: 'new', date: '2026-11-16', note: 'The finale builds: free spin n pays ×n, times the rockets. Sonnet-built, not yet rated by the team.' },
  rtp: 0.96, // 95.96% mc (uncapped 96.02% exact, cap loss mc), pack-verified; see slot-facts.json
  maxMultiplier: facts.maxWin,
  volatility: ['medium'],
  checkpoints: false,
  accent: '#e879b9', // ACCENTS.pink (docs/STYLE.md)
});
