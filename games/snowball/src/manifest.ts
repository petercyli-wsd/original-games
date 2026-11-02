import { defineManifest } from '@originals/game-sdk';
import { RTP, maxMultiplier } from './math';

export default defineManifest({
  id: 'snowball',
  name: 'Snowball',
  tagline: 'Every ball you draw goes back with a twin. Blue needs 6 of the 11 draws.',
  mechanic: 'urn',
  status: 'prototype',
  revision: { kind: 'improved', date: '2026-11-02', note: 'Each drawn ball now visibly goes back with a twin, an 11-slot tally shows the race to 6 blue or red draws, Bet no longer draws, and the urn preset is the one setting.' },
  rtp: RTP,
  maxMultiplier: maxMultiplier(),
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#7dd3fc',
});
