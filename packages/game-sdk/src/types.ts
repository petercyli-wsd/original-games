// The contract between the platform and a game. Games depend on these types
// only; the platform (or the standalone dev host) provides the implementations.

export type Volatility = 'low' | 'medium' | 'high' | 'extreme';

/** The maths family a game belongs to. Drives lobby filters and eval grouping. */
export type Mechanic = 'mines' | 'crash' | 'random-walk' | 'graph' | 'urn' | 'geometry' | 'duel' | 'other';

/** `template` games are hidden from production lobbies. */
export type GameStatus = 'template' | 'prototype' | 'beta' | 'live';

export interface GameManifest {
  /** kebab-case, must match the folder name under games/. Used in URLs. */
  id: string;
  name: string;
  /** One line for the lobby card. */
  tagline: string;
  mechanic: Mechanic;
  status: GameStatus;
  /** Long-run return to player, the same for every strategy, e.g. 0.99. */
  rtp: number;
  /** Largest multiplier reachable under any setting. */
  maxMultiplier: number;
  /** Volatility settings the player can choose between. */
  volatility: Volatility[];
  /** Whether a round pauses at checkpoints where the player can cash out. */
  checkpoints: boolean;
  /** Card colour in the lobby (CSS colour). */
  accent: string;
}

export interface ReadableStore<T> {
  get(): T;
  subscribe(listener: (value: T) => void): () => void;
}

export interface BetTicket {
  readonly id: string;
  readonly amount: number;
  /** Ends the round, paying amount × multiplier (0 = loss). Resolves to the payout. */
  settle(multiplier: number): Promise<number>;
}

/** Async throughout so a server-side wallet (RGS) can replace the demo one. */
export interface Wallet {
  readonly currency: string;
  readonly balance: ReadableStore<number>;
  /** Debits the stake. Rejects with InsufficientFundsError if the balance is too low. */
  placeBet(amount: number): Promise<BetTicket>;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Returns a shuffled copy. */
  shuffle<T>(items: readonly T[]): T[];
}

export interface HostSettings {
  turbo: boolean;
  sound: boolean;
}

export type GameEvent =
  | { type: 'checkpoint'; multiplier: number; winChance?: number }
  | { type: 'custom'; name: string; data?: Record<string, unknown> };

export interface HostContext {
  wallet: Wallet;
  rng: Rng;
  settings: ReadableStore<HostSettings>;
  /** Analytics hook. Bets and settlements are tracked automatically. */
  track(event: GameEvent): void;
}

export type Unmount = () => void;

export interface GameModule {
  /**
   * Renders the game into `target`, which sits inside its own shadow root so
   * game CSS cannot leak into the platform or other games. Returns a cleanup.
   */
  mount(target: HTMLElement, host: HostContext): Unmount;
}
