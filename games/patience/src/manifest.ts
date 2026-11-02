import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'patience',
  name: 'Patience',
  tagline: 'Ten cards are dealt onto piles. A card higher than every pile top opens a new pile; fit the deck in k piles to win.',
  mechanic: 'combinatorics',
  status: 'retired',
  revision: { kind: 'improved', date: '2026-11-02', note: 'Each pile shows its catch band (the values that drop onto it) and the red new-pile band above the last top, so a low card visibly grows the red band; default 3 piles; one headline chance with its bar.' },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#90be6d',
});
