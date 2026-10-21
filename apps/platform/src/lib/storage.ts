import { createStore, type WritableStore } from '@originals/game-sdk';

/** localStorage, or undefined where it is blocked (private mode, sandboxed frames). */
export function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** A store whose value is saved as JSON and restored on the next visit. */
export function persistedStore<T extends object>(key: string, defaults: T): WritableStore<T> {
  const storage = safeStorage();
  let initial = defaults;
  try {
    const raw = storage?.getItem(key);
    if (raw) initial = { ...defaults, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    /* corrupt or unavailable: fall back to defaults */
  }
  const store = createStore(initial);
  store.subscribe((value) => {
    try {
      storage?.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  });
  return store;
}
