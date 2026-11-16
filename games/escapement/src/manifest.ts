import { defineManifest } from '@originals/game-sdk';
import facts from './slot-facts.json';

export default defineManifest({
  id: 'escapement',
  name: 'Escapement',
  tagline: 'A clockmaker’s bench. Every win locks its gears while the rest of the clock respins, then the hour strikes.',
  mechanic: 'slots',
  status: 'prototype',
  collection: 'slots',
  revision: { kind: 'new', date: '2026-11-16', note: 'Winning gears lock and the clock respins until nothing new clicks in. Sonnet-built, not yet rated by the team.' },
  rtp: facts.rtp,
  maxMultiplier: facts.maxWin,
  volatility: ['medium'],
  checkpoints: false,
  accent: '#e6b450', // ACCENTS.amber (docs/STYLE.md): brass
});
