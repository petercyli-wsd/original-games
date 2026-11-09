// Fairness audit: can any way of playing Majority beat the RTP?
//
// A round, as Game.tsx plays it (manual and Auto share newRound/advance):
// the call order is shuffled at the bet (rng.shuffle), then each call draws
// the next region's colour with callRegion(rng.next(), p). After every call
// that doesn't decide the bet there is a checkpoint where the player can
//   - cash out at prize × winChance(bet);
//   - switch side or line: relock() keeps the cash-out and sets
//     prize' = cash / P(new bet), refused onto a decided bet or above MAX_WIN;
//   - call the next region (shown in advance, with both outcomes' odds).
// Every one of those must leave E[cash-out after the next event] equal to the
// cash-out now. That is checked exactly here (the next call has two outcomes)
// at 30+ reached states, for every action, including late states and
// near-cap prizes after long-shot switches.
//
// Strategies, per eval config, against RTP:
//   (a) the tester's: call only while the next call is ≥ 80% likely not to
//       lower the cash-out, else cash out;
//   (b) take any profit: cash out the moment the cash-out is above the bet;
//   (c) call to the end;
//   (d) long-shot switcher: at every checkpoint switch to the allowed bet with
//       the biggest prize (the most volatile), then call, to the end;
//   (e) greedy switcher: at every checkpoint switch to the bet whose next call
//       is likeliest to raise it, and take any profit.
// Long-shot prizes reach the 1,000× cap, so (d) is heavy-tailed: the default
// run checks 4 SE at a few thousand rounds, FAIRNESS_FULL=1 runs each cell
// until SE ≤ 0.3% or a round cap (scratch fairness/run-full.sh). The exact
// martingale check is the binding test.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  LINES,
  MAPS,
  MAP_KEYS,
  MAX_WIN,
  RTP,
  SIDES,
  callRegion,
  decided,
  emptyCalls,
  finalDist,
  maxStartPrize,
  relock,
  startChance,
  winChance,
  winsAt,
  type Bet,
  type Call,
  type MapDef,
  type MapKey,
} from './math';

const FULL = !!import.meta.env.FAIRNESS_FULL;
const BETS: Bet[] = SIDES.flatMap((side) => LINES.map((line) => ({ side, line })));
const same = (a: Bet, b: Bet) => a.side === b.side && a.line === b.line;

interface State {
  map: MapKey;
  bet: Bet;
  prize: number;
  calls: Call[];
  order: number[];
  /** order[k] is called next. */
  k: number;
}

const mapOf = (s: State): MapDef => MAPS[s.map];
const cashOf = (s: State) => s.prize * winChance(mapOf(s), s.calls, s.bet);

/** The value of a state right after a call: settled if decided, else the cash-out. */
function valueAfter(s: State, calls: Call[], bet = s.bet, prize = s.prize): number {
  const dec = decided(mapOf(s), calls, bet);
  return dec ? (dec === 'win' ? prize : 0) : prize * winChance(mapOf(s), calls, bet);
}

/** Exact E[value after the next call], from the two outcomes. */
function nextCallValue(s: State, bet = s.bet, prize = s.prize): number {
  const m = mapOf(s);
  const j = s.order[s.k];
  const p = m.regions[j].p;
  const withCall = (c: Call) => {
    const calls = s.calls.slice();
    calls[j] = c;
    return valueAfter(s, calls, bet, prize);
  };
  return p * withCall('B') + (1 - p) * withCall('R');
}

/** P(the next call does not lower the cash-out). */
function pNotDown(s: State, bet = s.bet, prize = s.prize): number {
  const m = mapOf(s);
  const j = s.order[s.k];
  const p = m.regions[j].p;
  const now = prize * winChance(m, s.calls, bet);
  let q = 0;
  for (const c of ['B', 'R'] as const) {
    const calls = s.calls.slice();
    calls[j] = c;
    if (valueAfter(s, calls, bet, prize) >= now - 1e-12) q += c === 'B' ? p : 1 - p;
  }
  return q;
}

/** What the player does at a checkpoint: optionally switch, then cash out or call. */
type Policy = (s: State) => { switchTo?: Bet; stop: boolean };

/** A new round as Game.tsx's newRound(): prize from the start chance, order shuffled at the bet. */
function newRound(map: MapKey, bet: Bet, rng: Rng): State {
  const m = MAPS[map];
  return { map, bet, prize: RTP / startChance(map, bet), calls: emptyCalls(m), order: rng.shuffle(m.regions.map((_, i) => i)), k: 0 };
}

/** One call as Game.tsx's advance(). Returns the verdict for the current bet. */
function advance(s: State, rng: Rng): 'win' | 'lose' | null {
  const m = mapOf(s);
  const j = s.order[s.k];
  s.calls[j] = callRegion(rng.next(), m.regions[j].p);
  s.k++;
  return decided(m, s.calls, s.bet);
}

/** Switch as Game.tsx's switchTo(): relock or refuse. Returns whether it happened. */
function trySwitch(s: State, nb: Bet): boolean {
  if (same(nb, s.bet)) return false;
  const prize = relock(cashOf(s), mapOf(s), s.calls, nb);
  if (prize === null) return false;
  s.bet = nb;
  s.prize = prize;
  return true;
}

function playRound(map: MapKey, bet: Bet, policy: Policy, rng: Rng): number {
  const s = newRound(map, bet, rng);
  for (;;) {
    const dec = advance(s, rng);
    if (dec) return dec === 'win' ? s.prize : 0;
    const act = policy(s);
    if (act.switchTo) trySwitch(s, act.switchTo);
    if (act.stop) return cashOf(s);
  }
}

/** The allowed switch with the biggest prize (the longest shot under the cap), if any beats the current one. */
function longShot(s: State): Bet | undefined {
  const cash = cashOf(s);
  let best: Bet | undefined;
  let bestPrize = s.prize;
  for (const b of BETS) {
    if (same(b, s.bet)) continue;
    const pr = relock(cash, mapOf(s), s.calls, b);
    if (pr !== null && pr > bestPrize) {
      best = b;
      bestPrize = pr;
    }
  }
  return best;
}

/** The allowed bet whose next call is likeliest not to lower its cash-out. */
function greedy(s: State): Bet | undefined {
  const cash = cashOf(s);
  let best: Bet | undefined;
  let bestQ = pNotDown(s);
  for (const b of BETS) {
    if (same(b, s.bet)) continue;
    const pr = relock(cash, mapOf(s), s.calls, b);
    if (pr === null) continue;
    const q = pNotDown(s, b, pr);
    if (q > bestQ + 1e-12) {
      best = b;
      bestQ = q;
    }
  }
  return best;
}

const STRATEGIES: { name: string; policy: Policy }[] = [
  { name: '(a) call while ≥ 80% not down', policy: (s) => ({ stop: pNotDown(s) < 0.8 }) },
  { name: '(b) take any profit', policy: (s) => ({ stop: cashOf(s) > 1 }) },
  { name: '(c) call to the end', policy: () => ({ stop: false }) },
  { name: '(d) long-shot switcher', policy: (s) => ({ switchTo: longShot(s), stop: false }) },
  {
    name: '(e) greedy switch + any profit',
    policy: (s) => {
      const nb = greedy(s);
      if (nb) trySwitch(s, nb);
      return { stop: cashOf(s) > 1 };
    },
  },
];

function mc(play: (rng: Rng) => number, rounds: number, seed: number, adaptive = false, maxRounds = 10_000_000) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let n = 0;
  let max = 0;
  const stat = () => {
    const mean = s / n;
    return { mean, se: Math.sqrt(Math.max(0, s2 / n - mean * mean) / n), max, n };
  };
  for (;;) {
    const goal = n + (n < rounds ? rounds - n : 100_000);
    for (; n < goal; n++) {
      const x = play(rng);
      s += x;
      s2 += x * x;
      if (x > max) max = x;
    }
    if (!adaptive || stat().se <= 0.003 || n >= maxRounds) return stat();
  }
}

/** Checkpoints met in random rounds on every map, with random switches (some to long shots, so near the cap). */
function reachedStates(count: number, rng: Rng): State[] {
  const out: State[] = [];
  while (out.length < count) {
    const map = MAP_KEYS[rng.int(MAP_KEYS.length)];
    const s = newRound(map, BETS[rng.int(BETS.length)], rng);
    const switchy = rng.next();
    for (;;) {
      if (advance(s, rng)) break;
      if (switchy < 0.3) {
        const ls = longShot(s);
        if (ls) trySwitch(s, ls);
      } else if (switchy < 0.6 && rng.next() < 0.3) trySwitch(s, BETS[rng.int(BETS.length)]);
      // Keep a varied mix, weighted towards late states.
      if (rng.next() < 0.15 + 0.5 * (s.k / s.order.length)) out.push({ ...s, calls: s.calls.slice(), bet: { ...s.bet } });
    }
  }
  return out;
}

/** States whose prize has been pushed near the cap by long-shot switches. */
function nearCapStates(count: number, rng: Rng): State[] {
  const out: State[] = [];
  for (let tries = 0; out.length < count && tries < 200_000; tries++) {
    const s = newRound(MAP_KEYS[rng.int(MAP_KEYS.length)], BETS[rng.int(BETS.length)], rng);
    for (;;) {
      if (advance(s, rng)) break;
      const ls = longShot(s);
      if (ls) trySwitch(s, ls);
      if (s.prize > MAX_WIN / 4) {
        out.push({ ...s, calls: s.calls.slice(), bet: { ...s.bet } });
        break;
      }
    }
  }
  return out;
}

describe('Majority fairness', () => {
  it('martingale (exact): at 30+ reached states, calling next, switching to any bet, and cashing out all keep E[cash-out] = cash-out now', () => {
    const rng = createRng(seededSource(71));
    const states = [...reachedStates(60, rng), ...nearCapStates(8, rng)];
    expect(new Set(states.map((s) => s.map)).size).toBe(MAP_KEYS.length);
    expect(states.some((s) => s.order.length - s.k <= 2)).toBe(true);
    expect(states.some((s) => s.prize > MAX_WIN / 4)).toBe(true);
    // Every fresh bet's prize sits under the cap too (the largest is Heartland Red 65+, about 37×).
    expect(maxStartPrize()).toBeLessThanOrEqual(MAX_WIN);

    for (const s of states) {
      const m = mapOf(s);
      const v = cashOf(s);
      expect(decided(m, s.calls, s.bet)).toBeNull();
      expect(v).toBeLessThanOrEqual(s.prize);
      expect(s.prize).toBeLessThanOrEqual(MAX_WIN);

      // The cached, short-circuited winChance equals the raw distribution's mass on winning totals.
      const d = finalDist(m, s.calls);
      let raw = 0;
      for (let t = 0; t <= 100; t++) if (winsAt(t, s.bet)) raw += d[t];
      expect(Math.abs(raw - winChance(m, s.calls, s.bet))).toBeLessThan(1e-12);

      // Call next.
      expect(Math.abs(nextCallValue(s) - v)).toBeLessThan(1e-9 * Math.max(1, v));

      // Switch to each other bet: the value is kept, and calling next after the switch is fair too.
      for (const nb of BETS) {
        if (same(nb, s.bet)) continue;
        const pr = relock(v, m, s.calls, nb);
        if (pr === null) {
          const dec = decided(m, s.calls, nb);
          if (!dec) expect(v / winChance(m, s.calls, nb)).toBeGreaterThan(MAX_WIN);
          continue;
        }
        expect(pr).toBeLessThanOrEqual(MAX_WIN);
        const v2 = pr * winChance(m, s.calls, nb);
        expect(Math.abs(v2 - v)).toBeLessThan(1e-12 * Math.max(1, v));
        expect(Math.abs(nextCallValue(s, nb, pr) - v)).toBeLessThan(1e-9 * Math.max(1, v));
      }
    }
  });

  it('the drawn colour has exactly the shown chance: callRegion(u, p) is Blue iff u < p, u uniform on [0, 1)', () => {
    for (const k of MAP_KEYS) {
      for (const r of MAPS[k].regions) {
        expect(callRegion(0, r.p)).toBe('B');
        expect(callRegion(r.p - 1e-12, r.p)).toBe('B');
        expect(callRegion(r.p, r.p)).toBe('R');
        expect(callRegion(1 - 2 ** -32, r.p)).toBe('R');
      }
    }
  });

  it('the call order is independent of the colours: every region is equally likely to be called first', () => {
    const rng = createRng(seededSource(72));
    const m = MAPS.tossup;
    const counts = new Array(m.regions.length).fill(0);
    const n = 90_000;
    for (let i = 0; i < n; i++) counts[newRound('tossup', BETS[0], rng).order[0]]++;
    const p = 1 / m.regions.length;
    for (const c of counts) expect(Math.abs(c / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
  });

  it('strategies (a)–(e) on every eval config return RTP within 4 SE and never pay above MAX_WIN', () => {
    const rows: string[] = [];
    // Full runs are slow (~50 µs a round), so run-full can split them: FAIRNESS_CELL="ci:si" runs one cell.
    const only = import.meta.env.FAIRNESS_CELL as string | undefined;
    const maxRounds = Number(import.meta.env.FAIRNESS_MAX ?? 3_000_000);
    evalSpec.configs.forEach(({ label, params: { map, bet } }, ci) => {
      STRATEGIES.forEach(({ name, policy }, si) => {
        if (only && only !== `${ci}:${si}`) return;
        const { mean, se, max, n } = mc((r) => playRound(map, bet, policy, r), FULL ? 200_000 : 2_500, 9700 + 17 * ci + si, FULL, maxRounds);
        rows.push(`${label.padEnd(36)} ${name.padEnd(32)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  n ${n}  max ${max.toFixed(1)}×`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
        expect(max).toBeLessThanOrEqual(MAX_WIN);
      });
    });
    if (FULL) console.log(rows.join('\n'));
  });
});
