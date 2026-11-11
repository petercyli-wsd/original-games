import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export const RULE = 'Bank the target in five turns: 3 to 6 grows your pot, 1 or 2 wipes it, Bank keeps it.';

export default defineManifest({
  id: 'bank-it',
  name: 'Bank It',
  tagline: 'Push your luck with a die: roll to grow the pot, bank it to keep it. Reach the target before your five turns run out.',
  mechanic: 'dice',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e6b450', // ACCENTS.amber (docs/STYLE.md)
  revision: { kind: 'new', date: '2026-11-11', note: `Sonnet-generated, not yet rated by the team. ${RULE}` },
});
