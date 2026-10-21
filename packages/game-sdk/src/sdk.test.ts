import { describe, expect, it } from 'vitest';
import { defineEval, runEval } from './eval';
import { validateManifest } from './manifest';
import { createRng, seededSource } from './rng';
import type { GameManifest } from './types';
import { InsufficientFundsError, createDemoWallet } from './wallet';

describe('rng', () => {
  it('is deterministic for a seed and stays in range', () => {
    const a = createRng(seededSource(42));
    const b = createRng(seededSource(42));
    for (let i = 0; i < 1000; i++) {
      const x = a.next();
      expect(x).toBe(b.next());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('shuffles without losing items', () => {
    const rng = createRng(seededSource(1));
    expect(rng.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('demo wallet', () => {
  it('debits on bet and credits on settle', async () => {
    const w = createDemoWallet({ initialBalance: 10 });
    const t = await w.placeBet(4);
    expect(w.balance.get()).toBe(6);
    expect(await t.settle(2.5)).toBe(10);
    expect(w.balance.get()).toBe(16);
  });

  it('rejects over-balance bets and double settlement', async () => {
    const w = createDemoWallet({ initialBalance: 1 });
    await expect(w.placeBet(2)).rejects.toBeInstanceOf(InsufficientFundsError);
    await expect(w.placeBet(0)).rejects.toBeInstanceOf(RangeError);
    const t = await w.placeBet(1);
    await t.settle(0);
    await expect(t.settle(1)).rejects.toThrow(/already settled/);
  });

  it('persists to storage', async () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const w = createDemoWallet({ initialBalance: 5, storage });
    await w.placeBet(2);
    expect(createDemoWallet({ initialBalance: 5, storage }).balance.get()).toBe(3);
  });
});

describe('manifest', () => {
  const base: GameManifest = {
    id: 'my-game',
    name: 'My Game',
    tagline: 'x',
    mechanic: 'other',
    status: 'prototype',
    rtp: 0.99,
    maxMultiplier: 10,
    volatility: ['low'],
    checkpoints: true,
    accent: '#fff',
  };

  it('accepts a valid manifest', () => expect(validateManifest(base)).toEqual([]));
  it('rejects bad ids and RTPs', () => {
    expect(validateManifest({ ...base, id: 'My_Game', rtp: 1.2 })).toHaveLength(2);
  });
});

describe('runEval', () => {
  it('measures a known coin flip', () => {
    const spec = defineEval({
      configs: [{ label: 'flip', params: 1.98 }],
      playRound: (pay, rng) => ({ multiplier: rng.next() < 0.5 ? pay : 0, steps: 1 }),
    });
    const [r] = runEval(spec, { rounds: 200_000 });
    expect(Math.abs(r.rtp - 0.99)).toBeLessThan(4 * r.stdError);
    expect(r.hitRate).toBeCloseTo(0.5, 2);
    expect(r.max).toBe(1.98);
  });
});
