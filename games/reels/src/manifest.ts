import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'reels',
  name: 'Reels',
  tagline: 'A 5×3, 20-line slot with wilds, scatters and retriggering free spins at 2×. Three reel sets, every RTP exact.',
  mechanic: 'slots',
  status: 'live',
  revision: { kind: 'improved', date: '2026-11-02', note: 'A chance bar shows how likely the spin is to pay and updates as each reel stops; tap a line number to trace that line.' },
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#e6b450', // ACCENTS.amber (docs/STYLE.md)
});
