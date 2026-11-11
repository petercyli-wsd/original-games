import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'records',
  name: 'Records',
  tagline: 'Item t drops into one of t equal slots; only the top slot is a new record. Get enough records before the 20 items run out.',
  mechanic: 'combinatorics',
  status: 'prototype',
  revision: { kind: 'improved', date: '2026-11-02', note: 'Each item now drops a ball into one of t equal slots, with the green slot as the record; the height skyline is gone and one setting picks how many records you need.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e879b9', // ACCENTS.pink (docs/STYLE.md)
});
