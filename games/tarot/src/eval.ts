import { defineEval } from '@originals/game-sdk';
import { RISKS, playRound, rtpOf, type Risk } from './math';

// Tarot has no in-round choices: the player's decisions are the risk deck and
// when to stop playing. One config per deck, plus a session that switches the
// deck at random between rounds and one that chases a loss by moving up a risk
// level (as a player tinkering with the knob would). Every deck is exactly
// 99% (E[card] = ∛0.99), so each config declares the same exact RTP, taken
// from the enumeration of its deck.
type Params = { risk: Risk | 'mixed' | 'chase' };

let chaseLevel = 0;

export default defineEval<Params>({
  configs: [
    { label: 'low (Low deck)', params: { risk: 'low' }, rtp: rtpOf('low') },
    { label: 'medium (Medium deck)', params: { risk: 'medium' }, rtp: rtpOf('medium') },
    { label: 'high (High deck)', params: { risk: 'high' }, rtp: rtpOf('high') },
    { label: 'extreme (Extreme deck)', params: { risk: 'extreme' }, rtp: rtpOf('extreme') },
    { label: 'mixed (deck switched each round)', params: { risk: 'mixed' }, rtp: rtpOf('medium') },
    { label: 'chase (step up risk after a loss)', params: { risk: 'chase' }, rtp: rtpOf('medium') },
  ],
  playRound({ risk }, rng) {
    let r: Risk;
    if (risk === 'mixed') r = RISKS[Math.floor(rng.next() * RISKS.length)];
    else if (risk === 'chase') r = RISKS[chaseLevel];
    else r = risk;
    const { multiplier } = playRound(rng.next, r);
    if (risk === 'chase') chaseLevel = multiplier >= 1 ? 0 : Math.min(RISKS.length - 1, chaseLevel + 1);
    return { multiplier, steps: 1 };
  },
});
