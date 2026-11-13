import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'tarot',
  name: 'Tarot',
  tagline: 'A core card never below 1x, then two side cards that can be 0x. Payout is core x left x right.',
  mechanic: 'other',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#a78bfa', // ACCENTS.violet (docs/STYLE.md)
  revision: { kind: 'improved', date: '2026-11-13', note: 'Now matches the classic: a core table never below 1x, a shared side table with 0x, core flips first, a 0x side stops the round, published payouts at 98%.' },
});
