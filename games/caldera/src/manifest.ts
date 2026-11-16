import { defineManifest } from '@originals/game-sdk';
import facts from './slot-facts.json';

export default defineManifest({
  id: 'caldera',
  name: 'Caldera',
  tagline: 'Lava wilds stay hot through wins while pressure builds to ×140.',
  collection: 'slots',
  mechanic: 'slots',
  status: 'prototype',
  revision: { kind: 'new', date: '2026-11-16', note: 'Repair: lava wilds cool one win at a time (2 wins, 3 in Eruption spins), 10,000x max win, premiums on gold plaques. Not yet rated by the team.' },
  rtp: facts.rtp,
  maxMultiplier: facts.maxWin,
  volatility: ['high'],
  checkpoints: false,
  accent: '#e6b450',
});
