import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'leak',
  name: 'Leak',
  tagline: 'Each tick one random token moves on: waiting tokens enter your room, tokens in your room leave for the exit. Get your target in before 3 leave.',
  mechanic: 'process',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#a78bfa', // ACCENTS.violet (docs/STYLE.md)
  revision: { kind: 'new', date: '2026-11-17', note: 'Sonnet-generated, not yet rated by the team. Each tick one random token moves on, and you win by getting your target number of tokens into your room before 3 of the tokens in it have leaked out.' },
});
