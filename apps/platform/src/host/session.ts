// Platform-side implementation of the game host: one shared wallet and
// settings for the whole site, plus per-game session stats captured by
// wrapping the wallet, so games get analytics without doing anything.

import {
  createDemoWallet,
  createRng,
  createStore,
  type BetTicket,
  type HostContext,
  type HostSettings,
  type Wallet,
} from '@originals/game-sdk';
import { BRAND } from '../brand';
import { persistedStore, safeStorage } from '../lib/storage';

export const wallet = createDemoWallet({
  initialBalance: BRAND.startingBalance,
  currency: BRAND.currency,
  storage: safeStorage(),
  storageKey: 'originals.balance',
});

export const settings = persistedStore<HostSettings>('originals.settings', { turbo: false, sound: true });

export interface GameStats {
  rounds: number;
  wagered: number;
  returned: number;
  wins: number;
  checkpoints: number;
  totalMs: number;
  bestMultiplier: number;
}

export const EMPTY_STATS: GameStats = {
  rounds: 0,
  wagered: 0,
  returned: 0,
  wins: 0,
  checkpoints: 0,
  totalMs: 0,
  bestMultiplier: 0,
};

export const sessionStats = createStore<Record<string, GameStats>>({});

function updateStats(gameId: string, update: (s: GameStats) => Partial<GameStats>) {
  const all = sessionStats.get();
  const current = all[gameId] ?? EMPTY_STATS;
  sessionStats.set({ ...all, [gameId]: { ...current, ...update(current) } });
}

export function resetStats(gameId: string) {
  const { [gameId]: _, ...rest } = sessionStats.get();
  sessionStats.set(rest);
}

function instrumentWallet(inner: Wallet, gameId: string): Wallet {
  return {
    currency: inner.currency,
    balance: inner.balance,
    async placeBet(amount) {
      const ticket = await inner.placeBet(amount);
      const startedAt = performance.now();
      const wrapped: BetTicket = {
        id: ticket.id,
        amount: ticket.amount,
        async settle(multiplier) {
          const payout = await ticket.settle(multiplier);
          updateStats(gameId, (s) => ({
            rounds: s.rounds + 1,
            wagered: s.wagered + amount,
            returned: s.returned + payout,
            wins: s.wins + (multiplier > 0 ? 1 : 0),
            totalMs: s.totalMs + (performance.now() - startedAt),
            bestMultiplier: Math.max(s.bestMultiplier, multiplier),
          }));
          return payout;
        },
      };
      return wrapped;
    },
  };
}

export function createHost(gameId: string): HostContext {
  return {
    wallet: instrumentWallet(wallet, gameId),
    rng: createRng(),
    settings,
    track(event) {
      if (event.type === 'checkpoint') updateStats(gameId, (s) => ({ checkpoints: s.checkpoints + 1 }));
      if (import.meta.env.DEV) console.debug(`[${gameId}]`, event);
    },
  };
}
