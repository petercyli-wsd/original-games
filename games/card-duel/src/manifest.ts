import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'card-duel',
  name: 'Card Duel',
  tagline: 'Your row of numbered cards duels the house row, front card against front card. Knock out every house card before yours run out.',
  mechanic: 'process',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#a78bfa', // ACCENTS.violet (docs/STYLE.md)
  revision: { kind: 'new', date: '2026-11-13', note: 'Sonnet-generated, not yet rated by the team. Front cards duel on a spinner split by their numbers: the loser is out, the winner goes to the back, and you knock out the house row before yours runs out.' },
});
