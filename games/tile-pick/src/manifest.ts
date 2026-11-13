import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'tile-pick',
  name: 'Tile Pick',
  tagline: 'Pick 1 to 5 of 30 face-down tiles. All flip, and you win the sum of your picks.',
  mechanic: 'other',
  status: 'retired',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#5ec4e6', // ACCENTS.sky (docs/STYLE.md)
});
