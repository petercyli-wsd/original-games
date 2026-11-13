import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'stepladder-v2',
  name: 'Stepladder v2',
  tagline: 'Back one of four dice; it rolls off against each of the other three, biggest first, and must win all three. Highest roll wins, ties go to the bigger die.',
  mechanic: 'dice',
  status: 'prototype',
  revision: { kind: 'improved', date: '2026-11-12', note: 'Sonnet-generated, not yet rated by the team. Fixes the team comment "we shouldn\'t have later rounds getting harder": the duels now go biggest die first.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#5ec4e6', // ACCENTS.sky (docs/STYLE.md)
});
