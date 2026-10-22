import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'polarizer',
  name: 'Polarizer',
  tagline: 'Turn a photon from 0° to 90° through polarizers. Each one passes it with chance cos²Δ: the squared projection is your odds.',
  mechanic: 'geometry',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#80ffdb',
});
