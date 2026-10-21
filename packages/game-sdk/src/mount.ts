import type { GameModule, HostContext, Unmount } from './types';

/**
 * Mounts a game inside a shadow root on `host`, so the game's styles are
 * isolated. Used by both the platform and standalone dev pages, so a game
 * renders the same in each.
 */
export function mountInShadow(game: GameModule, el: HTMLElement, host: HostContext): Unmount {
  const shadow = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
  const target = document.createElement('div');
  target.style.height = '100%';
  shadow.replaceChildren(target);
  const unmount = game.mount(target, host);
  return () => {
    unmount();
    shadow.replaceChildren();
  };
}
