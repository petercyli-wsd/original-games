import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'lighthouse',
  name: 'Lighthouse',
  tagline: 'The beam fires in a random direction; win if it lands in your window. The green slice of the lamp’s fan is your chance.',
  mechanic: 'geometry',
  status: 'prototype',
  revision: { kind: 'improved', date: '2026-11-02', note: 'Shutters are gone: the beam always fires, window distance is the one setting, and the tower visibly widens or narrows your slice.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e6b450', // ACCENTS.amber (docs/STYLE.md)
});
