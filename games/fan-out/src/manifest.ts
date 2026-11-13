import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'fan-out',
  name: 'Fan Out',
  tagline: 'Turn cards: one next to the end of its suit’s row is laid, any other burns a fuse. Lay your target before the third fuse.',
  mechanic: 'combinatorics',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#7b93ff', // ACCENTS.blue (docs/STYLE.md)
  revision: { kind: 'new', date: '2026-11-13', note: 'Sonnet-generated, not yet rated by the team. Cards are turned from a Sevens-style deck: a card next to the end of its suit’s row is laid, any other burns a fuse, and you win by laying your target number of cards before the third fuse.' },
});
