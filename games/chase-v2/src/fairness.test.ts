// Fairness audit: no strategy can beat the RTP.
//
// The cash-out is V = prize × winChance(state), prize = RTP / winChance(start).
// The player never steers the runner: the only decisions are "next turn" or
// "cash out", and Bet stops at a checkpoint on the start square (worth RTP).
// So V must be a martingale under the turn the game actually plays. A turn has
// finitely many outcomes (a uniform runner step, then a uniform tie-break
// among the hunter's closer squares), so we enumerate them EXACTLY by driving
// the real playTurn with a scripted Rng that walks every branch of its
// rng.int calls. Then:
//   * the one-step martingale holds at every live state (all four starts);
//   * the arrows' fates and odds (nextSteps) match the enumeration;
//   * the strategies' RTPs are computed exactly on the chain (Gauss–Seidel on
//     "W = payout if the rule stops, else E[W after the turn]");
//   * a Monte Carlo of the same strategies with the real RNG cross-checks it.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { MAX_MULTIPLIER, RTP, STARTS, board, nextSteps, playTurn, prizeFor, startState, winChance, type Start, type State, type Turn } from './math';

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

const N = () => board().open.length;
const after = (r: Turn): State => ({ runner: r.runner, hunter: r.hunter });
const keyOf = (s: State) => s.runner * N() + s.hunter;
const turnCache: ({ p: number; value: Turn; next: number }[] | undefined)[] = [];
function turns(s: State) {
  const k = keyOf(s);
  let o = turnCache[k];
  if (!o) turnCache[k] = o = enumerate((rng) => playTurn(s, rng)).map(({ p, value }) => ({ p, value, next: value.end ? -1 : keyOf(after(value)) }));
  return o;
}

const chanceAfter = (r: Turn) => (r.end === 'escaped' ? 1 : r.end === 'caught' ? 0 : winChance(after(r)));

/** Every live state of the chain. */
function liveStates(): State[] {
  const b = board();
  const out: State[] = [];
  for (let r = 0; r < b.open.length; r++)
    for (let h = 0; h < b.open.length; h++) if (b.open[r] && b.open[h] && r !== h && r !== b.exit && Number.isFinite(b.dist[h][r])) out.push({ runner: r, hunter: h });
  return out;
}

/** Chance the next turn does not end in a catch (what the tester calls "the next step's chance"). */
const survival = (s: State) => turns(s).reduce((acc, o) => acc + (o.value.end === 'caught' ? 0 : o.p), 0);

type Rule = (s: State, cash: number) => boolean; // true = cash out now
const testers: Rule = (s) => survival(s) < 0.8;
const takeProfit: Rule = (_s, cash) => cash > 1;
const toTheEnd: Rule = () => false;
/** (d) Bank the high states: cash out once V ≥ 1.5× the bet, or as soon as any arrow is red. */
const cautious: Rule = (s, cash) => cash >= 1.5 || nextSteps(s).some((m) => m.fate === 'caught');
/** (d') Ride the red arrows: only cash out when the next turn is a coin flip or worse. */
const coinFlip: Rule = (s) => survival(s) <= 0.5;

const RULES: [string, Rule][] = [
  ['(a) tester: play on only when survival ≥ 0.8', testers],
  ['(b) take any profit: cash out once V > bet', takeProfit],
  ['(c) play to the end', toTheEnd],
  ['(d) cash at ≥ 1.5× or when any arrow is red', cautious],
  ["(d') cash only when survival ≤ 0.5", coinFlip],
];

/** Exact RTP of a Markov stopping rule: W(s) = cash(s) if it stops, else E[W after the turn]. The start is a checkpoint too. */
function exactRtp(start: Start, rule: Rule): number {
  const prize = prizeFor(start);
  const states = liveStates();
  const stops: boolean[] = [];
  for (const s of states) stops[keyOf(s)] = rule(s, prize * winChance(s));
  const w = new Float64Array(N() * N());
  for (const s of states) if (stops[keyOf(s)]) w[keyOf(s)] = prize * winChance(s);
  const expectNext = (s: State) => {
    let e = 0;
    for (const o of turns(s)) e += o.p * (o.value.end === 'escaped' ? prize : o.value.end === 'caught' ? 0 : w[o.next]);
    return e;
  };
  const free = states.filter((s) => !stops[keyOf(s)]);
  for (let sweep = 0; ; sweep++) {
    let change = 0;
    for (let k = free.length - 1; k >= 0; k--) {
      const v = expectNext(free[k]);
      change = Math.max(change, Math.abs(v - w[keyOf(free[k])]));
      w[keyOf(free[k])] = v;
    }
    if (change < 1e-15) break;
    if (sweep > 100_000) throw new Error('did not converge');
  }
  return w[keyOf(startState(start))];
}

function simulate(start: Start, rule: Rule, rng: Rng): number {
  const prize = prizeFor(start);
  let s = startState(start);
  for (;;) {
    const cash = prize * winChance(s);
    if (rule(s, cash)) return cash;
    const r = playTurn(s, rng);
    if (r.end === 'escaped') return prize;
    if (r.end === 'caught') return 0;
    s = after(r);
  }
}

const CONFIGS = evalSpec.configs;

describe('Chase (v2) fairness', () => {
  it('martingale: at every live state, E[V after the turn] = V, and the arrows are the true per-step odds', () => {
    let checked = 0;
    let worst = 0;
    for (const start of STARTS) expect(prizeFor(start)).toBeLessThanOrEqual(MAX_MULTIPLIER);
    const maxPrize = Math.max(...STARTS.map(prizeFor));
    for (const s of liveStates()) {
      const outs = turns(s);
      expect(outs.reduce((a, o) => a + o.p, 0)).toBeCloseTo(1, 14);
      const ev = outs.reduce((a, o) => a + o.p * chanceAfter(o.value), 0);
      const v = winChance(s);
      worst = Math.max(worst, Math.abs(ev - v) * maxPrize);
      const steps = nextSteps(s);
      expect(Math.abs(steps.reduce((a, m) => a + m.p, 0) / steps.length - v)).toBeLessThan(1e-12);
      for (const m of steps) {
        const sub = outs.filter((o) => o.value.runner === m.cell);
        const pm = sub.reduce((a, o) => a + o.p, 0);
        expect(pm).toBeCloseTo(1 / steps.length, 14);
        expect(Math.abs(sub.reduce((a, o) => a + o.p * chanceAfter(o.value), 0) / pm - m.p)).toBeLessThan(1e-12);
        // A red arrow is a certain catch, a green one a certain escape, every other arrow survives the turn.
        const caught = sub.reduce((a, o) => a + (o.value.end === 'caught' ? o.p : 0), 0) / pm;
        const out = sub.reduce((a, o) => a + (o.value.end === 'escaped' ? o.p : 0), 0) / pm;
        expect(caught).toBeCloseTo(m.fate === 'caught' ? 1 : 0, 14);
        expect(out).toBeCloseTo(m.fate === 'out' ? 1 : 0, 14);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
    expect(worst).toBeLessThan(1e-11);
  });

  it('martingale along played rounds: random reachable states, including ones a step from a catch or the exit', () => {
    const rng = createRng(seededSource(5));
    let nearEnd = 0;
    let n = 0;
    for (const start of STARTS) {
      for (let round = 0; round < 40; round++) {
        let s = startState(start);
        for (;;) {
          const outs = turns(s);
          const ev = outs.reduce((a, o) => a + o.p * chanceAfter(o.value), 0);
          expect(Math.abs(ev - winChance(s))).toBeLessThan(1e-12);
          if (outs.some((o) => o.value.end !== null)) nearEnd++;
          n++;
          const r = playTurn(s, rng);
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
        const r = exactRtp(cfg.params.start, rule);
        log(`exact ${cfg.label} | ${name} | RTP ${(r * 100).toFixed(9)}%`);
        expect(Math.abs(r - RTP), `${cfg.label} ${name}: ${r}`).toBeLessThan(1e-9);
      }
    }
  });

  it('a stop-after-k-turns rule (not Markov) is also exact: E[V after k turns] = RTP for k = 0..12', () => {
    for (const start of STARTS) {
      const prize = prizeFor(start);
      let dist = new Map<number, { s: State; p: number }>([[keyOf(startState(start)), { s: startState(start), p: 1 }]]);
      let banked = 0;
      for (let k = 0; k <= 12; k++) {
        let live = 0;
        for (const { s, p } of dist.values()) live += p * prize * winChance(s);
        expect(Math.abs(banked + live - RTP)).toBeLessThan(1e-9);
        const next = new Map<number, { s: State; p: number }>();
        for (const { s, p } of dist.values()) {
          for (const o of turns(s)) {
            if (o.value.end === 'escaped') banked += p * o.p * prize;
            if (o.value.end) continue;
            const e = next.get(o.next);
            if (e) e.p += p * o.p;
            else next.set(o.next, { s: after(o.value), p: p * o.p });
          }
        }
        dist = next;
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
          const x = simulate(cfg.params.start, rule, rng);
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
