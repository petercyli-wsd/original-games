import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export const ACCENT = '#7b93ff'; // ACCENTS.blue (docs/STYLE.md)

export default defineManifest({
  id: 'video-poker',
  name: 'Video Poker',
  tagline: 'Five-card draw against a fixed paytable. Hold, draw, and see the exact value of every hold.',
  mechanic: 'table',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: ACCENT,
});
