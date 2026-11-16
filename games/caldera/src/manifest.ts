import { defineManifest } from '@originals/game-sdk';
import facts from './slot-facts.json';

export default defineManifest({
  id: 'caldera',
  name: 'Caldera',
  tagline: 'Pressure builds with every cascade, until the caldera erupts.',
  collection: 'slots',
  mechanic: 'slots',
  status: 'prototype',
  revision: { kind: 'new', date: '2026-11-16', note: 'Volcanic cluster slot with a rising cascade ladder. Sonnet-built, not yet rated by the team.' },
  rtp: facts.rtp,
  maxMultiplier: facts.maxWin,
  volatility: ['high'],
  checkpoints: false,
  accent: '#e6b450',
});
