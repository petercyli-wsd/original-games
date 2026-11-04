import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'cross',
  name: 'Cross',
  tagline: 'Cards are turned from a 3 × 4 grid. Each must miss the last card’s colour and shape. The red cross is your risk.',
  mechanic: 'combinatorics',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e879b9', // ACCENTS.pink (docs/STYLE.md)
  revision: { kind: 'new', date: '2026-11-02', note: 'Cards are turned at random from the 12-card grid; each must differ in both colour and shape from the card before it, and you win if you survive every turn.' },
});
