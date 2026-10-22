import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  EMPTY,
  GAMES,
  LINES,
  MAX_MULTIPLIER,
  RTP,
  SIDES,
  cashValue,
  cellChances,
  certain,
  chances,
  emptyCells,
  gameChance,
  newSeries,
  nextLoss,
  outcome,
  perGame,
  place,
  plan,
  play,
  prizeFor,
  shareBar,
  startChance,
  tally,
  threats,
  toMove,
  winChance,
  type Grid,
  type Series,
  type Side,
} from './math';

const rng = createRng(seededSource(11));

/** Every unfinished position reachable from the empty board. */
function reachable(): Grid[] {
  const seen = new Map<string, Grid>();
  const walk = (g: Grid) => {
    const k = g.join('');
    if (seen.has(k) || outcome(g)) return;
    seen.set(k, g);
    for (const c of emptyCells(g)) walk(place(g, c));
  };
  walk(EMPTY);
  return [...seen.values()];
}
const POSITIONS = reachable();

/** One raw game of random tic-tac-toe, written independently of math.ts: shuffle the cells, alternate marks. */
function rawGame(start: Grid): Side {
  const g = start.slice();
  let mark = toMove(start);
  const free = rng.shuffle(g.flatMap((m, i) => (m === 0 ? [i] : [])));
  const line = (m: number) => LINES.some((l) => l.every((c) => g[c] === m));
  for (const c of free) {
    g[c] = mark;
    if (line(mark)) return mark === 1 ? 'X' : 'O';
    mark = mark === 1 ? 2 : 1;
  }
  return 'D';
}

/** A random live series state: some games won, a random position in the current one. */
function randomSeries(side: Side): Series {
  const games = GAMES[rng.int(GAMES.length)];
  for (;;) {
    let s = { ...newSeries(side, games), won: rng.int(games) };
    const marks = rng.int(8);
    for (let i = 0; i < marks && s.status === 'live' && !outcome(s.grid); i++) {
      const free = emptyCells(s.grid);
      const m = play(s, free[rng.int(free.length)]);
      if (m.ended) break;
      s = m.next;
    }
    if (s.status === 'live' && !outcome(s.grid)) return s;
  }
}

describe('Noughts maths', () => {
  it('has 4,520 unfinished positions and the known exact odds 737/1260, 121/420, 8/63', () => {
    expect(POSITIONS.length).toBe(4520);
    // Independent count: a finished game of m marks has probability (9 − m)!/9!.
    const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
    const count = { X: 0, O: 0, D: 0 };
    const walk = (g: Grid, m: number) => {
      const r = outcome(g);
      if (r) return void (count[r] += fact(9 - m));
      for (const c of emptyCells(g)) walk(place(g, c), m + 1);
    };
    walk(EMPTY, 0);
    expect(count).toEqual({ X: 212256, O: 104544, D: 46080 });
    expect(tally(EMPTY)).toEqual(count);
    expect(chances(EMPTY).X).toBeCloseTo(737 / 1260, 15);
    expect(chances(EMPTY).O).toBeCloseTo(121 / 420, 15);
    expect(chances(EMPTY).D).toBeCloseTo(8 / 63, 15);
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP * (63 / 8) ** 3, 9);
    // The info modal's example: X on two edges beside a corner, O in the far corner, and no draw is left.
    expect(tally([0, 1, 0, 1, 0, 0, 0, 0, 2]).D).toBe(0);
    expect(prizeFor('X', 1)).toBeCloseTo((RTP * 1260) / 737, 12);
  });

  it('the exact odds match a direct simulation of random play (4 SE), from the start and from mid-game positions', () => {
    const starts = [EMPTY, ...Array.from({ length: 6 }, () => POSITIONS[rng.int(POSITIONS.length)])];
    for (const start of starts) {
      const rounds = start === EMPTY ? 80_000 : 15_000;
      const hits = { X: 0, O: 0, D: 0 };
      for (let r = 0; r < rounds; r++) hits[rawGame(start)]++;
      const p = chances(start);
      for (const side of SIDES) {
        const se = Math.sqrt((p[side] * (1 - p[side])) / rounds);
        expect(Math.abs(hits[side] / rounds - p[side])).toBeLessThanOrEqual(4 * se + 1e-9);
      }
    }
  });

  it('a series of k games is won as often as p^k (simulated, 4 SE)', () => {
    for (const side of SIDES) {
      const rounds = 25_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        let s = newSeries(side, 2);
        while (s.status === 'live') s = plan(s, 'game', rng).at(-1)!.next;
        if (s.status === 'won') wins++;
      }
      const p = startChance(side, 2);
      expect(Math.abs(wins / rounds - p)).toBeLessThanOrEqual(4 * Math.sqrt((p * (1 - p)) / rounds));
    }
  });

  it('martingale: the cash-out after one random mark averages exactly the cash-out before', () => {
    for (const side of SIDES) {
      for (let trial = 0; trial < 300; trial++) {
        const s = randomSeries(side);
        const free = emptyCells(s.grid);
        const after = free.reduce((sum, c) => sum + cashValue(play(s, c).next), 0) / free.length;
        expect(after).toBeCloseTo(cashValue(s), 10);
        // A game won your way hands over to a fresh board at the same value.
        for (const c of free) {
          const m = play(s, c);
          if (m.ended === side && m.next.status === 'live') expect(cashValue(m.next)).toBeCloseTo(prizeFor(side, s.games) * perGame(side) ** (s.games - s.won - 1), 12);
          if (m.next.status === 'lost') expect(cashValue(m.next)).toBe(0);
        }
      }
    }
  });

  it('the start is worth exactly RTP, and certain games play out at an unchanged value', () => {
    for (const side of SIDES) for (const games of GAMES) expect(cashValue(newSeries(side, games))).toBeCloseTo(RTP, 12);
    let seen = 0;
    for (const grid of POSITIONS) {
      for (const side of SIDES) {
        const s: Series = { side, games: 2, won: 1, grid, status: 'live' };
        if (!certain(s)) continue;
        seen++;
        for (const c of emptyCells(grid)) expect(cashValue(play(s, c).next)).toBeCloseTo(cashValue(s), 12);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('what the board draws is the true chance: cell numbers average to it, the bar splits it, threats are the winning cells', () => {
    for (const grid of POSITIONS) {
      const p = chances(grid);
      expect(p.X + p.O + p.D).toBeCloseTo(1, 12);
      const bar = shareBar(p);
      expect(bar.map((b) => b.side)).toEqual(['X', 'D', 'O']);
      for (const b of bar) expect(b.to - b.from).toBeCloseTo(p[b.side], 12);
      expect(bar[2].to).toBeCloseTo(1, 12);

      const mover = toMove(grid);
      const moverSide: Side = mover === 1 ? 'X' : 'O';
      const winning = new Set(threats(grid).filter((t) => t.mark === mover).map((t) => t.cell));
      for (const side of SIDES) {
        const cells = cellChances(grid, side);
        expect(cells.map((c) => c.cell)).toEqual(emptyCells(grid));
        const mean = cells.reduce((sum, c) => sum + c.p, 0) / cells.length;
        expect(mean).toBeCloseTo(p[side], 12);
        for (const c of cells) {
          // A cell completes a line for the mover exactly when it is one of the drawn threats.
          expect(c.ends === moverSide).toBe(winning.has(c.cell));
          if (c.ends) expect(c.p).toBe(c.ends === side ? 1 : 0);
        }
        const s: Series = { side, games: 1, won: 0, grid, status: 'live' };
        expect(nextLoss(s)).toBeCloseTo(cells.filter((c) => c.p === 0).length / cells.length, 12);
        expect(winChance(s)).toBe(gameChance(s));
      }
    }
  });

  it('simulated RTP matches the manifest under sampled strategies, and no payout exceeds maxMultiplier', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
