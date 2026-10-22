import type { BetTicket, Wallet } from '../types';

/** One round's asynchronous wallet lifecycle, independent of React. */
export function createTicketLifecycle(wallet: Wallet, fairValue: () => number) {
  let ticket: BetTicket | null = null;
  let placing = false;
  let mounted = true;
  let generation = 0;

  return {
    activate() {
      mounted = true;
    },
    async place(amount: number): Promise<boolean> {
      if (!mounted || placing || ticket) return false;
      placing = true;
      const started = generation;
      try {
        const accepted = await wallet.placeBet(amount);
        if (!mounted || started !== generation) {
          // The UI never started this round or sampled an outcome. Return the
          // stake even if an old request completes after a StrictMode remount.
          await accepted.settle(1);
          return false;
        }
        ticket = accepted;
        return true;
      } catch {
        return false;
      } finally {
        placing = false;
      }
    },
    settle(multiplier: number) {
      if (!Number.isFinite(multiplier) || multiplier < 0) {
        throw new RangeError('Settlement multiplier must be finite and nonnegative');
      }
      const accepted = ticket;
      ticket = null;
      if (accepted) void accepted.settle(multiplier);
    },
    active: () => placing || ticket !== null,
    dispose() {
      mounted = false;
      generation++;
      const accepted = ticket;
      ticket = null;
      if (accepted) {
        const value = fairValue();
        if (!Number.isFinite(value) || value < 0) throw new RangeError('Invalid cash-out value on unmount');
        void accepted.settle(value);
      }
    },
  };
}
