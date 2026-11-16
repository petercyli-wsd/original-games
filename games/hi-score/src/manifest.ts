import { defineManifest } from '@originals/game-sdk';

export default defineManifest({
  id: 'hi-score',
  name: 'Hi-Score',
  tagline: 'A 3×3 arcade cabinet with a bonus marquee that multiplies every win, and a hotter bonus stage.',
  mechanic: 'slots',
  collection: 'slots',
  status: 'retired',
  revision: { kind: 'new', date: '2026-11-16', note: 'Dropped after one repair round: AI review 3.12, gate 3.5. Kept playable in the Archive for team calibration.' },
  rtp: 0.96,
  maxMultiplier: 2500,
  volatility: ['medium'],
  checkpoints: false,
  accent: '#e879b9', // ACCENTS.pink (docs/STYLE.md)
});
