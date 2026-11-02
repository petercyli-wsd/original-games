import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'probe',
  name: 'Probe',
  tagline: 'Balls land on a ring and slide to the next empty slot. Land on red and you bust.',
  mechanic: 'combinatorics',
  status: 'retired',
  revision: { kind: 'improved', date: '2026-11-02', note: 'Plain words (balls and slots), one setting for how many balls to place, and red slots that show exactly where a ball would bust.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#00bbf9',
});
