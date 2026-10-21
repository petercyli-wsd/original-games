// Helpers for running a single game on its own (`npm run dev` inside games/<id>).

import { mountInShadow } from './mount';
import { createRng } from './rng';
import { createStore } from './store';
import type { GameModule, HostContext, HostSettings, Unmount } from './types';
import { createDemoWallet } from './wallet';

export function createDemoHost(overrides: Partial<HostContext> = {}): HostContext {
  return {
    wallet: createDemoWallet(),
    rng: createRng(),
    settings: createStore<HostSettings>({ turbo: false, sound: true }),
    track: (event) => console.debug('[track]', event),
    ...overrides,
  };
}

export function mountStandalone(game: GameModule, el: HTMLElement, host = createDemoHost()): Unmount {
  return mountInShadow(game, el, host);
}
