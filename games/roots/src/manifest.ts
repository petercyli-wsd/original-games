import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'roots',
  name: 'Roots',
  tagline: 'A random parabola, one coefficient at a time. Will it cross the line? The green share of the box is your chance.',
  mechanic: 'number-theory',
  status: 'retired',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#c77dff',
});
