import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'range-dice',
  name: 'Range Dice',
  tagline: 'Set a range, its outside, or two ranges on the track. The green share is your chance.',
  mechanic: 'dice',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  revision: { kind: 'improved', date: '2026-11-13', note: 'Now matches Prime Dice: Roll between two added, Roll out and two-range chances start at 0.02% (4,950×), values shown 0.00–99.99.' },
  accent: '#5ec4e6', // ACCENTS.sky (docs/STYLE.md)
});
