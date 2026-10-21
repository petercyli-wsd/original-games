import { floor8 } from './money';
import { createStore } from './store';
import type { BetTicket, Wallet } from './types';

export class InsufficientFundsError extends Error {
  constructor(
    readonly amount: number,
    readonly balance: number,
  ) {
    super(`Bet of ${amount} exceeds balance of ${balance}`);
    this.name = 'InsufficientFundsError';
  }
}

export interface DemoWallet extends Wallet {
  reset(balance?: number): void;
}

export interface DemoWalletOptions {
  initialBalance?: number;
  currency?: string;
  /** Persists the balance between visits when given. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  storageKey?: string;
}

/** A client-side play-money wallet. A real deployment swaps in a server wallet. */
export function createDemoWallet({
  initialBalance = 1000,
  currency = 'DEMO',
  storage,
  storageKey = 'originals.balance',
}: DemoWalletOptions = {}): DemoWallet {
  const read = () => {
    try {
      const saved = parseFloat(storage?.getItem(storageKey) ?? '');
      return Number.isFinite(saved) && saved >= 0 ? saved : initialBalance;
    } catch {
      return initialBalance;
    }
  };
  const balance = createStore(read());
  const write = (value: number) => {
    balance.set(value);
    try {
      storage?.setItem(storageKey, String(value));
    } catch {
      /* storage unavailable: balance lasts for this session only */
    }
  };
  let seq = 0;

  return {
    currency,
    balance,
    async placeBet(amount) {
      if (!Number.isFinite(amount) || amount <= 0) throw new RangeError('Bet must be a positive number');
      if (amount > balance.get()) throw new InsufficientFundsError(amount, balance.get());
      write(floor8(balance.get() - amount));
      let settled = false;
      const ticket: BetTicket = {
        id: `bet-${Date.now().toString(36)}-${++seq}`,
        amount,
        async settle(multiplier) {
          if (settled) throw new Error(`Bet ${ticket.id} is already settled`);
          if (!Number.isFinite(multiplier) || multiplier < 0) throw new RangeError('Multiplier must be >= 0');
          settled = true;
          const payout = floor8(amount * multiplier);
          write(floor8(balance.get() + payout));
          return payout;
        },
      };
      return ticket;
    },
    reset(value = initialBalance) {
      write(value);
    },
  };
}
