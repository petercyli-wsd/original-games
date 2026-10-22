import { describe, expect, it, vi } from 'vitest';
import { createDemoWallet } from '../wallet';
import type { BetTicket, Wallet } from '../types';
import { createTicketLifecycle } from './ticket-lifecycle';

function delayedWallet() {
  const wallet = createDemoWallet({ initialBalance: 100 });
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  const delayed: Wallet = {
    ...wallet,
    async placeBet(amount) {
      const ticket = await wallet.placeBet(amount);
      await ready;
      return ticket;
    },
  };
  return { wallet: delayed, release };
}

describe('ticket lifecycle across asynchronous navigation', () => {
  it('refunds a bet accepted after leaving, without starting the round', async () => {
    const { wallet, release } = delayedWallet();
    const round = createTicketLifecycle(wallet, () => 0);
    const pending = round.place(10);
    expect(wallet.balance.get()).toBe(90);
    round.dispose();
    release();
    expect(await pending).toBe(false);
    expect(wallet.balance.get()).toBe(100);
    expect(round.active()).toBe(false);
  });

  it('rejects concurrent bets and settles the resolved outcome exactly once', async () => {
    const { wallet, release } = delayedWallet();
    let resolved = 0.99;
    const round = createTicketLifecycle(wallet, () => resolved);
    const first = round.place(10);
    expect(round.active()).toBe(true);
    expect(await round.place(10)).toBe(false);
    release();
    expect(await first).toBe(true);
    resolved = 0;
    round.dispose();
    round.settle(2);
    round.dispose();
    expect(wallet.balance.get()).toBe(90);
  });

  it('uses the latest checkpoint value on leaving', async () => {
    const wallet = createDemoWallet({ initialBalance: 100 });
    let value = 0.99;
    const round = createTicketLifecycle(wallet, () => value);
    await round.place(10);
    value = 1.5;
    round.dispose();
    expect(wallet.balance.get()).toBe(105);
  });

  it('does not attach a stale request to a remounted lifecycle', async () => {
    const { wallet, release } = delayedWallet();
    const round = createTicketLifecycle(wallet, () => 0);
    const pending = round.place(10);
    round.dispose();
    round.activate();
    release();
    expect(await pending).toBe(false);
    expect(wallet.balance.get()).toBe(100);
    expect(await round.place(10)).toBe(true);
    round.settle(2);
    expect(wallet.balance.get()).toBe(110);
  });

  it('rejects invalid settlements without discarding the open ticket', async () => {
    const settle = vi.fn(async () => 0);
    const wallet = createDemoWallet();
    const ticket: BetTicket = { id: 'test', amount: 1, settle };
    const round = createTicketLifecycle({ ...wallet, placeBet: async () => ticket }, () => 0.99);
    await round.place(1);
    expect(() => round.settle(NaN)).toThrow(RangeError);
    expect(round.active()).toBe(true);
    round.settle(0);
    round.settle(2);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith(0);
  });
});
