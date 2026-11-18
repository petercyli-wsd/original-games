import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'grab',
  name: 'Grab',
  tagline: 'Grey wedges you land on turn green. Land on green twice before red.',
  mechanic: 'process',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#5ec4e6', // ACCENTS.sky (docs/STYLE.md)
  revision: { kind: 'new', date: '2026-11-18', note: 'Sonnet-generated, not yet rated by the team. A 16-wedge wheel where landing on grey turns it green, so every miss raises your chance to score twice before red.' },
});
