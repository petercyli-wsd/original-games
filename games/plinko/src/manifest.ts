import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'plinko',
  name: 'Plinko',
  tagline: 'Drop a ball through the pegs. Pick rows and one of four risks; every setting returns exactly 99%.',
  mechanic: 'other',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  revision: { kind: 'improved', date: '2026-11-13', note: 'Added Stake\'s Expert risk (8-16 rows, 10,000x top prize).' },
  accent: '#e879b9', // ACCENTS.pink (docs/STYLE.md)
});
