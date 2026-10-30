import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'condorcet',
  name: 'Condorcet',
  tagline: 'Random voters rank three candidates. Back a Condorcet winner, or the paradox: majorities that chase each other round in a cycle.',
  mechanic: 'inference',
  status: 'retired',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#bde0fe',
});
