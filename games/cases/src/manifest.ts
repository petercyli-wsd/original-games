import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'cases',
  name: 'Cases',
  tagline: 'Pick a case and open it. The reel stops on your prize, from 0× up to 10,000×.',
  mechanic: 'other',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  revision: { kind: 'improved', date: '2026-11-13', note: 'Stake Cases tables value for value (7/11/15/19 items, 98% RTP, up to 10,000x on Expert); one case per bet.' },
  accent: '#e879b9', // ACCENTS.pink (docs/STYLE.md)
});
