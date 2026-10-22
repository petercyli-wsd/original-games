import { defineManifest } from '@originals/game-sdk';
import { ACCENT, MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'blackjack',
  name: 'Blackjack',
  tagline: 'Beat the dealer to 21. Blackjack pays 3:2, dealer stands on soft 17, with Pairs and 21+3 side bets.',
  mechanic: 'table',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: ACCENT,
});
