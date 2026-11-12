import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'last-wicket-v2',
  name: 'Last Wicket v2',
  tagline: 'Score the runs before the balls run out. Before each ball, pick the safe wheel or the big-hitting one.',
  mechanic: 'process',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e6b450', // ACCENTS.amber (docs/STYLE.md)
  revision: { kind: 'improved', date: '2026-11-12', note: 'Sonnet-generated, not yet rated by the team. Fixes the team comment "number of balls remaining is not shown clearly and not v clear what the numbers mean": balls left and every number are now labelled in plain words.' },
});
