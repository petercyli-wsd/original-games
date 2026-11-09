// Fairness audit: can any way of playing Snowball beat the RTP?
//
// A round is a Pólya urn: each draw takes a uniform ball out of the urn and
// puts it back with a twin. The only choice during a round is when to stop
// (the urn preset is fixed at the bet and disabled while live). The cash-out
// after b blue and r red draws is M · P(blue wins | b, r), so the claim "cash
// out whenever the next step looks bad" fails exactly when, at every live
// state, the urn-weighted average of the two possible next cash-outs equals
// the cash-out now. That is checked below by enumerating every ball in the
// real reducer's urn (every index the UI could draw), at every live state of
// every preset.
//
// Strategies, per eval config (one preset each), played through the real
// reducer with rng.int(balls) exactly as the UI draws:
//   (a) the tester's: draw while the next ball is ≥ 80% likely blue, else cash
//       out (the first draw is forced: nothing can be cashed before it);
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) play to the end (11 draws or a colour reaching 6);
//   (d) momentum: keep drawing after a blue, cash out right after a red
//       ("the urn is snowballing against me");
//   (e) lock a lead: cash out once blue leads by two draws.
// Every rule is also valued exactly by summing over the urn's paths, which is
// the binding check on the Longshot preset (a 39.78× shot whose Monte Carlo
// needs millions of rounds for a 0.3% standard error; the audit's heavy run
// sets FAIRNESS_ROUNDS).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { currentCash, drawnCounts, initialState, reducer, settledValue, type GameState } from './game';
import { MAJORITY, PRESET_IDS, RTP, cashMultiplier, urnAfter, type PresetId } from './math';

/** Rounds per strategy run; the audit's heavy run sets FAIRNESS_ROUNDS=200000 or more. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 4_000);

interface View {
  preset: PresetId;
  b: number;
  r: number;
  /** Colour of the last draw (null before the first). */
  last: 'blue' | 'red' | null;
  /** Cash-out now. */
  v: number;
}
/** True = cash out now. Only asked after the first draw. */
type Stop = (s: View) => boolean;

const pBlueNext = (s: View) => {
  const { blue, red } = urnAfter(s.preset, s.b, s.r);
  return blue / (blue + red);
};

const STRATEGIES: Record<string, Stop> = {
  'a tester (draw only if ≥ 80% blue)': (s) => pBlueNext(s) < 0.8,
  'b take any profit': (s) => s.v > 1,
  'c play to the end': () => false,
  'd momentum (cash after a red)': (s) => s.last === 'red',
  'e lock a two-draw lead': (s) => s.b - s.r >= 2,
};

/** Draw one ball through the reducer, as the UI does (index chosen at Draw). */
function drawThrough(s: GameState, index: number): GameState {
  s = reducer(s, { type: 'draw', index });
  s = reducer(s, { type: 'twin' });
  return reducer(s, { type: 'apply' });
}

function viewOf(s: GameState): View {
  const round = s.round!;
  const { blue, red } = drawnCounts(round);
  return { preset: round.preset, b: blue, r: red, last: round.history[round.history.length - 1] ?? null, v: currentCash(round) };
}

/** One round through the real reducer; returns the settled multiplier. */
function playRound(preset: PresetId, stop: Stop, rng: Rng): number {
  let s = reducer(initialState(), { type: 'start', bet: 1, preset });
  while (s.phase === 'live') {
    if (s.round!.history.length > 0 && stop(viewOf(s))) {
      s = reducer(s, { type: 'cashOut' });
      break;
    }
    s = drawThrough(s, rng.int(s.round!.balls.length));
  }
  expect(s.phase).toBe('over');
  return s.result!.mult;
}

/** Exact value of a stopping rule: sum over every path of draws. */
function exactValue(preset: PresetId, stop: Stop): number {
  const go = (b: number, r: number, last: View['last'], pr: number): number => {
    if (b >= MAJORITY || r >= MAJORITY) return pr * cashMultiplier(preset, b, r);
    const view: View = { preset, b, r, last, v: cashMultiplier(preset, b, r) };
    if (last !== null && stop(view)) return pr * view.v;
    const q = pBlueNext(view);
    return go(b + 1, r, 'blue', pr * q) + go(b, r + 1, 'red', pr * (1 - q));
  };
  return go(0, 0, null, 1);
}

/** Every live state of a preset, reached through the reducer (deterministic paths). */
function liveStates(preset: PresetId): GameState[] {
  const out: GameState[] = [];
  const seen = new Set<string>();
  const walk = (s: GameState) => {
    if (s.phase !== 'live') return;
    const { blue, red } = drawnCounts(s.round!);
    if (seen.has(`${blue}/${red}`)) return;
    seen.add(`${blue}/${red}`);
    out.push(s);
    const balls = s.round!.balls;
    // One representative index per colour: every blue (red) index leads to the same state.
    const blueAt = balls.indexOf('blue');
    const redAt = balls.indexOf('red');
    if (blueAt >= 0) walk(drawThrough(s, blueAt));
    if (redAt >= 0) walk(drawThrough(s, redAt));
  };
  walk(reducer(initialState(), { type: 'start', bet: 1, preset }));
  return out;
}

describe('Snowball fairness', () => {
  it('martingale: at every live state, averaging over every ball in the urn returns the cash-out now', () => {
    let checked = 0;
    for (const preset of PRESET_IDS) {
      for (const s of liveStates(preset)) {
        const now = settledValue(s);
        expect(now).toBeCloseTo(currentCash(s.round!), 12);
        const n = s.round!.balls.length;
        let ev = 0;
        for (let i = 0; i < n; i++) {
          // Leaving mid-draw settles at the drawn result, the same value as after it lands.
          const mid = reducer(s, { type: 'draw', index: i });
          const after = drawThrough(s, i);
          expect(settledValue(mid)).toBe(settledValue(after));
          ev += settledValue(after) / n;
        }
        expect(Math.abs(ev - now)).toBeLessThan(1e-12);
        checked++;
      }
    }
    // Every (b, r) with b, r < 6 for each of the five presets.
    expect(checked).toBe(PRESET_IDS.length * MAJORITY * MAJORITY);
  });

  it('before the first draw the stake is worth exactly RTP and cannot be cashed', () => {
    for (const preset of PRESET_IDS) {
      const s = reducer(initialState(), { type: 'start', bet: 1, preset });
      expect(settledValue(s)).toBeCloseTo(RTP, 12);
      expect(reducer(s, { type: 'cashOut' })).toBe(s);
    }
  });

  it('every strategy is worth exactly RTP (exact path sums)', () => {
    for (const preset of PRESET_IDS) {
      for (const stop of Object.values(STRATEGIES)) expect(exactValue(preset, stop)).toBeCloseTo(RTP, 12);
    }
  });

  it('every strategy played through the reducer returns RTP within 4 SE', () => {
    const rows: string[] = [];
    let seed = 1;
    for (const cfg of evalSpec.configs) {
      const preset = cfg.params.preset;
      for (const [name, stop] of Object.entries(STRATEGIES)) {
        const rng = createRng(seededSource(1000 + seed++));
        let sum = 0;
        let sum2 = 0;
        for (let i = 0; i < ROUNDS; i++) {
          const m = playRound(preset, stop, rng);
          sum += m;
          sum2 += m * m;
        }
        const mean = sum / ROUNDS;
        const se = Math.sqrt(Math.max(0, sum2 / ROUNDS - mean * mean) / ROUNDS);
        rows.push(`${cfg.label.padEnd(18)} ${name.padEnd(36)} rtp ${(mean * 100).toFixed(3)}% ± ${(se * 100).toFixed(3)}% (exact ${(exactValue(preset, stop) * 100).toFixed(4)}%)`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
      }
    }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(`rounds ${ROUNDS}\n${rows.join('\n')}`);
  });
});
