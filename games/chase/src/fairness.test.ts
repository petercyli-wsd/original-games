// Fairness audit: no strategy can beat the RTP.
//
// The cash-out is V = prize × winChance(state), prize = RTP / winChance(start).
// The player never steers: the only decisions are "next turn" or "cash out"
// (Bet plays the first turn at once). So V must be a martingale under the
// turn the game actually plays. A turn has finitely many outcomes (a uniform
// runner step, then a uniform tie-break among the hunter's closer squares),
// so we enumerate them EXACTLY by driving the real playTurn with a scripted
// Rng that walks every branch of its rng.int calls. Then:
//   * the one-step martingale holds at every live state of every setting;
//   * the strategies' RTPs are computed exactly on the chain (Gauss–Seidel on
//     "W = payout if the rule stops, else E[W after the turn]");
//   * a Monte Carlo of the same strategies with the real RNG cross-checks it.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { ALL_SETTINGS, MAX_MULTIPLIER, RTP, moveOdds, playTurn, prizeFor, startState, table, winChance, type Settings, type State, type Table, type Turn } from './math';

/** FAIRNESS_FULL=1 runs 200k-round Monte Carlo per strategy and config. */
const FULL = !!import.meta.env.FAIRNESS_FULL;
const log = (line: string) => FULL && console.log(line);

/** Every outcome of `run` with its exact probability, by walking each branch of its rng.int calls. */
function enumerate<T>(run: (rng: Rng) => T): { p: number; value: T }[] {
  const out: { p: number; value: T }[] = [];
  const todo: number[][] = [[]];
  while (todo.length) {
    const path = todo.pop()!;
    let pos = 0;
    let p = 1;
    const rng: Rng = {
      int(n) {
        if (pos === path.length) {
          for (let c = 1; c < n; c++) todo.push([...path, c]);
          path.push(0);
        }
        p /= n;
        return path[pos++];
      },
      next() {
        throw new Error('playTurn should only use rng.int');
      },
      shuffle() {
        throw new Error('playTurn should only use rng.int');
      },
    };
    const value = run(rng); // before reading p: run() is what divides it
    out.push({ p, value });
  }
  return out;
}

const after = (r: Turn): State => ({ runner: r.runner, hunter: r.hunter, phase: r.phase });
const keyOf = (t: Table, s: State) => (s.runner * t.board.open.length + s.hunter) * t.period + s.phase;
/** Enumerated turn outcomes per state, cached per table and indexed by keyOf. */
const turnCache = new Map<Table, ({ p: number; value: Turn; next: number }[] | undefined)[]>();
function turns(t: Table, s: State) {
  let arr = turnCache.get(t);
  if (!arr) turnCache.set(t, (arr = []));
  const k = keyOf(t, s);
  let o = arr[k];
  if (!o) arr[k] = o = enumerate((rng) => playTurn(t, s, rng)).map(({ p, value }) => ({ p, value, next: value.end ? -1 : keyOf(t, after(value)) }));
  return o;
}

const chanceAfter = (t: Table, r: Turn) => (r.end === 'escaped' ? 1 : r.end === 'caught' ? 0 : winChance(t, after(r)));

/** Every live state of a setting's chain. */
function liveStates(t: Table): State[] {
  const b = t.board;
  const out: State[] = [];
  for (let r = 0; r < b.open.length; r++)
    for (let h = 0; h < b.open.length; h++)
      for (let phase = 0; phase < t.period; phase++)
        if (b.open[r] && b.open[h] && r !== h && r !== b.exit && Number.isFinite(b.dist[h][r])) out.push({ runner: r, hunter: h, phase });
  return out;
}

/** Chance the next turn does not end in a catch (what the tester calls "the next step's chance"). */
const survival = (t: Table, s: State) => turns(t, s).reduce((acc, o) => acc + (o.value.end === 'caught' ? 0 : o.p), 0);

type Rule = (t: Table, s: State, cash: number) => boolean; // true = cash out now
const testers: Rule = (t, s) => survival(t, s) < 0.8;
const takeProfit: Rule = (_t, _s, cash) => cash > 1;
const toTheEnd: Rule = () => false;
/** (d) Bank the high states: cash out once V ≥ 1.5× the bet, or as soon as any next step is fatal. */
const cautious: Rule = (t, s, cash) => cash >= 1.5 || moveOdds(t, s).some((m) => m.p === 0);
/** (d') The opposite: only cash out when the next turn is a coin flip or worse, else ride for the prize. */
const coinFlip: Rule = (t, s) => survival(t, s) <= 0.5;

const RULES: [string, Rule][] = [
  ['(a) tester: play on only when survival ≥ 0.8', testers],
  ['(b) take any profit: cash out once V > bet', takeProfit],
  ['(c) play to the end', toTheEnd],
  ['(d) cash at ≥ 1.5× or when any step is fatal', cautious],
  ["(d') cash only when survival ≤ 0.5", coinFlip],
];

/** Exact RTP of a Markov stopping rule: W(s) = cash(s) if it stops, else E[W after the turn]; Bet plays turn 1 first. */
function exactRtp(settings: Settings, rule: Rule): number {
  const t = table(settings.board, settings.speed);
  const prize = prizeFor(settings);
  const states = liveStates(t);
  const key = (s: State) => keyOf(t, s);
  const stops: boolean[] = [];
  for (const s of states) stops[key(s)] = rule(t, s, prize * winChance(t, s));
  const w = new Float64Array(t.board.open.length ** 2 * t.period);
  for (const s of states) if (stops[key(s)]) w[key(s)] = prize * winChance(t, s);
  const expectNext = (s: State) => {
    let e = 0;
    for (const o of turns(t, s)) e += o.p * (o.value.end === 'escaped' ? prize : o.value.end === 'caught' ? 0 : w[o.next]);
    return e;
  };
  const free = states.filter((s) => !stops[key(s)]);
  const freeKeys = free.map(key);
  for (let sweep = 0; ; sweep++) {
    let change = 0;
    for (let k = free.length - 1; k >= 0; k--) {
      const v = expectNext(free[k]);
      change = Math.max(change, Math.abs(v - w[freeKeys[k]]));
      w[freeKeys[k]] = v;
    }
    if (change < 1e-15) break;
    if (sweep > 100_000) throw new Error('did not converge');
  }
  return expectNext(startState(settings.board, settings.gap));
}

function simulate(settings: Settings, rule: Rule, rng: Rng): number {
  const t = table(settings.board, settings.speed);
  const prize = prizeFor(settings);
  let s = startState(settings.board, settings.gap);
  for (;;) {
    const r = playTurn(t, s, rng);
    if (r.end === 'escaped') return prize;
    if (r.end === 'caught') return 0;
    s = after(r);
    const cash = prize * winChance(t, s);
    if (rule(t, s, cash)) return cash;
  }
}

const CONFIGS = evalSpec.configs;

describe('Chase fairness', () => {
  it('martingale: at every live state of every setting, E[V after the turn] = V (exact enumeration of playTurn)', () => {
    let checked = 0;
    let worst = 0;
    for (const settings of ALL_SETTINGS) {
      const t = table(settings.board, settings.speed);
      const prize = prizeFor(settings);
      expect(prize).toBeLessThanOrEqual(MAX_MULTIPLIER);
      for (const s of liveStates(t)) {
        const outs = turns(t, s);
        expect(outs.reduce((a, o) => a + o.p, 0)).toBeCloseTo(1, 14);
        const ev = outs.reduce((a, o) => a + o.p * chanceAfter(t, o.value), 0);
        const v = winChance(t, s);
        worst = Math.max(worst, Math.abs(ev - v) * prize);
        // The arrows/heat the board shows: each runner step's odds average to V, and match the enumeration.
        const mo = moveOdds(t, s);
        expect(Math.abs(mo.reduce((a, m) => a + m.p, 0) / mo.length - v)).toBeLessThan(1e-12);
        for (const m of mo) {
          const sub = outs.filter((o) => o.value.runner === m.cell);
          const pm = sub.reduce((a, o) => a + o.p, 0);
          expect(pm).toBeCloseTo(1 / mo.length, 14);
          expect(Math.abs(sub.reduce((a, o) => a + o.p * chanceAfter(t, o.value), 0) / pm - m.p)).toBeLessThan(1e-12);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
    // In multiplier units: |E[V'] − V| ≤ 1e-11 everywhere (Gauss–Seidel residual).
    expect(worst).toBeLessThan(1e-11);
  });

  it('martingale along played rounds: random reachable states, including ones a step from a catch or the exit', () => {
    const rng = createRng(seededSource(5));
    let nearEnd = 0;
    let n = 0;
    for (const cfg of CONFIGS) {
      const t = table(cfg.params.board, cfg.params.speed);
      for (let round = 0; round < 40; round++) {
        let s = startState(cfg.params.board, cfg.params.gap);
        for (;;) {
          const outs = turns(t, s);
          const ev = outs.reduce((a, o) => a + o.p * chanceAfter(t, o.value), 0);
          expect(Math.abs(ev - winChance(t, s))).toBeLessThan(1e-12);
          if (outs.some((o) => o.value.end !== null)) nearEnd++;
          n++;
          const r = playTurn(t, s, rng);
          if (r.end) break;
          s = after(r);
        }
      }
    }
    expect(n).toBeGreaterThan(30);
    expect(nearEnd).toBeGreaterThan(10);
  });

  it('adversarial stopping rules return exactly RTP on every eval config (exact, on the chain)', () => {
    for (const cfg of CONFIGS) {
      for (const [name, rule] of RULES) {
        const r = exactRtp(cfg.params, rule);
        log(`exact ${cfg.label} | ${name} | RTP ${(r * 100).toFixed(9)}%`);
        expect(Math.abs(r - RTP), `${cfg.label} ${name}: ${r}`).toBeLessThan(1e-9);
      }
    }
  });

  it('a stop-after-k-turns rule (not Markov) is also exact: E[V after k turns] = RTP for k = 1..12', () => {
    for (const cfg of CONFIGS) {
      const t = table(cfg.params.board, cfg.params.speed);
      const prize = prizeFor(cfg.params);
      // Forward distribution over live states; absorbed mass is banked at its payout.
      let dist = new Map<string, { s: State; p: number }>();
      const s0 = startState(cfg.params.board, cfg.params.gap);
      dist.set('start', { s: s0, p: 1 });
      let banked = 0;
      for (let k = 1; k <= 12; k++) {
        const next = new Map<string, { s: State; p: number }>();
        for (const { s, p } of dist.values()) {
          for (const o of turns(t, s)) {
            if (o.value.end === 'escaped') banked += p * o.p * prize;
            if (o.value.end) continue;
            const a = after(o.value);
            const id = `${a.runner},${a.hunter},${a.phase}`;
            const e = next.get(id);
            if (e) e.p += p * o.p;
            else next.set(id, { s: a, p: p * o.p });
          }
        }
        dist = next;
        let live = 0;
        for (const { s, p } of dist.values()) live += p * prize * winChance(t, s);
        expect(Math.abs(banked + live - RTP)).toBeLessThan(1e-9);
      }
    }
  });

  it('Monte Carlo of the same rules with the real RNG agrees (4 SE)', () => {
    const rng = createRng(seededSource(909));
    const rounds = FULL ? 200_000 : 4_000;
    for (const cfg of CONFIGS) {
      for (const [name, rule] of RULES) {
        let sum = 0;
        let sq = 0;
        for (let r = 0; r < rounds; r++) {
          const x = simulate(cfg.params, rule, rng);
          sum += x;
          sq += x * x;
        }
        const mean = sum / rounds;
        const se = Math.sqrt(Math.max(0, sq / rounds - mean * mean) / rounds);
        log(`MC ${cfg.label} | ${name} | ${rounds} rounds | RTP ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%`);
        expect(Math.abs(mean - RTP), `${cfg.label} ${name}: ${mean} ± ${se}`).toBeLessThan(4 * se + 1e-9);
      }
    }
  });
});
