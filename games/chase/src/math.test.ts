import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  ALL_SETTINGS,
  MAX_MULTIPLIER,
  PERIOD,
  RTP,
  SPEEDS,
  board,
  heatMap,
  hunterMovesNow,
  moveOdds,
  playTurn,
  prizeFor,
  startChance,
  startState,
  table,
  winChance,
  type Board,
  type Speed,
  type State,
} from './math';

const rng = createRng(seededSource(11));

/** Dense Gaussian elimination of the same absorbing chain, written independently of math.ts. */
function denseSolve(b: Board, speed: Speed): Map<string, number> {
  const k = PERIOD[speed];
  const states: State[] = [];
  const at = new Map<string, number>();
  const key = (r: number, h: number, ph: number) => `${r},${h},${ph}`;
  for (let r = 0; r < b.open.length; r++)
    for (let h = 0; h < b.open.length; h++)
      for (let ph = 0; ph < k; ph++)
        if (b.open[r] && b.open[h] && r !== h && r !== b.exit) at.set(key(r, h, ph), states.push({ runner: r, hunter: h, phase: ph }) - 1);
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
      const ph = (s.phase + 1) % k;
      if (s.phase !== k - 1) {
        A[i][at.get(key(m, s.hunter, ph))!] -= w;
        continue;
      }
      const d = Math.min(...b.nbrs[s.hunter].map((x) => b.dist[x][m]));
      const replies = b.nbrs[s.hunter].filter((x) => b.dist[x][m] === d);
      for (const h of replies) if (h !== m) A[i][at.get(key(m, h, ph))!] -= w / replies.length;
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
  states.forEach((s, i) => out.set(key(s.runner, s.hunter, s.phase), A[i][n] / A[i][i]));
  return out;
}

/** A random live state reached by playing the real process from the start. */
function reachableState(settings: (typeof ALL_SETTINGS)[number]): State | null {
  const t = table(settings.board, settings.speed);
  let s = startState(settings.board, settings.gap);
  const turns = rng.int(6);
  for (let i = 0; i < turns; i++) {
    const r = playTurn(t, s, rng);
    if (r.end) return null;
    s = { runner: r.runner, hunter: r.hunter, phase: r.phase };
  }
  return s;
}

describe('Chase maths', () => {
  it('the Gauss–Seidel table equals a dense Gaussian elimination of the chain (Yard, every speed)', () => {
    for (const speed of SPEEDS) {
      const t = table('yard', speed);
      const exact = denseSolve(board('yard'), speed);
      for (const [k, v] of exact) {
        const [runner, hunter, phase] = k.split(',').map(Number);
        expect(Math.abs(winChance(t, { runner, hunter, phase }) - v)).toBeLessThan(1e-12);
      }
    }
  });

  it('playing to the end escapes as often as the solved chance says (independent simulation)', () => {
    for (const s of ALL_SETTINGS) {
      const b = board(s.board);
      const k = PERIOD[s.speed];
      const rounds = 12_000;
      let wins = 0;
      for (let i = 0; i < rounds; i++) {
        let runner = b.runner;
        let hunter = b.hunters[s.gap];
        for (let turn = 0; ; turn++) {
          const moves = b.nbrs[runner];
          runner = moves[Math.floor(rng.next() * moves.length)];
          if (runner === hunter) break;
          if (runner === b.exit) {
            wins++;
            break;
          }
          if (turn % k === k - 1) {
            const d = Math.min(...b.nbrs[hunter].map((x) => b.dist[x][runner]));
            const replies = b.nbrs[hunter].filter((x) => b.dist[x][runner] === d);
            hunter = replies[Math.floor(rng.next() * replies.length)];
            if (hunter === runner) break;
          }
        }
      }
      const p = startChance(s);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
    }
  });

  it('each turn is a fair bet: E[odds after the turn] = odds now, and the move odds average to it', () => {
    for (const s of ALL_SETTINGS) {
      const t = table(s.board, s.speed);
      const b = t.board;
      for (let trial = 0; trial < 25; trial++) {
        const st = reachableState(s);
        if (!st) continue;
        // Enumerate every runner step and hunter reply explicitly.
        let ev = 0;
        const moves = b.nbrs[st.runner];
        for (const m of moves) {
          const ph = (st.phase + 1) % t.period;
          if (m === st.hunter) continue;
          if (m === b.exit) {
            ev += 1 / moves.length;
            continue;
          }
          const replies = hunterMovesNow(st.phase, s.speed) ? b.nbrs[st.hunter].filter((x) => b.dist[x][m] === b.dist[st.hunter][m] - 1) : [st.hunter];
          for (const h of replies) ev += winChance(t, { runner: m, hunter: h, phase: ph }) / moves.length / replies.length;
        }
        const now = winChance(t, st);
        expect(Math.abs(ev - now)).toBeLessThan(1e-12);
        const odds = moveOdds(t, st);
        expect(Math.abs(odds.reduce((a, o) => a + o.p, 0) / odds.length - now)).toBeLessThan(1e-12);
        // The cash-out is prize × odds, so it is a martingale too.
        expect(Math.abs(prizeFor(s) * ev - prizeFor(s) * now)).toBeLessThan(1e-9);
      }
    }
  });

  it('the shading under the runner is the live odds, the exit is 1 and the hunter 0', () => {
    for (const s of ALL_SETTINGS) {
      const t = table(s.board, s.speed);
      for (let trial = 0; trial < 10; trial++) {
        const st = reachableState(s);
        if (!st) continue;
        const map = heatMap(t, st.hunter, st.phase);
        expect(map[st.runner]).toBe(winChance(t, st));
        if (st.hunter !== t.board.exit) expect(map[t.board.exit]).toBe(1);
        expect(map[st.hunter]).toBe(0);
        for (const v of map) expect(v >= 0 && v <= 1).toBe(true);
      }
    }
  });

  it('the hunter always closes in by exactly one step when it moves', () => {
    for (const id of ['yard', 'hall'] as const) {
      const b = board(id);
      for (let r = 0; r < b.open.length; r++)
        for (let h = 0; h < b.open.length; h++) {
          if (!b.open[r] || !b.open[h] || r === h) continue;
          const steps = b.nbrs[h].filter((x) => b.dist[x][r] === b.dist[h][r] - 1);
          expect(steps.length).toBeGreaterThan(0);
        }
    }
  });

  it('the manifest max multiplier bounds every prize, and the controls span over 25:1 in odds', () => {
    const prizes = ALL_SETTINGS.map(prizeFor);
    expect(Math.max(...prizes)).toBeLessThanOrEqual(MAX_MULTIPLIER);
    expect(Math.max(...prizes)).toBeGreaterThan(MAX_MULTIPLIER - 1);
    const chances = ALL_SETTINGS.map(startChance);
    expect(Math.max(...chances) / Math.min(...chances)).toBeGreaterThan(25);
    expect(RTP).toBe(manifest.rtp);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 40_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
