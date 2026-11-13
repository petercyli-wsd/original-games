import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'holdfast',
  name: 'Holdfast',
  tagline: 'A 3-4-4-4-3 slot with 40 fixed lines, free spins and a lock feature that holds keystones for five respins.',
  mechanic: 'slots',
  status: 'retired',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['high'],
  checkpoints: false,
  accent: '#7b93ff', // ACCENTS.blue (docs/STYLE.md)
});
