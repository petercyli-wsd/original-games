// Several open bets at once, one per ball in flight. The kit's useTicket keeps a
// single ticket per round; Plinko lets players drop balls faster than they land,
// so each ball carries its own BetTicket. Every ball's outcome is drawn the
// moment it is dropped (`resolve`), and if the game unmounts mid-flight each
// open ticket settles at that drawn result: leaving can't dodge a ball.

import type { BetTicket } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import { useEffect, useMemo, useRef } from 'react';

interface Open {
  ticket: BetTicket;
  /** The drawn multiplier (0 until resolved, which happens synchronously after place). */
  value: number;
}

export interface Tickets {
  /** Debits one ball's stake. Resolves to a ticket id, or null if refused. */
  place(amount: number): Promise<number | null>;
  /** Records the drawn multiplier for an open ticket. */
  resolve(id: number, multiplier: number): void;
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
      async place(amount) {
        placing.current++;
        try {
          const ticket = await wallet.placeBet(amount);
          if (!mounted.current) {
            // Nothing was drawn for this bet: return the stake.
            void ticket.settle(1).catch(() => {});
            return null;
          }
          const id = ++seq.current;
          open.current.set(id, { ticket, value: 0 });
          return id;
        } catch {
          return null;
        } finally {
          placing.current--;
        }
      },
      resolve(id, multiplier) {
        const o = open.current.get(id);
        if (o) o.value = multiplier;
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
