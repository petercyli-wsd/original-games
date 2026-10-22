import { defineEval } from '@originals/game-sdk';
import { RISKS, playRound, rtpOf, type Risk } from './math';

// Diamonds has no in-round choices, so the player's only decision is the risk
// table. One config per table, plus a session that switches risk at random
// between rounds (as a player tinkering with the knob would). Every table is
// exactly 98%, and each config declares its own exact RTP from the enumeration.
type Params = { risk: Risk | 'mixed' };

export default defineEval<Params>({
  configs: [
    { label: 'low (Low risk)', params: { risk: 'low' }, rtp: rtpOf('low') },
    { label: 'medium (Classic)', params: { risk: 'classic' }, rtp: rtpOf('classic') },
    { label: 'high (High risk)', params: { risk: 'high' }, rtp: rtpOf('high') },
    { label: 'mixed (risk switched each round)', params: { risk: 'mixed' }, rtp: rtpOf('classic') },
  ],
  playRound({ risk }, rng) {
    const r = risk === 'mixed' ? RISKS[Math.floor(rng.next() * RISKS.length)] : risk;
    return { multiplier: playRound(rng.next, r).multiplier, steps: 1 };
  },
});
