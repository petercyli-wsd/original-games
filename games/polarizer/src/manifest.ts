import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'polarizer',
  name: 'Polarizer',
  tagline: 'Turn a photon from 0° to 90° through polarizers. Each one passes it with chance cos²Δ: the squared projection is your odds.',
  mechanic: 'geometry',
  status: 'prototype',
  revision: { kind: 'improved', date: '2026-11-13', note: 'Back from the Archive: after the fairness fixes it passed the AI gate on a panel of 3 (3.59), and it is restyled to the flat house style.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#5ec4e6',
});
