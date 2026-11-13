import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'wild-double',
  name: 'Wild Double',
  tagline: 'A 5×3, 20-line slot. Wilds pay and double the wins they complete; 3 scatters start 15 free spins at ×3.',
  mechanic: 'slots',
  status: 'retired',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#5ec4e6', // ACCENTS.sky (docs/STYLE.md)
});
