import type { ReadableStore } from './types';

export interface WritableStore<T> extends ReadableStore<T> {
  set(value: T): void;
}

// Methods are closures (no `this`) so they can be passed straight to
// React's useSyncExternalStore.
export function createStore<T>(initial: T): WritableStore<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of listeners) listener(value);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
