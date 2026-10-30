import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'ramsey',
  name: 'Ramsey',
  tagline: 'Colour the edges of a polygon at random. Avoid a one-colour triangle. Each edge shows its exact risk, and Ramsey says the board must lock.',
  mechanic: 'graph',
  status: 'retired',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#f15bb5',
});
