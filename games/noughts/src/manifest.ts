import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'noughts',
  name: 'Noughts',
  tagline: 'X and O play at random. Back X, O or a draw, one game or a streak. Every empty cell shows what it does to your odds.',
  mechanic: 'combinatorics',
  status: 'prototype',
  revision: { kind: 'improved', date: '2026-11-13', note: 'Back from the Archive: after the fairness fixes it passed the AI gate on a panel of 3 (3.75), and it is restyled to the flat house style.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#5ec4e6',
});
