import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'pivot',
  name: 'Pivot',
  tagline: 'Blocks stack up in random order. Win if yours is the one that takes the stack over the line.',
  mechanic: 'combinatorics',
  status: 'prototype',
  revision: { kind: 'improved', date: '2026-11-02', note: 'The rule is now one fixed line: blocks stack up, and yours wins if its top end crosses the line. The waiting blocks stand on the stack at full size, red where joining next would knock you out; the chance-after cards are gone and the headline chance has its own bar.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e6b450', // ACCENTS.amber (docs/STYLE.md)
});
