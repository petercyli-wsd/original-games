import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'banker',
  name: 'Banker',
  tagline: 'Sixteen sealed prizes. Cases open one by one. Take the Deal, or win the prize in your case.',
  mechanic: 'urn',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'high'],
  checkpoints: true,
  accent: '#5ec4e6', // ACCENTS.sky (docs/STYLE.md)
  revision: { kind: 'new', date: '2026-11-11', note: 'Sonnet-generated, not yet rated by the team. A Deal or No Deal game: open cases, take the banker\'s deal or play to the last case.' },
});
