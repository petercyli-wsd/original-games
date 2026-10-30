import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'factor',
  name: 'Factor',
  tagline: 'A hidden number is factored by trial division. Back how many prime factors it has. The lit cells are your odds.',
  mechanic: 'number-theory',
  status: 'retired',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#f4a261',
});
