import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  AUTO_TARGETS,
  MAX_MULTIPLIER,
  RTP,
  STARTS,
  autoChance,
  autoStops,
  board,
  heatMap,
  hunterReach,
  hunterSteps,
  nextSteps,
  race,
  playTurn,
  prizeFor,
  startChance,
  startState,
  volatilityOf,
  winChance,
  type Start,
  type State,
} from './math';

const rng = createRng(seededSource(11));

/** Dense Gaussian elimination of the same absorbing chain, written independently of math.ts. */
function denseSolve(): Map<string, number> {
  const b = board();
  const states: State[] = [];
  const at = new Map<string, number>();
  const key = (r: number, h: number) => `${r},${h}`;
  for (let r = 0; r < b.open.length; r++)
    for (let h = 0; h < b.open.length; h++)
      if (b.open[r] && b.open[h] && r !== h && r !== b.exit) at.set(key(r, h), states.push({ runner: r, hunter: h }) - 1);
  const n = states.length;
  const A = states.map(() => new Float64Array(n + 1));
  states.forEach((s, i) => {
    A[i][i] += 1;
    const moves = b.nbrs[s.runner];
    for (const m of moves) {
      const w = 1 / moves.length;
      if (m === s.hunter) continue;
      if (m === b.exit) {
        A[i][n] += w;
        continue;
      }
      const d = Math.min(...b.nbrs[s.hunter].map((x) => b.dist[x][m]));
      const replies = b.nbrs[s.hunter].filter((x) => b.dist[x][m] === d);
      for (const h of replies) if (h !== m) A[i][at.get(key(m, h))!] -= w / replies.length;
    }
  });
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || A[r][c] === 0) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j <= n; j++) A[r][j] -= f * A[c][j];
    }
  }
  const out = new Map<string, number>();
  states.forEach((s, i) => out.set(key(s.runner, s.hunter), A[i][n] / A[i][i]));
  return out;
}

/** A random live state reached by playing the real process from the start. */
function reachableState(start: Start): State | null {
  let s = startState(start);
  const turns = rng.int(7);
  for (let i = 0; i < turns; i++) {
    const r = playTurn(s, rng);
    if (r.end) return null;
    s = { runner: r.runner, hunter: r.hunter };
  }
  return s;
}

/** Every (runner step, hunter reply) outcome of one turn with its exact probability. */
function outcomes(s: State): { p: number; next: State | null; end: 'escaped' | 'caught' | null }[] {
  const b = board();
  const moves = b.nbrs[s.runner];
  const out: { p: number; next: State | null; end: 'escaped' | 'caught' | null }[] = [];
  for (const m of moves) {
    if (m === s.hunter) out.push({ p: 1 / moves.length, next: null, end: 'caught' });
    else if (m === b.exit) out.push({ p: 1 / moves.length, next: null, end: 'escaped' });
    else {
      const replies = b.nbrs[s.hunter].filter((x) => b.dist[x][m] === b.dist[s.hunter][m] - 1);
      for (const h of replies)
        out.push({ p: 1 / moves.length / replies.length, next: h === m ? null : { runner: m, hunter: h }, end: h === m ? 'caught' : null });
    }
  }
  return out;
}

describe('Chase maths', () => {
  it('the Gauss–Seidel table equals a dense Gaussian elimination of the chain', () => {
    for (const [k, v] of denseSolve()) {
      const [runner, hunter] = k.split(',').map(Number);
      expect(Math.abs(winChance({ runner, hunter }) - v)).toBeLessThan(1e-12);
    }
  });

  it('playing to the end escapes as often as the solved chance says (independent simulation)', () => {
    const b = board();
    for (const start of STARTS) {
      const rounds = 40_000;
      let wins = 0;
      for (let i = 0; i < rounds; i++) {
        let runner = b.runner;
        let hunter = b.starts[start];
        for (;;) {
          const moves = b.nbrs[runner];
          runner = moves[Math.floor(rng.next() * moves.length)];
          if (runner === hunter) break;
          if (runner === b.exit) {
            wins++;
            break;
          }
          const d = Math.min(...b.nbrs[hunter].map((x) => b.dist[x][runner]));
          const replies = b.nbrs[hunter].filter((x) => b.dist[x][runner] === d);
          hunter = replies[Math.floor(rng.next() * replies.length)];
          if (hunter === runner) break;
        }
      }
      const p = startChance(start);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
  });

  it('each turn is a fair bet: E[odds after the turn] = odds now, so the cash-out is a martingale', () => {
    for (const start of STARTS) {
      for (let trial = 0; trial < 60; trial++) {
        const st = reachableState(start);
        if (!st) continue;
        let ev = 0;
        for (const o of outcomes(st)) ev += o.p * (o.end === 'escaped' ? 1 : o.next ? winChance(o.next) : 0);
        const now = winChance(st);
        expect(Math.abs(ev - now)).toBeLessThan(1e-12);
        const steps = nextSteps(st);
        expect(Math.abs(steps.reduce((a, o) => a + o.p, 0) / steps.length - now)).toBeLessThan(1e-12);
        expect(Math.abs(prizeFor(start) * ev - prizeFor(start) * now)).toBeLessThan(1e-9);
      }
    }
  });

  it('the red arrows are the true risk: red share = exact chance of being caught on the next turn', () => {
    const b = board();
    // Sweep every live state, not only reachable ones.
    for (let r = 0; r < b.open.length; r++)
      for (let h = 0; h < b.open.length; h++) {
        if (!b.open[r] || !b.open[h] || r === h || r === b.exit) continue;
        const s = { runner: r, hunter: h };
        const steps = nextSteps(s);
        const k = steps.length;
        const red = steps.filter((m) => m.fate === 'caught').length / k;
        const green = steps.filter((m) => m.fate === 'out').length / k;
        const caught = outcomes(s).reduce((a, o) => a + (o.end === 'caught' ? o.p : 0), 0);
        const out = outcomes(s).reduce((a, o) => a + (o.end === 'escaped' ? o.p : 0), 0);
        expect(Math.abs(red - caught)).toBeLessThan(1e-12);
        expect(Math.abs(green - out)).toBeLessThan(1e-12);
        for (const m of steps) if (m.fate === null) expect(m.p).toBeGreaterThan(0);
      }
  });

  it('the dashed reach squares explain the red arrows: a step is red exactly when it lands in the reach', () => {
    const b = board();
    for (let r = 0; r < b.open.length; r++)
      for (let h = 0; h < b.open.length; h++) {
        if (!b.open[r] || !b.open[h] || r === h || r === b.exit) continue;
        const reach = hunterReach(b, h);
        if (h !== b.exit) expect(reach).not.toContain(b.exit);
        for (const m of nextSteps({ runner: r, hunter: h })) expect(m.fate === 'caught').toBe(reach.includes(m.cell));
        // The hunter's shown reply squares are one step closer, and the race counter drops by exactly one.
        for (const n of b.nbrs[r]) {
          if (n === h || n === b.exit) continue;
          for (const x of hunterSteps(b, h, n)) {
            expect(b.nbrs[h]).toContain(x);
            expect(race(b, n, x).toRunner).toBe(race(b, n, h).toRunner - 1);
          }
        }
      }
  });

  it('the shading under the runner is the live odds, the exit is 1 and the hunter 0', () => {
    for (const start of STARTS) {
      for (let trial = 0; trial < 20; trial++) {
        const st = reachableState(start);
        if (!st) continue;
        const map = heatMap(st.hunter);
        expect(map[st.runner]).toBe(winChance(st));
        if (st.hunter !== board().exit) expect(map[board().exit]).toBe(1);
        expect(map[st.hunter]).toBe(0);
        for (const v of map) expect(v >= 0 && v <= 1).toBe(true);
      }
    }
  });

  it('the hunter always closes in by exactly one step', () => {
    const b = board();
    for (let r = 0; r < b.open.length; r++)
      for (let h = 0; h < b.open.length; h++) {
        if (!b.open[r] || !b.open[h] || r === h) continue;
        expect(b.nbrs[h].filter((x) => b.dist[x][r] === b.dist[h][r] - 1).length).toBeGreaterThan(0);
      }
  });

  it('Auto chance is exact: matches a simulation of the stopping rule', () => {
    for (const start of ['far', 'near'] as Start[]) {
      const prize = prizeFor(start);
      for (const target of AUTO_TARGETS.filter((t) => t !== null && t < prize)) {
        const rounds = 20_000;
        let hits = 0;
        for (let i = 0; i < rounds; i++) {
          let s = startState(start);
          for (;;) {
            const t = playTurn(s, rng);
            if (t.end) {
              if (t.end === 'escaped') hits++;
              break;
            }
            s = { runner: t.runner, hunter: t.hunter };
            if (autoStops(prize * winChance(s), target)) {
              hits++;
              break;
            }
          }
        }
        const p = autoChance(start, target);
        expect(Math.abs(hits / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
      }
    }
  });

  it('the one knob spans over 25:1 in odds, levels are ordered, and the max multiplier bounds every prize', () => {
    const prizes = STARTS.map(prizeFor);
    expect(Math.max(...prizes)).toBeLessThanOrEqual(MAX_MULTIPLIER);
    expect(Math.max(...prizes)).toBeGreaterThan(MAX_MULTIPLIER - 1);
    const chances = STARTS.map(startChance);
    expect(Math.max(...chances) / Math.min(...chances)).toBeGreaterThan(25);
    for (let i = 1; i < chances.length; i++) expect(chances[i]).toBeLessThan(chances[i - 1]);
    expect(STARTS.map(volatilityOf)).toEqual(['low', 'medium', 'high', 'extreme']);
    expect(RTP).toBe(manifest.rtp);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
