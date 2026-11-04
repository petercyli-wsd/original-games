import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'stepladder',
  name: 'Stepladder',
  tagline: 'Back one of four dice; it rolls off against each of the other three and must win all three. Highest roll wins, ties go to the bigger die.',
  mechanic: 'dice',
  status: 'prototype',
  revision: { kind: 'new', date: '2026-11-04', note: 'A dice gauntlet: your die duels each of the other three in turn, so every roll you watch decides your bet.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#38bdf8',
});
