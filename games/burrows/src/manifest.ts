import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'burrows',
  name: 'Burrows',
  tagline: 'Hide 1 to 6 critters among 7 burrows. Tap one: a find multiplies your cash-out, an empty burrow loses it.',
  mechanic: 'mines',
  status: 'retired',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#c9b28f', // ACCENTS.sand (docs/STYLE.md)
});
