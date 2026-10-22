// Several open bets at once, one per ball in flight. The kit's useTicket keeps a
// single ticket per round; Plinko lets players drop balls faster than they land,
// so each ball carries its own BetTicket. A ball's outcome is drawn inside
// `place`, in the same step that accepts the debited stake, so every open
// ticket always has a drawn result: if the game unmounts mid-flight each one
// settles at that result (leaving can't dodge a ball), and a stake accepted
// after unmount, with nothing drawn, is returned.

import type { BetTicket } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import { useEffect, useMemo, useRef } from 'react';

interface Open {
  ticket: BetTicket;
  /** The drawn multiplier. */
  value: number;
}

export interface Tickets {
  /**
   * Debits one ball's stake and, once accepted, draws its outcome with `draw`
   * in the same synchronous step. Resolves to the ticket id and the drawn
   * outcome, or null if the bet was refused or the game has gone.
   */
  place<T extends { multiplier: number }>(amount: number, draw: () => T): Promise<{ id: number; result: T } | null>;
  /** Pays the ticket and closes it. Safe to call twice. */
  settle(id: number, multiplier: number): void;
  /** Open tickets (balls in flight or being placed). */
  count(): number;
}

export function useTickets(): Tickets {
  const { wallet } = useHost();
  const open = useRef(new Map<number, Open>());
  const placing = useRef(0);
  const mounted = useRef(true);
  const seq = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const map = open.current;
    return () => {
      mounted.current = false;
      for (const o of map.values()) void o.ticket.settle(o.value).catch(() => {});
      map.clear();
    };
  }, []);

  return useMemo<Tickets>(
    () => ({
      async place(amount, draw) {
        placing.current++;
        try {
          const ticket = await wallet.placeBet(amount);
          if (!mounted.current) {
            // Nothing was drawn for this bet: return the stake.
            void ticket.settle(1).catch(() => {});
            return null;
          }
          const result = draw();
          const id = ++seq.current;
          open.current.set(id, { ticket, value: result.multiplier });
          return { id, result };
        } catch {
          return null;
        } finally {
          placing.current--;
        }
      },
      settle(id, multiplier) {
        const o = open.current.get(id);
        if (!o) return;
        open.current.delete(id);
        void o.ticket.settle(multiplier).catch(() => {});
      },
      count: () => open.current.size + placing.current,
    }),
    [wallet],
  );
}
