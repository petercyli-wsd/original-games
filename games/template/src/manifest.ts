import { defineManifest } from '@originals/game-sdk';
import { MODE_NAMES, RTP, maxMultiplier } from './math';

export default defineManifest({
  id: 'template',
  name: 'Arc Climb',
  tagline: 'Land the needle in the arc. The arc is your odds.',
  mechanic: 'geometry',
  status: 'template',
  rtp: RTP,
  maxMultiplier: Math.max(...MODE_NAMES.map(maxMultiplier)),
  volatility: MODE_NAMES,
  checkpoints: true,
  accent: '#7c5cff',
});
