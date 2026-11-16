import { defineManifest } from '@originals/game-sdk';
import facts from './slot-facts.json';

export default defineManifest({
  id: 'grand-finale',
  name: 'Grand Finale',
  tagline: 'A 7×5 fireworks show where 10 matching bursts win anywhere and every wild rocket adds to the multiplier.',
  mechanic: 'slots',
  status: 'prototype',
  collection: 'slots',
  revision: { kind: 'new', date: '2026-11-16', note: 'Wild rockets add their numbers to every win. Sonnet-built, not yet rated by the team.' },
  rtp: 0.96, // 96.00% mc (uncapped 96.03% exact, cap loss mc), pack-verified; see slot-facts.json
  maxMultiplier: facts.maxWin,
  volatility: ['medium'],
  checkpoints: false,
  accent: '#e879b9', // ACCENTS.pink (docs/STYLE.md)
});
