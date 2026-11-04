import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'showdown',
  name: 'Showdown',
  tagline: "Your even cards against the house's odd cards, one flip a round for 7 rounds. Played cards don't come back, so every win spends a card.",
  mechanic: 'combinatorics',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high'],
  checkpoints: true,
  accent: '#7b93ff', // ACCENTS.blue (docs/STYLE.md)
  revision: {
    kind: 'new',
    date: '2026-11-02',
    note: 'Each round you and the house flip a card from your face-down piles; the higher card takes the round, and you win if you take enough of the 7 rounds.',
  },
});
