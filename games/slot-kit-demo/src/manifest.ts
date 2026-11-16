import { defineManifest } from '@originals/game-sdk';

export default defineManifest({
  id: 'slot-kit-demo',
  name: 'Slot kit demo',
  tagline: 'Throwaway demo of the slot UI kit on a stub engine.',
  mechanic: 'slots',
  status: 'template',
  rtp: 0.96,
  maxMultiplier: 5000,
  volatility: ['medium'],
  checkpoints: false,
  accent: '#e6b450',
});
