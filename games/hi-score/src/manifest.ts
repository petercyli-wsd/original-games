import { defineManifest } from '@originals/game-sdk';

export default defineManifest({
  id: 'hi-score',
  name: 'Hi-Score',
  tagline: 'A 3×3 arcade cabinet with a bonus marquee that multiplies every win, and a hotter bonus stage.',
  mechanic: 'slots',
  collection: 'slots',
  status: 'prototype',
  revision: { kind: 'new', date: '2026-11-16', note: 'A 3×3 arcade slot whose marquee multiplies every win. Sonnet-built, not yet rated by the team.' },
  rtp: 0.96,
  maxMultiplier: 2500,
  volatility: ['medium'],
  checkpoints: false,
  accent: '#e879b9', // ACCENTS.pink (docs/STYLE.md)
});
