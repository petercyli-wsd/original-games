import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  CELLS,
  FREE_CAP,
  INNER_SYMS,
  INNER_W,
  KEY,
  LOCK_PAY,
  LOCK_CELLS,
  MAX_MULTIPLIER,
  OUTER_SYMS,
  OUTER_W,
  PAYLINES,
  PAY_BASE,
  PAY_FREE,
  ROWS_PER_REEL,
  SCATTER,
  WEIGHT_TOTAL,
  WILD,
  evalGrid,
  expectedFreeSpins,
  linePay,
  lockValue,
  playLock,
  playRound,
  rtpParts,
  type Grid,
  type PayRow,
} from './math';

// ---- exact rationals on BigInt ----
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));
class Q {
  constructor(
    public n: bigint,
    public d: bigint = 1n,
  ) {
    if (d < 0n) {
      this.n = -n;
      this.d = -d;
    }
    const g = gcd(this.n, this.d) || 1n;
    this.n /= g;
    this.d /= g;
  }
  add = (o: Q) => new Q(this.n * o.d + o.n * this.d, this.d * o.d);
  sub = (o: Q) => new Q(this.n * o.d - o.n * this.d, this.d * o.d);
  mul = (o: Q) => new Q(this.n * o.n, this.d * o.d);
  num = () => Number((this.n * 10n ** 30n) / this.d) / 1e30;
}
const q = (n: number | bigint, d: number | bigint = 1) => new Q(BigInt(n), BigInt(d));
const ZERO = q(0);
const ONE = q(1);
const C = (n: number, k: number) => {
  let r = 1n;
  for (let i = 1; i <= k; i++) r = (r * BigInt(n - k + i)) / BigInt(i);
  return r;
};
const qpow = (x: Q, k: number) => {
  let r = ONE;
  for (let i = 0; i < k; i++) r = r.mul(x);
  return r;
};
const halves = (x: number) => BigInt(Math.round(x * 2)); // every pay is a multiple of 0.5

/** Exact expected pay of one line: enumerate all 11 x 12 x 12 x 12 x 11 tuples with integer weights. */
function exactLine(table: Record<number, PayRow>): Q {
  let total = 0n; // sum of weight-product x pay x 2
  const line = [0, 0, 0, 0, 0];
  OUTER_SYMS.forEach((s0, a) => {
    line[0] = s0;
    INNER_SYMS.forEach((s1, b) => {
      line[1] = s1;
      INNER_SYMS.forEach((s2, c) => {
        line[2] = s2;
        INNER_SYMS.forEach((s3, d) => {
          line[3] = s3;
          const wInner = BigInt(OUTER_W[a] * INNER_W[b] * INNER_W[c]) * BigInt(INNER_W[d]);
          OUTER_SYMS.forEach((s4, e) => {
            line[4] = s4;
            const { pay } = linePay(line, table);
            if (pay > 0) total += wInner * BigInt(OUTER_W[e]) * halves(pay);
          });
        });
      });
    });
  });
  return q(total, 2n * 10n ** 20n);
}

function exactParts() {
  const lb = exactLine(PAY_BASE);
  const lf = exactLine(PAY_FREE);
  const pS = q(INNER_W[SCATTER], WEIGHT_TOTAL);
  const none = [0, 1, 2].reduce((s, k) => s.add(q(C(12, k)).mul(qpow(pS, k)).mul(qpow(ONE.sub(pS), 12 - k))), ZERO);
  const qs = ONE.sub(none); // P(>= 3 scatters)
  const kO = q(OUTER_W[9], WEIGHT_TOTAL);
  const t = ONE.sub(qpow(ONE.sub(qpow(kO, 3)), 2));
  const pc = ONE.sub(qpow(ONE.sub(q(INNER_W[KEY], WEIGHT_TOTAL)), 5));
  let eLock = ZERO;
  for (let k = 0; k <= LOCK_CELLS; k++) eLock = eLock.add(q(C(12, k)).mul(qpow(pc, k)).mul(qpow(ONE.sub(pc), 12 - k)).mul(q(halves(LOCK_PAY[k]), 2)));
  // N by DP on integers: EN(aw, r) = Num / qd^M with M = r + FREE_CAP - aw (the most spins still possible).
  const qn = qs.n;
  const qd = qs.d;
  const memo = new Map<string, bigint>();
  const pw = (m: number) => qd ** BigInt(m);
  const num = (aw: number, r: number): bigint => {
    if (r <= 0) return 0n;
    const key = `${aw},${r}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const a = Math.min(10, FREE_CAP - aw);
    const M = r + FREE_CAP - aw;
    const v = pw(M) + qn * num(aw + a, r - 1 + a) + (qd - qn) * num(aw, r - 1);
    memo.set(key, v);
    return v;
  };
  const N = q(num(10, 10), qd ** BigInt(10 + FREE_CAP - 10));
  const base = q(40).mul(lb).add(t.mul(eLock));
  const rtp = base.add(qs.mul(N).mul(q(40).mul(lf).add(t.mul(eLock))));
  return { lb, lf, qs, t, eLock, N, rtp };
}

describe('holdfast maths', () => {
  const ex = exactParts();

  it('weights sum to 10,000 per cell type', () => {
    expect(OUTER_W.reduce((a, b) => a + b, 0)).toBe(WEIGHT_TOTAL);
    expect(INNER_W.reduce((a, b) => a + b, 0)).toBe(WEIGHT_TOTAL);
    expect(ROWS_PER_REEL.reduce((a, b) => a + b, 0)).toBe(CELLS);
  });

  it('has 40 distinct valid lines', () => {
    expect(PAYLINES.length).toBe(40);
    expect(new Set(PAYLINES.map((l) => l.join())).size).toBe(40);
    for (const l of PAYLINES) l.forEach((row, r) => expect(row).toBeLessThan(ROWS_PER_REEL[r]));
  });

  it('pays the published tables and the wild rules', () => {
    // base: 3 of a kind pays only the keystone and the wild stand-in
    expect(linePay([0, 0, 0, 5, 5], PAY_BASE).pay).toBe(0);
    expect(linePay([0, 0, 0, 0, 5], PAY_BASE).pay).toBe(1.5);
    expect(linePay([4, 4, 4, 4, 4], PAY_BASE).pay).toBe(4);
    expect(linePay([KEY, KEY, KEY, 3, 3], PAY_BASE).pay).toBe(0.5);
    expect(linePay([WILD, WILD, WILD, WILD, WILD], PAY_BASE).pay).toBe(12.5);
    expect(linePay([WILD, WILD, WILD, WILD, SCATTER], PAY_BASE).pay).toBe(2.5);
    // the wild substitutes (and the best symbol wins): W W 4 4 4 pays s5 x 5 = 4, not the wild's 0
    expect(linePay([WILD, WILD, 4, 4, 4], PAY_BASE).pay).toBe(4);
    expect(linePay([WILD, 2, WILD, 2, 9], PAY_BASE).pay).toBe(1.5);
    // wild stands in for the keystone too
    expect(linePay([KEY, WILD, KEY, 1, 1], PAY_BASE).pay).toBe(0.5);
    // the scatter never counts
    expect(linePay([0, 0, SCATTER, 0, 0], PAY_FREE).pay).toBe(0);
    // free spins: 3 pays
    expect(linePay([2, 2, 2, 7, 7], PAY_FREE).pay).toBe(1.5);
    expect(linePay([WILD, WILD, WILD, SCATTER, 1], PAY_FREE).pay).toBe(5);
    expect(linePay([KEY, KEY, KEY, KEY, KEY], PAY_FREE).pay).toBe(4);
  });

  it('evalGrid sums the 40 lines', () => {
    const grid: Grid = [[4, 4, 4], [4, 4, 4, 4], [4, 4, 4, 4], [4, 4, 4, 4], [4, 4, 4]];
    const { wins, pay } = evalGrid(grid, false);
    expect(wins.length).toBe(40);
    expect(pay).toBe(160);
  });

  it('exact RTP, in rationals: 0.98995 to 0.99000, matching the float code', () => {
    const rtp = ex.rtp.num();
    expect(rtp).toBeGreaterThanOrEqual(0.98995);
    expect(rtp).toBeLessThanOrEqual(0.99);
    const p = rtpParts();
    expect(p.rtp).toBeCloseTo(rtp, 12);
    expect(p.lineBase).toBeCloseTo(ex.lb.num(), 12);
    expect(p.lineFree).toBeCloseTo(ex.lf.num(), 12);
    expect(p.q).toBeCloseTo(ex.qs.num(), 12);
    expect(p.t).toBeCloseTo(ex.t.num(), 12);
    expect(p.eLock).toBeCloseTo(ex.eLock.num(), 12);
    expect(p.n).toBeCloseTo(ex.N.num(), 9);
    expect(manifest.rtp).toBe(p.rtp);
  });

  it('the lock table: E_lock is the exact binomial mean and the feature odds are 1 in 93 and 1 in 102', () => {
    expect(ex.eLock.num()).toBeCloseTo(9.5726436, 6);
    expect(1 / ex.qs.num()).toBeCloseTo(93.2, 1);
    expect(1 / ex.t.num()).toBeCloseTo(102.0, 1);
  });

  it('N agrees with the uncapped series 10 / (1 - 10 q) up to the 180-spin cap', () => {
    const p = rtpParts();
    const uncapped = 10 / (1 - 10 * p.q);
    expect(p.n).toBeLessThan(uncapped);
    expect(uncapped - p.n).toBeLessThan(1e-3);
    // never awards more than 180 spins
    expect(expectedFreeSpins(180, 5)).toBe(5);
  });

  it('the lock value is a martingale over every (held, respins left)', () => {
    for (let r = 1; r <= 5; r++) {
      for (let h = 0; h <= 12; h++) {
        // one respin: each of the 12 - h open cells locks with 12%
        const free = 12 - h;
        let e = 0;
        for (let j = 0; j <= free; j++) {
          let c = 1;
          for (let i = 1; i <= j; i++) c = (c * (free - j + i)) / i;
          e += c * 0.12 ** j * 0.88 ** (free - j) * lockValue(h + j, r - 1);
        }
        expect(e).toBeCloseTo(lockValue(h, r), 10);
      }
    }
    expect(lockValue(12, 3)).toBe(500);
    expect(lockValue(4, 0)).toBe(2.5);
  });

  it('playLock locks only on the 12 centre cells, never more than 5 respins, and pays LOCK_PAY[count]', () => {
    const rng = createRng(seededSource(7));
    for (let i = 0; i < 500; i++) {
      const l = playLock(rng, false);
      expect(l.respins.length).toBeLessThanOrEqual(5);
      expect(l.pay).toBe(LOCK_PAY[l.count]);
      const held = l.respins.at(-1)!.held.filter(Boolean).length;
      expect(held).toBe(l.count);
    }
  });

  it('playRound plays 1 + (10..180) spins, and its sum equals the event pays', () => {
    const rng = createRng(seededSource(11));
    let sawFree = false;
    for (let i = 0; i < 20_000; i++) {
      const r = playRound(rng);
      const sum = r.events.reduce((s, e) => s + e.pay, 0);
      expect(r.multiplier).toBeCloseTo(sum, 9);
      expect(r.multiplier).toBeLessThanOrEqual(MAX_MULTIPLIER);
      const spins = r.events.filter((e) => e.type === 'spin');
      expect(spins.length).toBe(r.spins);
      if (r.spins > 1) {
        sawFree = true;
        expect(r.spins).toBeGreaterThanOrEqual(11);
        expect(r.spins - 1).toBeLessThanOrEqual(FREE_CAP);
      }
    }
    expect(sawFree).toBe(true);
  });

  it('runEval is within 4 SE of the exact RTP, and max is within the bound', () => {
    const [rep] = runEval(evalSpec, { rounds: 50_000 });
    expect(Math.abs(rep.rtp - manifest.rtp)).toBeLessThan(4 * rep.stdError);
    expect(rep.max).toBeLessThanOrEqual(manifest.maxMultiplier);
  });
});
