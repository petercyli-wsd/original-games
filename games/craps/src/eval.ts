import { defineEval, type Rng } from '@originals/game-sdk';
import { playStrategy, roundDollars, type FieldPays, type OddsLimit, type Strategy } from './math';

// Craps bets carry different edges, so every config declares its exact rtp.
// A config is a family of strategies a real player uses; each round picks one
// uniformly (bet mix, odds taken, whether one-roll bets stay up, the field
// variant) and scales it by a random chip count.
//
// The stake of a round is not fixed: odds go down only once a point is set,
// and one-roll bets that stay up are staked again on every roll. So the eval
// measures return per unit staked, the RTP the wallet sees: each round's
// return is divided by the strategy's exact expected stake E[wagered]
// (roundDollars), which makes the mean E[returned] / E[wagered]. For a fixed
// stake (flat line bets, come-out props) this is just returned / wagered.
// Scaling cancels, so the config's RTP is the plain mean of its strategies'
// exact RTPs.

const S = (p: Partial<Strategy>): Strategy => ({ pass: 0, dontPass: 0, odds: null, props: {}, propsStay: false, field: 'double', ...p });
const ODDS: OddsLimit[] = ['1x', '2x', '345x', '5x', '10x'];
const FIELDS: FieldPays[] = ['double', 'triple'];

export const FAMILIES: { label: string; strategies: Strategy[] }[] = [
  {
    label: 'low (Pass / Don’t Pass, flat)',
    strategies: [S({ pass: 1 }), S({ dontPass: 1 }), S({ pass: 2, dontPass: 1 })],
  },
  {
    label: 'medium (line bets with odds)',
    strategies: [...ODDS.map((odds) => S({ pass: 1, odds })), ...ODDS.slice(0, 3).map((odds) => S({ dontPass: 1, odds }))],
  },
  {
    label: 'high (field, any craps, any 7 with the line)',
    strategies: [
      ...FIELDS.map((field) => S({ props: { field: 1 }, field })),
      ...FIELDS.map((field) => S({ pass: 1, props: { field: 1 }, propsStay: true, field })),
      S({ pass: 4, props: { anyCraps: 1 } }),
      S({ dontPass: 4, props: { any7: 1 } }),
      S({ pass: 2, odds: '2x', props: { field: 1, anyCraps: 1 }, propsStay: true, field: 'triple' }),
      S({ props: { any7: 1 } }),
      S({ props: { anyCraps: 1 } }),
    ],
  },
  {
    label: 'extreme (hop bets: aces, twelve, yo)',
    strategies: [S({ props: { aces: 1 } }), S({ props: { twelve: 1 } }), S({ props: { aces: 1, twelve: 1 } }), S({ props: { yo: 1, aces: 2 } })],
  },
];

export const configRtp = (sts: Strategy[]) => sts.reduce((a, st) => a + roundDollars(st).rtp, 0) / sts.length;

const pick = <T>(rng: Rng, xs: readonly T[]) => xs[rng.int(xs.length)];

function scale(st: Strategy, k: number): Strategy {
  const props: Strategy['props'] = {};
  for (const [id, v] of Object.entries(st.props)) props[id as keyof Strategy['props']] = (v ?? 0) * k;
  return { ...st, pass: st.pass * k, dontPass: st.dontPass * k, props };
}

export default defineEval<{ family: number }>({
  configs: FAMILIES.map((f, i) => ({ label: f.label, params: { family: i }, rtp: configRtp(f.strategies) })),
  playRound({ family }, rng) {
    const base = pick(rng, FAMILIES[family].strategies);
    const st = scale(base, 1 + rng.int(5));
    const { returned, rolls } = playStrategy(st, () => 2 + rng.int(6) + rng.int(6));
    return { multiplier: returned / roundDollars(st).wagered, steps: rolls };
  },
});
