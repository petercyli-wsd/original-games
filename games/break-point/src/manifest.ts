import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'break-point',
  name: 'Break Point',
  tagline: 'Back the returner: the server wins each point with the share you pick. Win four points and lead by two.',
  mechanic: 'process',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e6b450', // ACCENTS.amber (docs/STYLE.md)
  revision: { kind: 'new', date: '2026-11-11', note: 'Sonnet-generated, not yet rated by the team. A tennis-style race: you pick the server\'s share, first to 4 points two clear wins; cash out between points.' },
});
