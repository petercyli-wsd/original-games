import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'last-wicket',
  name: 'Last Wicket',
  tagline: 'One wicket left, a few balls to make the runs. Before each ball, pick the safe wheel or the big-hitting one.',
  mechanic: 'process',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e6b450', // ACCENTS.amber (docs/STYLE.md)
  revision: { kind: 'new', date: '2026-11-11', note: 'Sonnet-generated, not yet rated by the team. Make the runs before the balls or your one wicket run out; each ball you pick the safe or the big wheel.' },
});
