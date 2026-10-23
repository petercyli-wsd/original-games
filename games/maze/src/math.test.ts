import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  ALL_SETTINGS,
  AUTO_TARGETS,
  MAX_MULTIPLIER,
  MAZE_IDS,
  RTP,
  autoChance,
  autoStops,
  isEnd,
  maze,
  moveOdds,
  prizeFor,
  roll,
  rollOutlook,
  selectable,
  startChance,
  volatilityOf,
  type Maze,
} from './math';

const rng = createRng(seededSource(23));

/** Gauss–Seidel on the same Dirichlet problem, written independently of the elimination in math.ts. */
function gaussSeidel(m: Maze): Float64Array {
  const v = new Float64Array(m.w * m.h);
  v[m.exit] = 1;
  for (let sweep = 0; sweep < 200_000; sweep++) {
    let change = 0;
    for (let c = 0; c < v.length; c++) {
      if (isEnd(m, c)) continue;
      const nb = m.nbrs[c];
      const next = nb.reduce((a, n) => a + v[n], 0) / nb.length;
      change = Math.max(change, Math.abs(next - v[c]));
      v[c] = next;
    }
    if (change < 1e-15) break;
  }
  return v;
}

/** A random cell reached by playing the real process from a random allowed start. */
function reachable(): { m: Maze; at: number; prize: number } | null {
  const s = ALL_SETTINGS[rng.int(ALL_SETTINGS.length)];
  const m = maze(s.maze);
  const path = roll(m, s.start, rng.int(8), rng);
  const at = path.length ? path[path.length - 1] : s.start;
  return isEnd(m, at) ? null : { m, at, prize: prizeFor(s) };
}

describe('Maze maths', () => {
  it('every maze is connected, with one exit and one or two traps', () => {
    for (const id of MAZE_IDS) {
      const m = maze(id);
      const seen = new Set([0]);
      const queue = [0];
      for (let k = 0; k < queue.length; k++) for (const n of m.nbrs[queue[k]]) if (!seen.has(n)) seen.add(n), queue.push(n);
      expect(seen.size).toBe(m.w * m.h);
      expect(m.exit).toBeGreaterThanOrEqual(0);
      expect(m.traps.length).toBe(id === 'catacomb' ? 2 : 1);
      // Gaps are symmetric.
      m.nbrs.forEach((nb, c) => nb.forEach((n) => expect(m.nbrs[n]).toContain(c)));
    }
  });

  it('the eliminated odds equal Gauss–Seidel, and are harmonic: each cell is the mean of its neighbours', () => {
    for (const id of MAZE_IDS) {
      const m = maze(id);
      const gs = gaussSeidel(m);
      m.odds.forEach((h, c) => {
        expect(Math.abs(h - gs[c])).toBeLessThan(1e-12);
        if (isEnd(m, c)) return;
        const nb = m.nbrs[c];
        expect(Math.abs(nb.reduce((a, n) => a + m.odds[n], 0) / nb.length - h)).toBeLessThan(1e-12);
        expect(h >= 0 && h <= 1).toBe(true);
      });
      expect(m.odds[m.exit]).toBe(1);
      for (const t of m.traps) expect(m.odds[t]).toBe(0);
    }
  });

  it('playing to the end reaches the exit as often as the odds say (independent simulation)', () => {
    for (const id of MAZE_IDS) {
      const m = maze(id);
      for (const start of m.presets) {
        const rounds = 12_000;
        let wins = 0;
        let moves = 0;
        for (let i = 0; i < rounds; i++) {
          let c = start;
          while (c !== m.exit && !m.traps.includes(c)) {
            const nb = m.nbrs[c];
            c = nb[Math.floor(rng.next() * nb.length)];
            moves++;
          }
          if (c === m.exit) wins++;
        }
        const p = m.odds[start];
        expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
        // The expected-moves solve agrees too (loose: moves are heavy-tailed).
        expect(Math.abs(moves / rounds - m.moves[start]) / m.moves[start]).toBeLessThan(0.06);
      }
    }
  });

  it('each move is a fair bet: E[cash-out after a move] = cash-out now, and the move odds average to the live odds', () => {
    for (let trial = 0; trial < 300; trial++) {
      const r = reachable();
      if (!r) continue;
      const { m, at, prize } = r;
      const odds = moveOdds(m, at);
      const mean = odds.reduce((a, o) => a + o.p, 0) / odds.length;
      expect(Math.abs(mean - m.odds[at])).toBeLessThan(1e-12);
      expect(Math.abs(prize * mean - prize * m.odds[at])).toBeLessThan(1e-9);
    }
  });

  it('a whole roll is fair too, and its outlook matches the exact distribution', () => {
    for (let trial = 0; trial < 60; trial++) {
      const r = reachable();
      if (!r) continue;
      const { m, at } = r;
      for (const n of [1, 3]) {
        // Enumerate every path of n moves explicitly (stopping at the exit or a trap).
        let ev = 0;
        let exit = 0;
        let trap = 0;
        const walk = (c: number, k: number, w: number) => {
          if (c === m.exit) exit += w;
          if (m.traps.includes(c)) trap += w;
          if (k === n || isEnd(m, c)) return void (ev += w * m.odds[c]);
          for (const v of m.nbrs[c]) walk(v, k + 1, w / m.nbrs[c].length);
        };
        walk(at, 0, 1);
        expect(Math.abs(ev - m.odds[at])).toBeLessThan(1e-12);
        const o = rollOutlook(m, at, n);
        expect(Math.abs(o.exit - exit)).toBeLessThan(1e-12);
        expect(Math.abs(o.trap - trap)).toBeLessThan(1e-12);
      }
    }
  });

  it('the shading under the ball is the true risk: odds-weighted outcomes from any cell match a simulation', () => {
    for (const id of MAZE_IDS) {
      const m = maze(id);
      // Sweep every live cell with a short simulation; all must sit within 5 SE.
      for (let c = 0; c < m.w * m.h; c++) {
        if (isEnd(m, c)) continue;
        const rounds = 600;
        let wins = 0;
        for (let i = 0; i < rounds; i++) {
          let at = c;
          while (!isEnd(m, at)) at = m.nbrs[at][rng.int(m.nbrs[at].length)];
          if (at === m.exit) wins++;
        }
        const p = m.odds[c];
        expect(Math.abs(wins / rounds - p)).toBeLessThan(5 * Math.sqrt((p * (1 - p)) / rounds) + 2 / rounds);
      }
    }
  });

  it('Auto: the chance of reaching each target is exact (simulation) and never beats RTP', () => {
    const s = { maze: 'labyrinth' as const, start: maze('labyrinth').presets[1] };
    const m = maze(s.maze);
    const prize = prizeFor(s);
    for (const target of AUTO_TARGETS) {
      if (target !== null && target >= prize) continue;
      const rounds = 8_000;
      let hits = 0;
      let paid = 0;
      for (let i = 0; i < rounds; i++) {
        let at = s.start;
        for (;;) {
          at = m.nbrs[at][rng.int(m.nbrs[at].length)];
          if (m.traps.includes(at)) break;
          const cash = prize * m.odds[at];
          if (at === m.exit || autoStops(cash, target)) {
            hits++;
            paid += cash;
            break;
          }
        }
      }
      const p = autoChance(s, target);
      expect(Math.abs(hits / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
      // Stopping at a target is still fair: P(hit) × E[pay | hit] = RTP.
      expect(Math.abs(paid / rounds - RTP)).toBeLessThan(0.08);
    }
  });

  it('presets, start limits, volatility span and the manifest max multiplier', () => {
    for (const id of MAZE_IDS) {
      const m = maze(id);
      expect(new Set(m.presets).size).toBe(4);
      for (const c of m.presets) expect(selectable(m, c)).toBe(true);
      // Presets run from safest to wildest.
      for (let k = 1; k < 4; k++) expect(m.odds[m.presets[k]]).toBeLessThan(m.odds[m.presets[k - 1]]);
    }
    const prizes = ALL_SETTINGS.map(prizeFor);
    expect(Math.max(...prizes)).toBeLessThanOrEqual(MAX_MULTIPLIER);
    expect(Math.max(...prizes)).toBeGreaterThan(MAX_MULTIPLIER - 1);
    const chances = ALL_SETTINGS.map(startChance);
    expect(Math.max(...chances) / Math.min(...chances)).toBeGreaterThan(25);
    expect(new Set(ALL_SETTINGS.map(volatilityOf))).toEqual(new Set(['low', 'medium', 'high', 'extreme']));
    expect(manifest.rtp).toBe(RTP);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 40_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
