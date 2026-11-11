import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'knight',
  name: 'Knight',
  tagline: 'A knight makes 5 random knight moves; you win if it ends on a green square.',
  mechanic: 'process',
  status: 'prototype',
  revision: { kind: 'improved', date: '2026-11-02', note: 'Always 5 hops now: the target is your one risk choice, the board shows where the knight can end, and Run to the end finishes a round.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#c9b28f', // ACCENTS.sand (docs/STYLE.md)
});
