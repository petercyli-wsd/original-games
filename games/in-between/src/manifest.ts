import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP, VOL_OF } from './math';

export const RULE = 'Place each number between the posts so the row stays in order.';

export default defineManifest({
  id: 'in-between',
  name: 'In Between',
  tagline: 'Two posts, one row of slots. Place every drawn number in order, and cash out whenever you like.',
  mechanic: 'combinatorics',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: [...new Set(Object.values(VOL_OF))],
  checkpoints: true,
  accent: '#5ec4e6', // ACCENTS.sky (docs/STYLE.md)
  revision: { kind: 'new', date: '2026-11-23', note: `Sonnet-generated, not yet rated by the team. ${RULE}` },
});
