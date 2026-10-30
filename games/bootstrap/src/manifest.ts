import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'bootstrap',
  name: 'Bootstrap',
  tagline: 'Seeds land, infection spreads to any cell with two sick neighbours. Will the whole grid fall? The perimeter can only shrink.',
  mechanic: 'graph',
  status: 'retired',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#caf0f8',
});
