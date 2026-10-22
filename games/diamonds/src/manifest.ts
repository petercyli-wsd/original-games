import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'diamonds',
  name: 'Diamonds',
  tagline: 'Five gems drop. Match colours like a poker hand: pairs, full houses, five of a kind.',
  mechanic: 'other',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high'],
  checkpoints: false,
  accent: '#2dd4bf',
});
