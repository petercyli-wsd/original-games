import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'euler',
  name: 'Euler',
  tagline: 'Random edges join the nodes. Each edge flips the parity of both ends. Back the number of odd nodes at the end: glowing nodes are odd.',
  mechanic: 'graph',
  status: 'retired',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#fcbf49',
});
