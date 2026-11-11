import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'inning',
  name: 'Inning',
  tagline: 'Spin the wheel: an out, or a hit that moves every runner. Score your runs before the third out.',
  mechanic: 'process',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#5ec4e6',
  revision: { kind: 'new', date: '2026-11-09', note: 'Sonnet-generated, not yet rated by the team. Score runs before three outs: each spin is an out or a hit that moves every runner; cash out between spins.' },
});
