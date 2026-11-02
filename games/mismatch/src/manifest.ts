import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'mismatch',
  name: 'Mismatch',
  tagline: 'Eight numbered tokens drop at random into eight numbered slots. Bet on how many land in their own slot. No matches at all happens 1/e of the time.',
  mechanic: 'combinatorics',
  status: 'retired',
  revision: { kind: 'improved', date: '2026-11-02', note: "Eight slots filled in order, one target choice in plain words, and a cleaner board: the bag wheel shows the next slot's matching token." },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#ffcad4',
});
