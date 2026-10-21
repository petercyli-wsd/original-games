import { mountInShadow, type HostContext } from '@originals/game-sdk';
import { useEffect, useRef, useState } from 'react';
import type { GameEntry } from '../registry';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Lazy-loads a game and mounts it in a shadow root. A game that throws while
 * loading or mounting shows an error here instead of taking down the site.
 */
export function GameFrame({ entry, host }: { entry: GameEntry; host: HostContext }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let cancelled = false;
    let unmount: (() => void) | undefined;
    setState('loading');

    entry
      .load()
      .then((game) => {
        if (cancelled || !ref.current) return;
        unmount = mountInShadow(game, ref.current, host);
        setState('ready');
      })
      .catch((err: unknown) => {
        console.error(`Failed to start ${entry.manifest.id}`, err);
        if (!cancelled) setState('error');
      });

    return () => {
      cancelled = true;
      unmount?.();
    };
  }, [entry, host]);

  return (
    <div className="game-frame" data-state={state}>
      <div ref={ref} className="game-mount" />
      {state === 'loading' && <div className="frame-overlay">Loading {entry.manifest.name}…</div>}
      {state === 'error' && (
        <div className="frame-overlay error">
          {entry.manifest.name} failed to load.
          <button className="btn-ghost" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}
    </div>
  );
}
