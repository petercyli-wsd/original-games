import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'hot-potato',
  name: 'Hot Potato',
  tagline: 'Spin the fuse: red blows the bomb where it sits, green hops it to a neighbour. Win if it blows on your seats.',
  mechanic: 'process',
  status: 'prototype',
  revision: { kind: 'improved', date: '2026-11-02', note: 'Each spin of a fuse dial now decides whether the bomb blows or hops, and one setting picks how many seats you back.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#ff6b35',
});
