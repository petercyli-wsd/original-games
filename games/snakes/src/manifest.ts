import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'snakes',
  name: 'Snakes',
  tagline: 'Two dice land on a tile from 2 to 12. Multiply on each safe roll, cash out before a pit.',
  mechanic: 'other',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  revision: { kind: 'improved', date: '2026-11-13', note: 'Now matches the original: each roll lands on the tile for its dice total, Start plus 11 tiles, 1/3/5/7/9 pits (snakes), edge tiles up to 18x, at most 5 rolls.' },
  accent: '#5ec4e6', // ACCENTS.sky (docs/STYLE.md)
});
