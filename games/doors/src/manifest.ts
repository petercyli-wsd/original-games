import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'doors',
  name: 'Doors',
  tagline: 'One prize behind 3 to 12 doors. The host opens empty ones and the bars show where the prize must be. Switch any time: the value stays put.',
  mechanic: 'inference',
  status: 'retired',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#bdb2ff',
});
