// Fairness audit: can any way of playing Holdfast beat the RTP?
//
// Like the classic, a round has no decision after Bet: the whole round (paid spin, every free
// spin, every lock) is drawn by playRound right after ticket.place() resolves, and the UI only
// replays it. There is no cash-out. Leaving mid-replay settles the drawn total (the ticket reads
// `resolved`, set in the same handler as the draw), which equals what finishing pays. So the
// tester's rules collapse: "act only when >= 80% safe", "take any profit" and "play to the end"
// all pay the drawn total. What a player can choose is the stake sequence (auto-bet's increase on
// win/loss, stop on profit/loss, number of bets), when to leave, and Turbo (animation only).
//
// Checks, on the game's real functions:
//   1. Martingale at 78 lock states (every held count 0-12 x respins 0-5, by one exact respin step)
//      and at 36 free-spin states (awarded x remaining), by one exact spin step.
//   2. Hostile sessions, each within 4 SE: a session's total payout minus RTP x its total stake has
//      mean 0 under any stopping rule (optional stopping). Stake rules: martingale doubling on
//      loss, quit on first profit, stop after a feature, raise the stake after a win.
//   3. Leaving mid-replay: settling at the drawn total (resolved) over many rounds is RTP.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import manifest from './manifest';
import { FREE_AWARD, FREE_CAP, LINES, expectedFreeSpins, lockValue, playRound, rtpParts } from './math';

const SESSIONS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);
const RTP = manifest.rtp;

const C = (n: number, k: number) => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

interface Session {
  next(stake: number, last: { mult: number; feature: boolean } | null, total: { paid: number; got: number }): number | null;
}

const SESSION_RULES: { name: string; rule: Session }[] = [
  { name: 'double the stake after a loss, up to 6 bets', rule: { next: (s, l, t) => (t.paid > 63 ? null : l && l.mult < 1 ? s * 2 : 1) } },
  { name: 'quit on the first profit', rule: { next: (_s, _l, t) => (t.got > t.paid ? null : 1) } },
  { name: 'stop once a feature has shown', rule: { next: (_s, l) => (l?.feature ? null : 1) } },
  { name: 'raise the stake 50% after every win, stop on 25 bets', rule: { next: (s, l, t) => (t.paid > 400 ? null : l && l.mult > 1 ? s * 1.5 : l ? Math.max(1, s / 1.5) : 1) } },
];

function playSession(rule: Session, rng: Rng): number {
  const t = { paid: 0, got: 0 };
  let last: { mult: number; feature: boolean } | null = null;
  let stake: number | null = 1;
  for (let i = 0; i < 25 && stake !== null; i++) {
    const r = playRound(rng);
    t.paid += stake;
    t.got += stake * r.multiplier;
    last = { mult: r.multiplier, feature: r.spins > 1 || r.events.some((e) => e.type === 'lock') };
    stake = rule.next(stake, last, t);
  }
  return t.got - RTP * t.paid;
}

describe('holdfast fairness', () => {
  it('the lock value is a martingale at 78 states, exactly', () => {
    let states = 0;
    for (let r = 1; r <= 5; r++)
      for (let h = 0; h <= 12; h++) {
        const open = 12 - h;
        let e = 0;
        for (let j = 0; j <= open; j++) e += C(open, j) * 0.12 ** j * 0.88 ** (open - j) * lockValue(h + j, r - 1);
        expect(Math.abs(e - lockValue(h, r))).toBeLessThan(1e-9);
        states++;
      }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('the free-spin value is a martingale at 36 states, exactly', () => {
    const p = rtpParts();
    const spinValue = LINES * p.lineFree + p.t * p.eLock;
    let states = 0;
    for (let aw = FREE_AWARD; aw <= FREE_CAP; aw += 10) {
      for (const r of [1, 4, 9, 10]) {
        if (r > aw) continue;
        const a = Math.min(FREE_AWARD, FREE_CAP - aw);
        // value now = E[pay of the next spin] + E[value after it]
        const now = expectedFreeSpins(aw, r) * spinValue;
        const next = spinValue + p.q * expectedFreeSpins(aw + a, r - 1 + a) * spinValue + (1 - p.q) * expectedFreeSpins(aw, r - 1) * spinValue;
        expect(Math.abs(now - next)).toBeLessThan(1e-9 * Math.max(1, now));
        states++;
      }
    }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  for (const { name, rule } of SESSION_RULES) {
    it(`hostile session: ${name}`, () => {
      const rng = createRng(seededSource(2024));
      let sum = 0;
      let sq = 0;
      for (let i = 0; i < SESSIONS; i++) {
        const x = playSession(rule, rng);
        sum += x;
        sq += x * x;
      }
      const mean = sum / SESSIONS;
      const se = Math.sqrt(Math.max(0, sq / SESSIONS - mean * mean) / SESSIONS);
      expect(Math.abs(mean)).toBeLessThan(4 * se);
    });
  }

  it('leaving mid-replay settles the drawn total: the mean is the RTP', () => {
    const rng = createRng(seededSource(99));
    const n = 100_000;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const m = playRound(rng).multiplier; // = resolved.current once drawn
      sum += m;
      sq += m * m;
    }
    const mean = sum / n;
    const se = Math.sqrt(sq / n - mean * mean) / Math.sqrt(n);
    expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
  });
});
