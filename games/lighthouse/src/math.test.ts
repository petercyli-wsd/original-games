import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec, { PLAY_TO_END, playLighthouse } from './eval';
import manifest from './manifest';
import {
  FAN,
  H_MAX,
  H_MIN,
  HARDEST,
  MAX_MULTIPLIER,
  PRESETS,
  PRESET_IDS,
  P_MIN,
  RTP,
  SHORE_MAX,
  SHORE_MIN,
  SHUTTERS,
  W_MAX,
  W_MIN,
  chanceAt,
  dialArcs,
  dragEnd,
  fireAngle,
  halves,
  headlineChance,
  lands,
  litOverlap,
  moveWindow,
  placeWindow,
  prizeFor,
  resizeWindow,
  shoreX,
  shutter,
  shutterRisk,
  towerHeight,
  typicalHeight,
  windowOk,
  type Wedge,
  type Win,
} from './math';

const rng = createRng(seededSource(11));

/** Composite Simpson rule over the tower heights (an independent check of the closed form). */
function averageOverHeights(f: (h: number) => number, n = 4000) {
  const d = (H_MAX - H_MIN) / n;
  let s = f(H_MIN) + f(H_MAX);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(H_MIN + i * d);
  return (s * d) / 3 / (H_MAX - H_MIN);
}

const presets = PRESET_IDS.map((id) => PRESETS[id].win);
const extraWindows: Win[] = [{ a: -2, b: -1.5 }, { a: -0.5, b: 3 }, { a: 0, b: 0.5 }, HARDEST, { a: -2, b: 3 }];

/** A random reachable mid-round state: tower height plus the lit wedge after k shutters. */
function randomState() {
  const h = towerHeight(rng.next());
  let wedge: Wedge = FAN;
  const k = rng.int(4);
  for (let i = 0; i < k; i++) wedge = shutter(wedge, rng.next());
  return { h, wedge };
}

describe('Lighthouse maths', () => {
  it('the closed-form headline chance equals the average of (atan(b/h) − atan(a/h))/π over tower heights', () => {
    for (const win of [...presets, ...extraWindows]) {
      const numeric = averageOverHeights((h) => (Math.atan(win.b / h) - Math.atan(win.a / h)) / Math.PI);
      expect(Math.abs(headlineChance(win) - numeric)).toBeLessThan(1e-10);
    }
  });

  it('the raw Cauchy process (h uniform, θ uniform, x = h·tan θ) lands in the window as often as the formula says', () => {
    const rounds = 200_000;
    for (const win of presets) {
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        const h = H_MIN + rng.next() * (H_MAX - H_MIN);
        const x = h * Math.tan((rng.next() - 0.5) * Math.PI);
        if (x >= win.a && x <= win.b) wins++;
      }
      const p = headlineChance(win);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
    }
  });

  it('the staged reveal (tower, shutters, beam) wins with the same chance for every shutter count', () => {
    const rounds = 60_000;
    for (const win of [PRESETS.near.win, PRESETS.far.win]) {
      const p = headlineChance(win);
      const prize = prizeFor(win);
      for (const k of SHUTTERS) {
        let wins = 0;
        for (let r = 0; r < rounds; r++) if (playLighthouse(win, k, PLAY_TO_END, rng).multiplier === prize) wins++;
        expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
      }
    }
  });

  it('martingale, tower stage: E_h[prize × P(win | h)] = RTP', () => {
    for (const win of [...presets, ...extraWindows]) {
      expect(averageOverHeights((h) => prizeFor(win) * chanceAt(win, h))).toBeCloseTo(RTP, 9);
    }
  });

  it('martingale, shutter stage: ½·V(left half) + ½·V(right half) = V(lit wedge) at random states', () => {
    for (const win of [...presets, ...extraWindows]) {
      const prize = prizeFor(win);
      for (let t = 0; t < 300; t++) {
        const { h, wedge } = randomState();
        const [l, r] = halves(wedge);
        const before = prize * chanceAt(win, h, wedge);
        expect(0.5 * prize * chanceAt(win, h, l) + 0.5 * prize * chanceAt(win, h, r)).toBeCloseTo(before, 9);
        // The shutter's drawn risk is the chance the kept half misses the window entirely.
        expect(shutterRisk(win, h, wedge)).toBe((litOverlap(win, h, l) > 0 ? 0 : 0.5) + (litOverlap(win, h, r) > 0 ? 0 : 0.5));
      }
    }
  });

  it('martingale, beam stage: a uniform angle in the lit wedge lights the window with exactly P(win | h, wedge)', () => {
    for (const win of presets) {
      for (let t = 0; t < 100; t++) {
        const { h, wedge } = randomState();
        const N = 20_000;
        let hits = 0;
        for (let i = 0; i < N; i++) if (lands(win, h, fireAngle(wedge, (i + 0.5) / N))) hits++;
        // A midpoint sweep of the uniform draw: off by at most one grid cell at each window end.
        expect(Math.abs(hits / N - chanceAt(win, h, wedge))).toBeLessThanOrEqual(2 / N + 1e-12);
      }
    }
  });

  it('the beam lights the window exactly when it lands between a and b on the shore', () => {
    let wrong = 0;
    for (const win of [...presets, ...extraWindows]) {
      for (let t = 0; t < 40; t++) {
        const h = towerHeight(rng.next());
        for (let i = 0; i < 2000; i++) {
          const th = FAN[0] + ((i + 0.5) / 2000) * Math.PI;
          const x = shoreX(h, th);
          if (Math.abs(x - win.a) < 1e-9 || Math.abs(x - win.b) < 1e-9) continue;
          if (lands(win, h, th) !== (x >= win.a && x <= win.b)) wrong++;
        }
      }
    }
    expect(wrong).toBe(0);
  });

  it('the dial draws the odds: green = beams that light the window, red = lit misses, dark = shuttered', () => {
    for (const win of [...presets, ...extraWindows]) {
      for (let t = 0; t < 60; t++) {
        const { h, wedge } = randomState();
        const { green, red, shut } = dialArcs(win, h, wedge);
        const inside = (w: Wedge, th: number) => th >= w[0] && th <= w[1];
        const N = 7200;
        let wrong = 0;
        const edges = [wedge[0], wedge[1], Math.atan2(win.a, h), Math.atan2(win.b, h)];
        for (let i = 0; i < N; i++) {
          const th = FAN[0] + ((i + 0.5) / N) * Math.PI;
          // Skip angles within two grid steps of an edge, where rounding decides.
          if (edges.some((e) => Math.abs(e - th) < 2 * (Math.PI / N))) continue;
          const lit = th >= wedge[0] && th < wedge[1];
          const x = shoreX(h, th);
          const onWindow = x >= win.a && x <= win.b;
          if ((!!green && inside(green, th)) !== (lit && onWindow)) wrong++;
          if (red.some((w) => inside(w, th)) !== (lit && !onWindow)) wrong++;
          if (shut.some((w) => inside(w, th)) !== !lit) wrong++;
        }
        expect(wrong).toBe(0);
        // The green arc's share of the lit arc is the live win chance.
        const greenLen = green ? green[1] - green[0] : 0;
        const litLen = greenLen + red.reduce((s, w) => s + w[1] - w[0], 0);
        expect(litLen).toBeCloseTo(wedge[1] - wedge[0], 12);
        expect(greenLen / litLen).toBeCloseTo(chanceAt(win, h, wedge), 12);
      }
    }
  });

  it('the idle preview draws the headline chance literally: P(win | typical height) = P₀', () => {
    for (const win of [...presets, ...extraWindows]) {
      const h = typicalHeight(win);
      expect(h).toBeGreaterThanOrEqual(H_MIN);
      expect(h).toBeLessThanOrEqual(H_MAX);
      expect(chanceAt(win, h)).toBeCloseTo(headlineChance(win), 9);
    }
  });

  it('presets span the volatility range, and no legal window pays more than MAX_MULTIPLIER', () => {
    const chances = presets.map(headlineChance);
    expect(Math.max(...chances) / Math.min(...chances)).toBeGreaterThan(25);
    for (const win of presets) expect(windowOk(win)).toBe(true);
    expect(P_MIN).toBeGreaterThanOrEqual(1 / 200);
    // Exhaustive over the 0.1 grid: the hardest legal window is the narrow one at the far end.
    for (let ai = Math.round(SHORE_MIN * 10); ai <= Math.round(SHORE_MAX * 10); ai++) {
      for (let wi = Math.round(W_MIN * 10); wi <= Math.round(W_MAX * 10); wi++) {
        const win = { a: ai / 10, b: (ai + wi) / 10 };
        if (win.b > SHORE_MAX + 1e-9) continue;
        expect(headlineChance(win)).toBeGreaterThanOrEqual(P_MIN - 1e-15);
        expect(prizeFor(win)).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
      }
    }
    // Random drags, slides and resizes always leave a legal window.
    let win = PRESETS.mid.win;
    for (let t = 0; t < 4000; t++) {
      const x = -4 + rng.next() * 14;
      const k = rng.int(4);
      win = k === 0 ? moveWindow(win, x) : k === 1 ? resizeWindow(win, rng.next() * 7) : k === 2 ? dragEnd(win, 'a', x) : dragEnd(win, 'b', x);
      expect(windowOk(win)).toBe(true);
      expect(Math.round(win.a * 10)).toBeCloseTo(win.a * 10, 9);
      expect(Math.round(win.b * 10)).toBeCloseTo(win.b * 10, 9);
    }
    expect(placeWindow(100, 0.1)).toEqual(HARDEST);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
