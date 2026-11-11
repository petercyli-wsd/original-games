import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'pascal',
  name: 'Pascal',
  tagline: 'Six ↙ cards and six ↘ cards are shuffled; the ball follows the cards dealt down the triangle. Land it in your gate.',
  mechanic: 'combinatorics',
  status: 'prototype',
  revision: { kind: 'improved', date: '2026-11-02', note: 'The left/right moves are now a visible deck of cards, the board stops at the gate row, and gate width and position are the only settings.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#5ec4e6', // ACCENTS.sky (docs/STYLE.md)
});
