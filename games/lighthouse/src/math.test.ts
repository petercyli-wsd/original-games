import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec, { PLAY_TO_END, playLighthouse } from './eval';
import manifest from './manifest';
import {
  DIST_MAX,
  DIST_MIN,
  FAN,
  H_MAX,
  H_MIN,
  HARDEST,
  MAX_MULTIPLIER,
  PRESETS,
  PRESET_IDS,
  P_MIN,
  RTP,
  WIDTH,
  chanceAt,
  dialArcs,
  fireAngle,
  headlineChance,
  heightEffect,
  lands,
  presetOf,
  prizeFor,
  shoreX,
  snapDist,
  towerHeight,
  typicalHeight,
  volatilityOf,
  widening,
  windowAt,
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

const presets = PRESET_IDS.map((id) => windowAt(PRESETS[id].dist));
/** Every legal window: distances 0, 0.1, …, DIST_MAX. */
const allWindows: Win[] = [];
for (let i = Math.round(DIST_MIN * 10); i <= Math.round(DIST_MAX * 10); i++) allWindows.push(windowAt(i / 10));

describe('Lighthouse maths', () => {
  it('windows have the fixed width, snap to tenths and stay on the legal range', () => {
    for (const win of allWindows) {
      expect(win.b - win.a).toBeCloseTo(WIDTH, 12);
      expect(Math.round(win.a * 10)).toBeCloseTo(win.a * 10, 9);
    }
    for (let t = 0; t < 2000; t++) {
      const d = snapDist(-3 + rng.next() * 15);
      expect(d).toBeGreaterThanOrEqual(DIST_MIN);
      expect(d).toBeLessThanOrEqual(DIST_MAX);
      expect(Math.round(d * 10)).toBeCloseTo(d * 10, 9);
    }
    expect(windowAt(100)).toEqual(HARDEST);
    for (const id of PRESET_IDS) expect(presetOf(PRESETS[id].dist)).toBe(id);
  });

  it('the closed-form chance before the tower stops equals the average of (atan(b/h) − atan(a/h))/π over heights', () => {
    for (const win of allWindows) {
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

  it('the staged reveal played to the end (tower, then beam) wins with the headline chance', () => {
    const rounds = 100_000;
    for (const win of presets) {
      const p = headlineChance(win);
      const prize = prizeFor(win);
      let wins = 0;
      for (let r = 0; r < rounds; r++) if (playLighthouse(win, PLAY_TO_END, rng).multiplier === prize) wins++;
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
    }
  });

  it('martingale, tower stage: E_h[prize × P(win | h)] = RTP', () => {
    for (const win of allWindows) {
      expect(averageOverHeights((h) => prizeFor(win) * chanceAt(win, h))).toBeCloseTo(RTP, 9);
    }
  });

  it('martingale, beam stage: a uniform angle in the fan lights the window with exactly P(win | h)', () => {
    for (const win of presets) {
      for (let t = 0; t < 100; t++) {
        const h = towerHeight(rng.next());
        const N = 20_000;
        let hits = 0;
        for (let i = 0; i < N; i++) if (lands(win, h, fireAngle((i + 0.5) / N))) hits++;
        // A midpoint sweep of the uniform draw: off by at most one grid cell at each window end.
        expect(Math.abs(hits / N - chanceAt(win, h))).toBeLessThanOrEqual(2 / N + 1e-12);
        // The checkpoint is always live.
        expect(chanceAt(win, h)).toBeGreaterThan(0);
        expect(chanceAt(win, h)).toBeLessThan(1);
      }
    }
  });

  it('the beam lights the window exactly when it lands between a and b on the shore', () => {
    let wrong = 0;
    for (const win of allWindows) {
      for (let t = 0; t < 10; t++) {
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

  it('the dial draws the odds: green = beams that light the window, red = misses, and green ÷ fan = P(win | h)', () => {
    for (const win of allWindows) {
      for (let t = 0; t < 10; t++) {
        const h = towerHeight(rng.next());
        const { green, red } = dialArcs(win, h);
        const inside = (w: readonly [number, number], th: number) => th >= w[0] && th <= w[1];
        const N = 7200;
        let wrong = 0;
        const edges = [Math.atan2(win.a, h), Math.atan2(win.b, h)];
        for (let i = 0; i < N; i++) {
          const th = FAN[0] + ((i + 0.5) / N) * Math.PI;
          if (edges.some((e) => Math.abs(e - th) < 2 * (Math.PI / N))) continue;
          const x = shoreX(h, th);
          const onWindow = x >= win.a && x <= win.b;
          if (inside(green, th) !== onWindow) wrong++;
          if (red.some((w) => inside(w, th)) !== !onWindow) wrong++;
        }
        expect(wrong).toBe(0);
        const greenLen = green[1] - green[0];
        const total = greenLen + red.reduce((s, w) => s + w[1] - w[0], 0);
        expect(total).toBeCloseTo(Math.PI, 12);
        expect(greenLen / total).toBeCloseTo(chanceAt(win, h), 12);
      }
    }
  });

  it('the "taller tower" label tells the truth: the slice moves the way it says over every height', () => {
    const N = 400;
    for (const win of allWindows) {
      const e = heightEffect(win);
      for (let i = 0; i < N; i++) {
        const h0 = H_MIN + ((H_MAX - H_MIN) * i) / N;
        const h1 = H_MIN + ((H_MAX - H_MIN) * (i + 1)) / N;
        const up = chanceAt(win, h1) > chanceAt(win, h0);
        // The live caption while the tower rises.
        expect(widening(win, (h0 + h1) / 2)).toBe(up);
        if (e.kind === 'wider') expect(up).toBe(true);
        if (e.kind === 'narrower') expect(up).toBe(false);
        if (e.kind === 'peak') expect(up).toBe(h1 <= e.at ? true : h0 >= e.at ? false : up);
      }
      if (e.kind === 'peak') {
        expect(e.at).toBeGreaterThan(H_MIN);
        expect(e.at).toBeLessThan(H_MAX);
        for (const dh of [-0.01, 0.01]) expect(chanceAt(win, e.at)).toBeGreaterThan(chanceAt(win, e.at + dh));
      }
    }
    // The presets beyond Near all say "wider", so the default round reads one way.
    expect(heightEffect(windowAt(PRESETS.near.dist)).kind).toBe('narrower');
    for (const id of ['mid', 'far', 'vfar'] as const) expect(heightEffect(windowAt(PRESETS[id].dist)).kind).toBe('wider');
  });

  it('the idle preview draws the headline chance literally: P(win | typical height) = P₀', () => {
    for (const win of allWindows) {
      const h = typicalHeight(win);
      expect(h).toBeGreaterThanOrEqual(H_MIN);
      expect(h).toBeLessThanOrEqual(H_MAX);
      expect(chanceAt(win, h)).toBeCloseTo(headlineChance(win), 9);
    }
  });

  it('the distance knob spans the volatility range, and no legal window pays more than MAX_MULTIPLIER', () => {
    const chances = presets.map(headlineChance);
    expect(Math.max(...chances) / Math.min(...chances)).toBeGreaterThan(25);
    expect(presets.map(volatilityOf)).toEqual(['low', 'medium', 'high', 'extreme']);
    // Farther is always rarer.
    for (let i = 1; i < allWindows.length; i++) expect(headlineChance(allWindows[i])).toBeLessThan(headlineChance(allWindows[i - 1]));
    for (const win of allWindows) {
      expect(headlineChance(win)).toBeGreaterThanOrEqual(P_MIN - 1e-15);
      expect(prizeFor(win)).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
    }
    expect(P_MIN).toBeGreaterThanOrEqual(1 / 200);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
