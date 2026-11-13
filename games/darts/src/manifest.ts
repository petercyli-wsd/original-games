import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'darts',
  name: 'Darts',
  tagline: 'One dart that never misses. Every zone pays something, and its share of the board is your exact chance.',
  mechanic: 'geometry',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#e6b450', // ACCENTS.amber (docs/STYLE.md)
  revision: {
    kind: 'improved',
    date: '2026-11-13',
    note: 'Now matches the original darts game: a dart that never misses, six zones (two rings, 18 cells, bullseye), its four difficulty tables value for value, and 98% RTP.',
  },
});
