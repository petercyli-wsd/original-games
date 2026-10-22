import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BETS,
  MAX_N,
  MIN_N,
  OMEGA_COUNTS,
  PAUSES,
  RANGE,
  RTP,
  TRIAL_PRIMES,
  baseChance,
  candidateMask,
  cashOut,
  decided,
  finalOmegas,
  finish,
  fork,
  isCandidateRemainder,
  maxRemainder,
  odds,
  pausesAfter,
  prize,
  startTrial,
  step,
  winnerMask,
  wins,
  type Bet,
  type Trial,
} from './math';

const rng = createRng(seededSource(11));

/** Ω(n) by naive trial division, independent of the sieve. */
function naiveOmega(n: number): number {
  let count = 0;
  for (let d = 2; d * d <= n; d++) {
    while (n % d === 0) {
      n /= d;
      count++;
    }
  }
  return count + (n > 1 ? 1 : 0);
}

/**
 * What a player watching textbook trial division sees, as tokens: h (p
 * divides), m (p doesn't, move on), E<r> (p² > remainder, stop on r).
 */
function observe(n: number): string[] {
  const out: string[] = [];
  let m = n;
  for (const p of [...TRIAL_PRIMES, 101]) {
    if (p * p > m) break;
    while (m % p === 0) {
      out.push('h');
      m /= p;
    }
    out.push('m');
  }
  out.push(`E${m}`);
  return out;
}

/** The observation after each game step: one test, plus the stop if the guard ends the run right after it. */
function stepKeys(n: number): string[] {
  const obs = observe(n);
  const keys: string[] = [];
  let k = 0;
  let key = '';
  while (k < obs.length) {
    key += obs[k];
    if (obs[k][0] !== 'E' && obs[k + 1]?.[0] === 'E') key += obs[++k];
    k++;
    keys.push(key);
  }
  return keys;
}

const stateKey = (t: Trial) => `${t.found}|${t.i}|${t.lo}|${t.done}|${t.factors.join('.')}`;

interface Group {
  state: Trial;
  members: number[];
}

/** Replays every N and groups them by what the player has seen after each step. */
function replayAll(): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (let n = MIN_N; n <= MAX_N; n++) {
    const keys = stepKeys(n);
    let t = startTrial();
    for (const key of keys) {
      t = step(t, n);
      const g = groups.get(key);
      if (g) {
        // Same observations must give the same state.
        expect(stateKey(g.state)).toBe(stateKey(t));
        g.members.push(n);
      } else groups.set(key, { state: t, members: [n] });
    }
    expect(t.done).toBe(true);
    expect(t.found).toBe(n);
  }
  return groups;
}

const groups = replayAll();

/** Reachable live states, sampled. */
const liveStates = [...groups.values()].filter((g) => !g.state.done).map((g) => g.state);

describe('Factor maths', () => {
  it('the sieve counts match naive factoring and the known prime count π(9999) = 1229', () => {
    expect(OMEGA_COUNTS.slice(1)).toEqual([1229, 2625, 2569, 1712, 963, 485, 231, 104, 47, 22, 7, 3, 1]);
    expect(OMEGA_COUNTS.reduce((a, b) => a + b, 0)).toBe(RANGE);
    const counts = new Array<number>(14).fill(0);
    for (let n = MIN_N; n <= MAX_N; n++) counts[naiveOmega(n)]++;
    expect(counts).toEqual([...OMEGA_COUNTS]);
  });

  it('the headline win chance matches a direct simulation of the raw draw', () => {
    const rounds = 40_000;
    const tally = new Map<Bet, number>(BETS.map((b) => [b, 0]));
    for (let r = 0; r < rounds; r++) {
      const w = naiveOmega(MIN_N + rng.int(RANGE));
      for (const b of BETS) if (wins(b, w)) tally.set(b, tally.get(b)! + 1);
    }
    for (const b of BETS) {
      const p = baseChance(b);
      expect(Math.abs(tally.get(b)! / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-9);
    }
  });

  it('the candidates of every reachable state are exactly the N that replay the same observations', () => {
    expect(groups.size).toBeGreaterThan(1000);
    for (const { state, members } of groups.values()) {
      for (const bet of [1, 2, 4, 7, 10] as Bet[]) {
        const o = odds(state, bet);
        expect(o.total).toBe(members.length);
        expect(o.win).toBe(members.filter((n) => wins(bet, naiveOmega(n))).length);
      }
      for (const n of members) {
        expect(n % state.found).toBe(0);
        expect(isCandidateRemainder(state, n / state.found)).toBe(true);
      }
    }
  });

  it('each division is a fair bet: E[cash-out after the step] = cash-out before', () => {
    const sample = liveStates.filter((_, k) => k % 3 === 0).concat(startTrial());
    for (const t of sample) {
      // Enumerate the candidates and step each one: the exact one-step distribution.
      const next = new Map<string, { t: Trial; w: number }>();
      const hi = maxRemainder(t);
      for (let m = t.lo; m <= hi; m++) {
        if (!isCandidateRemainder(t, m)) continue;
        const s = step(t, m * t.found);
        const key = stateKey(s);
        const e = next.get(key);
        if (e) e.w++;
        else next.set(key, { t: s, w: 1 });
      }
      for (const bet of BETS) {
        let total = 0;
        let ev = 0;
        for (const { t: s, w } of next.values()) {
          total += w;
          ev += w * cashOut(s, bet);
        }
        expect(ev / total).toBeCloseTo(cashOut(t, bet), 10);
        const f = fork(t, bet)!;
        const c = odds(t, bet).chance;
        expect(f.pHit * f.ifHit + (1 - f.pHit) * f.ifMiss).toBeCloseTo(c, 12);
      }
    }
    expect(cashOut(startTrial(), 5)).toBeCloseTo(RTP, 12);
  });

  it('the fork shown before a division is the true split of the candidates', () => {
    for (const t of liveStates.filter((_, k) => k % 7 === 0)) {
      const p = TRIAL_PRIMES[t.i];
      const hi = maxRemainder(t);
      let all = 0;
      let hit = 0;
      for (let m = t.lo; m <= hi; m++) {
        if (!isCandidateRemainder(t, m)) continue;
        all++;
        const divides = m % p === 0;
        // The game's step agrees: a hit raises p's exponent.
        expect(step(t, m * t.found).exps[t.i] > t.exps[t.i]).toBe(divides);
        if (divides) hit++;
      }
      expect(fork(t, 3)!.pHit).toBeCloseTo(hit / all, 12);
    }
  });

  it('the lit cells and the green bars are exactly the win chance', () => {
    for (const bet of BETS) {
      const winMask = winnerMask(bet);
      for (const t of liveStates.filter((_, k) => k % 5 === 0)) {
        const cand = candidateMask(t);
        let lit = 0;
        let all = 0;
        for (let n = 0; n <= MAX_N; n++) {
          if (!cand[n]) continue;
          all++;
          if (winMask[n]) lit++;
        }
        const o = odds(t, bet);
        expect(all).toBe(o.total);
        expect(lit).toBe(o.win);
        const bars = finalOmegas(t);
        const green = bars.reduce((s, c, w) => s + (wins(bet, w) ? c : 0), 0);
        expect(green / bars.reduce((a, b) => a + b, 0)).toBeCloseTo(o.chance, 12);
      }
    }
  });

  it('every pause setting and stopping rule returns exactly RTP (exact enumeration over N)', () => {
    for (const bet of [1, 2, 4, 7, 9] as Bet[]) {
      const full = prize(bet);
      for (const pause of PAUSES) {
        for (const rule of ['end', 'first', 'third', 'cut', 'lock'] as const) {
          let total = 0;
          for (let n = MIN_N; n <= MAX_N; n++) {
            let t = startTrial();
            let cps = 0;
            let pay = -1;
            while (pay < 0) {
              const before = t;
              t = step(t, n);
              const o = odds(t, bet);
              if (decided(o)) pay = o.win ? full : 0;
              else if (pausesAfter(pause, before, t)) {
                cps++;
                const stop =
                  (rule === 'first' && cps === 1) ||
                  (rule === 'third' && cps === 3) ||
                  (rule === 'cut' && o.chance < 0.6 * baseChance(bet)) ||
                  (rule === 'lock' && o.chance > Math.min(0.9, 2 * baseChance(bet)));
                if (stop) pay = full * o.chance;
              }
            }
            total += pay;
          }
          expect(total / RANGE).toBeCloseTo(RTP, 9);
        }
      }
    }
  });

  it('a finished run reveals N and its full factorisation', () => {
    for (let k = 0; k < 200; k++) {
      const n = MIN_N + rng.int(RANGE);
      const t = finish(startTrial(), n);
      expect(t.found).toBe(n);
      expect(t.factors.reduce((a, b) => a * b, 1)).toBe(n);
      expect(t.factors.length).toBe(naiveOmega(n));
    }
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
