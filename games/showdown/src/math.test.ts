import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  FULL,
  HOUSE,
  N,
  RTP,
  START,
  TARGETS,
  YOU,
  autoRound,
  beats,
  cardsOf,
  chanceOf,
  drawPair,
  forecast,
  grid,
  houseNeeds,
  play,
  popcount,
  prizeFor,
  reasonFor,
  reasonText,
  roundChance,
  settled,
  tallyDone,
  type State,
} from './math';

const rng = createRng(seededSource(11));

/** Every permutation of 0..n-1. */
function permutations(n: number): number[][] {
  if (n === 0) return [[]];
  const out: number[][] = [];
  for (const p of permutations(n - 1)) for (let at = 0; at <= p.length; at++) out.push([...p.slice(0, at), n - 1, ...p.slice(at)]);
  return out;
}

/** Plays a random number of rounds from the start, stopping before the series settles. */
function randomState(k: number): State {
  let s = START;
  const rounds = rng.int(N);
  for (let r = 0; r < rounds; r++) {
    const { i, j } = drawPair(s, rng.next(), rng.next());
    const next = play(s, i, j);
    if (settled(next, k)) break;
    s = next;
  }
  return s;
}

describe('Showdown maths', () => {
  it('the cards are evens against odds and your card i beats house card j exactly when i ≥ j', () => {
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) expect(beats(i, j)).toBe(YOU[i] > HOUSE[j]);
  });

  it('the opening chance equals an exact count over all 7! matchings', () => {
    const perms = permutations(N);
    expect(perms.length).toBe(5040);
    const counts = new Array(N + 1).fill(0);
    for (const p of perms) counts[p.reduce((w, j, i) => w + (YOU[i] > HOUSE[j] ? 1 : 0), 0)]++;
    for (const k of TARGETS) {
      const atLeast = counts.slice(k).reduce((a, b) => a + b, 0);
      expect(chanceOf(START, k)).toBeCloseTo(atLeast / 5040, 13);
    }
    // The card's quoted figures.
    expect(chanceOf(START, 4)).toBeCloseTo(0.7397, 4);
    expect(chanceOf(START, 5)).toBeCloseTo(0.2603, 4);
    expect(chanceOf(START, 6)).toBeCloseTo(0.024, 4);
  });

  it('from random mid-series states the chance matches an exact count over the remaining matchings', () => {
    for (let t = 0; t < 120; t++) {
      const k = TARGETS[rng.int(TARGETS.length)];
      const s = randomState(k);
      const ys = cardsOf(s.you);
      const hs = cardsOf(s.house);
      const perms = permutations(ys.length);
      let good = 0;
      for (const p of perms) if (s.wins + p.reduce((w, jj, ii) => w + (beats(ys[ii], hs[jj]) ? 1 : 0), 0) >= k) good++;
      expect(chanceOf(s, k)).toBeCloseTo(good / perms.length, 12);
    }
  });

  it('a direct simulation of both piles flipping matches the exact chance (4 SE)', () => {
    const rounds = 40_000;
    for (const k of TARGETS) {
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        const you = rng.shuffle([...YOU]);
        const house = rng.shuffle([...HOUSE]);
        let taken = 0;
        for (let t = 0; t < N; t++) if (you[t] > house[t]) taken++;
        if (taken >= k) wins++;
      }
      const p = chanceOf(START, k);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
  });

  it('each round is a fair bet: the cash-out now is the average over the next round’s equally likely pairs', () => {
    for (let t = 0; t < 400; t++) {
      const k = TARGETS[rng.int(TARGETS.length)];
      const s = randomState(k);
      if (settled(s, k)) continue;
      const prize = prizeFor(k);
      const cells = grid(s);
      let sum = 0;
      for (const c of cells) {
        const next = play(s, c.i, c.j);
        const r = settled(next, k);
        sum += r === 'win' ? prize : r === 'lose' ? 0 : prize * chanceOf(next, k);
      }
      expect(sum / cells.length).toBeCloseTo(prize * chanceOf(s, k), 9);
    }
  });

  it('the flip is uniform: every cell of the pair grid is drawn equally often', () => {
    const s = play(START, 3, 2);
    const ys = cardsOf(s.you);
    const n = ys.length;
    expect(cardsOf(s.house).length).toBe(n);
    const seen = new Map<string, number>();
    // Each grid cell corresponds to an exact square of (u1, u2) of area 1/n².
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++) {
        const { i, j } = drawPair(s, (a + 0.5) / n, (b + 0.5) / n);
        seen.set(`${i},${j}`, (seen.get(`${i},${j}`) ?? 0) + 1);
      }
    expect(seen.size).toBe(n * n);
    for (const c of grid(s)) expect(seen.get(`${c.i},${c.j}`)).toBe(1);
  });

  it('the green share of the grid is the true chance of taking the round, and the forecast averages back to the chance now', () => {
    for (let t = 0; t < 200; t++) {
      const k = TARGETS[rng.int(TARGETS.length)];
      const s = randomState(k);
      const ys = cardsOf(s.you).map((i) => YOU[i]);
      const hs = cardsOf(s.house).map((j) => HOUSE[j]);
      let wins = 0;
      for (const y of ys) for (const h of hs) if (y > h) wins++;
      const { green, total, p } = roundChance(s);
      expect(total).toBe(ys.length * hs.length);
      expect(green).toBe(wins);
      expect(p).toBeCloseTo(wins / total, 15);
      const f = forecast(s, k);
      const back = (f.ifWin ? f.ifWin.mean * f.ifWin.cells : 0) + (f.ifLose ? f.ifLose.mean * f.ifLose.cells : 0);
      expect(back / total).toBeCloseTo(chanceOf(s, k), 12);
      if (f.ifWin) expect(f.ifWin.min).toBeLessThanOrEqual(f.ifWin.mean + 1e-12);
      if (f.ifLose) expect(f.ifLose.max).toBeGreaterThanOrEqual(f.ifLose.mean - 1e-12);
    }
  });

  it('a series settles exactly when the chance hits 0 or 1, never on a live state', () => {
    for (const k of TARGETS) {
      expect(settled(START, k)).toBeNull();
      expect(settled({ you: 0, house: 0, wins: k, losses: N - k }, k)).toBe('win');
      expect(settled({ you: 0, house: 0, wins: k - 1, losses: N - k + 1 }, k)).toBe('lose');
    }
    // Needing 6: 14 beats 1, then 12 beats 3. Now your 2 and 4 can never win, so 6 is out of reach after two won rounds.
    const s = play(play(START, 6, 0), 5, 1);
    expect(s.wins).toBe(2);
    expect(settled(s, 6)).toBe('lose');
    expect(settled(play(START, 6, 0), 6)).toBeNull();
    expect(chanceOf(play(START, 0, 0), 6)).toBeGreaterThan(chanceOf(START, 6));
    expect(FULL).toBe(127);
  });

  it('a series the cards left decide early ends there, with a true reason naming the cards', () => {
    let early = 0;
    for (const k of TARGETS)
      for (let you = 1; you < FULL; you++)
        for (let house = 1; house < FULL; house++) {
          const n = popcount(you);
          if (popcount(house) !== n) continue;
          for (let wins = 0; wins <= N - n; wins++) {
            const s: State = { you, house, wins, losses: N - n - wins };
            const res = settled(s, k);
            const r = reasonFor(s, k);
            // A reason exactly when the cards left settle it before the tally does.
            expect(r !== null).toBe(res !== null && !tallyDone(s, k));
            if (!r) continue;
            early++;
            expect(r.outcome).toBe(res);
            expect(r.need).toBe(res === 'win' ? k - s.wins : houseNeeds(k) - s.losses);
            const mine = cardsOf(r.side === 'you' ? you : house);
            const theirs = cardsOf(r.side === 'you' ? house : you);
            for (const a of r.cards) expect(mine).toContain(a);
            // Does card a on the reason's side take its round against card b?
            const takes = (a: number, b: number) => (r.side === 'you' ? beats(a, b) : !beats(b, a));
            // `only` is exactly the other side's cards that can go against the named cards.
            const against = theirs.filter((b) => r.cards.some((a) => takes(a, b) !== r.winners));
            expect(r.only).toEqual(against);
            // So at least |cards| − |only| of their rounds go the stated way, which is enough.
            expect(r.cards.length - r.only.length).toBeGreaterThanOrEqual(r.need);
            expect(r.sure).toBe(r.cards.length - r.only.length);
            const text = reasonText(r);
            for (const a of r.cards) expect(text).toContain(String(r.side === 'you' ? YOU[a] : HOUSE[a]));
          }
        }
    expect(early).toBeGreaterThan(1000);
    // Needing 6: 14 beats 1 and 12 beats 3, so the house's 13 and 11 now beat all you have and it needs just 2.
    const s = play(play(START, 6, 0), 5, 1);
    expect(reasonText(reasonFor(s, 6)!)).toBe("the house's 13 and 11 beat every card you have left, and you can't afford 2 more lost rounds");
  });

  it('no flip is played after the series is decided', () => {
    for (let t = 0; t < 3000; t++) {
      const k = TARGETS[t % TARGETS.length];
      const res = autoRound(k, null, () => rng.next());
      // Every state before the last is still open; the last is settled.
      res.flips.forEach((f, idx) => expect(settled(f.s, k) !== null).toBe(idx === res.flips.length - 1));
    }
  });

  it('Auto stops are fair too and never pay above the prize', () => {
    for (const k of TARGETS) {
      const rounds = 30_000;
      let sum = 0;
      let sq = 0;
      for (let r = 0; r < rounds; r++) {
        const res = autoRound(k, 1.5, () => rng.next());
        expect(res.multiplier).toBeLessThanOrEqual(prizeFor(k) + 1e-12);
        sum += res.multiplier;
        sq += res.multiplier ** 2;
      }
      const mean = sum / rounds;
      const se = Math.sqrt((sq / rounds - mean * mean) / rounds);
      expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
    }
  });

  it('simulated RTP matches the manifest under random stopping', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
