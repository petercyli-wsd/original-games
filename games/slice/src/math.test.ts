import { createRng, runEval, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  CUT_OPTIONS,
  MODES,
  MODE_NAMES,
  RTP,
  UNIT_SQUARE,
  cashMultiplier,
  circlePolygonArea,
  clipHalfPlane,
  cutRound,
  inCircle,
  isWin,
  newRound,
  polygonArea,
  radiusFor,
  randomPointIn,
  regionInside,
  regionOutside,
  sampleCut,
  winChance,
  type Circle,
  type Poly,
  type Round,
} from './math';

const seeded = (seed: number) => createRng(seededSource(seed));

/** A random convex polygon: the square cut a few times. */
function randomRegion(rng: Rng, cuts: number): Poly {
  let poly = UNIT_SQUARE;
  for (let i = 0; i < cuts; i++) poly = clipHalfPlane(poly, sampleCut(poly, rng), rng.next() < 0.5 ? 1 : -1);
  return poly;
}

describe('Slice geometry', () => {
  it('clips the square by axis-aligned and diagonal half-planes', () => {
    expect(polygonArea(clipHalfPlane(UNIT_SQUARE, { p: { x: 0.3, y: 0 }, n: { x: 1, y: 0 } }))).toBeCloseTo(0.7, 12);
    expect(polygonArea(clipHalfPlane(UNIT_SQUARE, { p: { x: 0.3, y: 0 }, n: { x: 1, y: 0 } }, -1))).toBeCloseTo(0.3, 12);
    const diag = { p: { x: 0.5, y: 0.5 }, n: { x: Math.SQRT1_2, y: Math.SQRT1_2 } };
    expect(polygonArea(clipHalfPlane(UNIT_SQUARE, diag))).toBeCloseTo(0.5, 12);
    expect(clipHalfPlane(UNIT_SQUARE, diag)).toHaveLength(3);
  });

  it('circle ∩ polygon matches closed forms', () => {
    const c: Circle = { cx: 0.5, cy: 0.5, r: 0.3 };
    expect(circlePolygonArea(c, UNIT_SQUARE)).toBeCloseTo(Math.PI * 0.09, 12);
    // Half-plane through the centre: half the disk.
    const half = clipHalfPlane(UNIT_SQUARE, { p: { x: 0.5, y: 0.5 }, n: { x: 0.6, y: 0.8 } });
    expect(circlePolygonArea(c, half)).toBeCloseTo((Math.PI * 0.09) / 2, 12);
    // Circular segment: chord at distance d from the centre.
    const d = 0.1;
    const seg = clipHalfPlane(UNIT_SQUARE, { p: { x: 0.5 + d, y: 0 }, n: { x: 1, y: 0 } });
    expect(circlePolygonArea(c, seg)).toBeCloseTo(0.09 * Math.acos(d / 0.3) - d * Math.sqrt(0.09 - d * d), 12);
    // Circle spilling past the square: a quarter disk at the corner.
    expect(circlePolygonArea({ cx: 0, cy: 0, r: 0.5 }, UNIT_SQUARE)).toBeCloseTo((Math.PI * 0.25) / 4, 12);
  });

  it('circle ∩ random convex polygons agrees with Monte Carlo', () => {
    const rng = seeded(7);
    const n = 200_000;
    for (let trial = 0; trial < 8; trial++) {
      const poly = randomRegion(rng, 1 + rng.int(4));
      const c: Circle = { cx: rng.next(), cy: rng.next(), r: 0.05 + 0.4 * rng.next() };
      const exact = circlePolygonArea(c, poly) / polygonArea(poly);
      let hits = 0;
      for (let i = 0; i < n; i++) if (inCircle(c, randomPointIn(poly, rng))) hits++;
      const se = Math.sqrt(Math.max(exact * (1 - exact), 1e-6) / n);
      expect(Math.abs(hits / n - exact)).toBeLessThan(4 * se + 1e-9);
    }
  });

  it('random points are uniform in the polygon', () => {
    const rng = seeded(11);
    const poly = randomRegion(rng, 3);
    const cut = sampleCut(poly, rng);
    const share = polygonArea(clipHalfPlane(poly, cut)) / polygonArea(poly);
    const n = 100_000;
    let inside = 0;
    for (let i = 0; i < n; i++) {
      const p = randomPointIn(poly, rng);
      if (cut.n.x * (p.x - cut.p.x) + cut.n.y * (p.y - cut.p.y) >= 0) inside++;
    }
    expect(Math.abs(inside / n - share)).toBeLessThan(4 * Math.sqrt((share * (1 - share)) / n));
  });

  it('detects regions wholly inside or outside the circle', () => {
    const c: Circle = { cx: 0.5, cy: 0.5, r: 0.2 };
    const tri: Poly = [
      { x: 0.45, y: 0.45 },
      { x: 0.55, y: 0.45 },
      { x: 0.5, y: 0.55 },
    ];
    expect(regionInside(c, tri)).toBe(true);
    expect(winChance(c, tri)).toBe(1);
    const far = clipHalfPlane(UNIT_SQUARE, { p: { x: 0.75, y: 0 }, n: { x: 1, y: 0 } });
    expect(regionOutside(c, far)).toBe(true);
    expect(winChance(c, far)).toBe(0);
    expect(regionOutside(c, UNIT_SQUARE)).toBe(false);
  });
});

/**
 * Exact expected payout of a strategy that cashes out after `stopAt` cuts:
 * walk the whole tree of cuts (each node draws its own cut, as the game
 * does), weighting each half by its share of the area, which is the chance
 * the uniform dot is in it.
 */
function exactValue(round: Round, stopAt: number, rng: Rng): number {
  if (round.outcome !== 'live') return cashMultiplier(round);
  if (round.slices.length === stopAt) return cashMultiplier(round);
  const cut = sampleCut(round.region, rng);
  const area = polygonArea(round.region);
  let ev = 0;
  for (const side of [1, -1] as const) {
    const half = clipHalfPlane(round.region, cut, side);
    // Put the dot inside this half (its vertex average), so cutRound keeps it.
    const dot = half.reduce((s, v) => ({ x: s.x + v.x / half.length, y: s.y + v.y / half.length }), { x: 0, y: 0 });
    let next = cutRound({ ...round, dot }, cut);
    // At the final reveal the dot is uniform in the half: pay M × P instead of a coin toss.
    if (next.outcome === 'hit' || next.outcome === 'miss') next = { ...next, outcome: 'live' };
    ev += (polygonArea(half) / area) * exactValue(next, stopAt, rng);
  }
  return ev;
}

describe('Slice fairness', () => {
  it('cashing out after any number of cuts is worth exactly the RTP', () => {
    const rng = seeded(3);
    for (const mode of MODE_NAMES) {
      for (const stopAt of [1, 2, 4, 6]) {
        for (const centre of [
          { x: 0.5, y: 0.5 },
          { x: 0.2, y: 0.7 },
        ]) {
          const round = newRound(mode, centre, 8, { x: 0, y: 0 });
          expect(exactValue(round, stopAt, rng)).toBeCloseTo(RTP, 9);
        }
      }
    }
  });

  it('the prize is RTP over the covered share, wherever the circle sits', () => {
    for (const mode of MODE_NAMES) {
      const round = newRound(mode, { x: 0.01, y: 0.99 }, 6, { x: 0, y: 0 });
      expect(round.chance * round.mult).toBeCloseTo(RTP, 12);
      expect(round.circle.r).toBeCloseTo(radiusFor(mode), 15);
      expect(round.circle.cx - round.circle.r).toBeGreaterThanOrEqual(0);
      expect(round.circle.cy + round.circle.r).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('the dot stays uniform in the region: win chance is calibrated at the reveal', () => {
    // If P_t is the true posterior, rounds shown P ≈ x are won x of the time.
    const rng = seeded(5);
    const bins = Array.from({ length: 5 }, () => ({ n: 0, p: 0, wins: 0 }));
    for (let i = 0; i < 40_000; i++) {
      let round = newRound('medium', { x: 0.5, y: 0.5 }, 6, { x: rng.next(), y: rng.next() });
      while (round.outcome === 'live') round = cutRound(round, sampleCut(round.region, rng));
      if (round.outcome !== 'hit' && round.outcome !== 'miss') continue;
      // round.chance is the win chance shown after the last cut, just before the reveal.
      const p = round.chance;
      const b = bins[Math.min(4, Math.floor(p * 5))];
      b.n++;
      b.p += p;
      b.wins += isWin(round.outcome) ? 1 : 0;
    }
    for (const b of bins) {
      if (b.n < 500) continue;
      const mean = b.p / b.n;
      expect(Math.abs(b.wins / b.n - mean)).toBeLessThan(4 * Math.sqrt(0.25 / b.n));
    }
  });

  it('simulated RTP matches the manifest for every strategy', () => {
    for (const r of runEval(evalSpec, { rounds: 40_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});

describe('Slice manifest', () => {
  it('is consistent with the maths', () => {
    expect(manifest.id).toBe('slice');
    expect(manifest.rtp).toBe(RTP);
    expect(manifest.volatility).toEqual(MODE_NAMES);
    expect(manifest.maxMultiplier).toBe(Math.max(...MODE_NAMES.map((m) => MODES[m].mult)));
    // Smaller circles pay more.
    const prizes = MODE_NAMES.map((m) => MODES[m].mult);
    expect([...prizes].sort((a, b) => a - b)).toEqual(prizes);
    expect(CUT_OPTIONS.length).toBeGreaterThan(0);
  });
});
