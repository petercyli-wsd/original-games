import { createContext, useContext, useSyncExternalStore, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import type { GameModule, HostContext, HostSettings, ReadableStore } from './types';

const HostCtx = createContext<HostContext | null>(null);

export interface ReactGameOptions {
  /** CSS injected into the game's shadow root. Import it with `?inline`. */
  styles?: string;
}

/** Wraps a React component as a GameModule. */
export function defineReactGame(Component: ComponentType, { styles }: ReactGameOptions = {}): GameModule {
  return {
    mount(target, host) {
      if (styles) {
        const style = document.createElement('style');
        style.textContent = styles;
        target.append(style);
      }
      const container = document.createElement('div');
      container.style.display = 'contents';
      target.append(container);
      const root = createRoot(container);
      root.render(
        <HostCtx.Provider value={host}>
          <Component />
        </HostCtx.Provider>,
      );
      return () => {
        root.unmount();
        target.replaceChildren();
      };
    },
  };
}

export function useHost(): HostContext {
  const host = useContext(HostCtx);
  if (!host) throw new Error('useHost() must be used inside a game made with defineReactGame()');
  return host;
}

export function useStore<T>(store: ReadableStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

export const useBalance = () => useStore(useHost().wallet.balance);
export const useSettings = (): HostSettings => useStore(useHost().settings);

export { RoundOver, type RoundOverProps } from './round-over';
