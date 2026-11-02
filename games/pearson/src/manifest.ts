import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'pearson',
  name: 'Pearson Walk',
  tagline: 'A walker one step from home takes N random unit steps. End inside home to win: one step wide, the chance is exactly 1/(N+2).',
  mechanic: 'random-walk',
  status: 'retired',
  revision: { kind: 'improved', date: '2026-11-02', note: 'The walker now always rests on one line from the centre so only its distance moves, every step is a real draw, and a Run to the end button finishes the walk.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#ff70a6',
});
