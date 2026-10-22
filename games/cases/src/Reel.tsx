// One horizontal case reel. The strip is a row of item cards; the marker sits
// at the centre of the window. A spin starts with START_SLOT under the marker
// and eases out until WIN_SLOT (offset by the cosmetic jitter) is under it.
// The position is driven by --pos/--j on the strip so the transform transition
// does the animation; a skip snaps from the current matrix to the stop point.

import { useLayoutEffect, useRef } from 'react';
import { ItemCard, MysteryCard } from './Item';
import { START_SLOT, WIN_SLOT } from './math';

export type ReelPhase = 'preview' | 'spinning' | 'done';

export function Reel({
  mults,
  strip,
  jitter,
  phase,
  durationMs,
  skip,
}: {
  /** Multiplier of each item in the case. */
  mults: readonly number[];
  strip: readonly number[];
  jitter: number;
  phase: ReelPhase;
  durationMs: number;
  skip: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Mount (the parent keys each spin): jump to the start, then ease to the stop.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (phase !== 'spinning') {
      el.style.transition = 'none';
      el.style.setProperty('--pos', String(WIN_SLOT));
      el.style.setProperty('--j', phase === 'done' ? String(jitter) : '0');
      return;
    }
    el.style.transition = 'none';
    el.style.setProperty('--pos', String(START_SLOT));
    el.style.setProperty('--j', '0');
    void el.offsetWidth;
    el.style.transition = `transform ${durationMs}ms cubic-bezier(0.12, 0.6, 0.08, 1)`;
    el.style.setProperty('--pos', String(WIN_SLOT));
    el.style.setProperty('--j', String(jitter));
    // Only on mount: the parent remounts the reel for every spin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once stopped, drop the long transition so a resize re-centres at once.
  useLayoutEffect(() => {
    if (phase === 'done' && ref.current) ref.current.style.transition = 'none';
  }, [phase]);

  // Skip: freeze where the strip is, then snap quickly to the stop point.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !skip) return;
    const now = getComputedStyle(el).transform;
    el.style.transition = 'none';
    el.style.transform = now;
    void el.offsetWidth;
    el.style.transition = 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)';
    el.style.transform = '';
  }, [skip]);

  return (
    <div className={`cs-reel ${phase}`}>
      <div className="cs-window">
        <div ref={ref} className="cs-strip">
          {strip.map((idx, i) =>
            phase === 'preview' && i === WIN_SLOT ? (
              <MysteryCard key={i} />
            ) : (
              <ItemCard key={i} mult={mults[idx]} className={i === WIN_SLOT ? (phase === 'done' ? 'hit' : '') : phase === 'done' ? 'dim' : ''} />
            ),
          )}
        </div>
      </div>
      <i className="cs-marker top" aria-hidden="true" />
      <i className="cs-marker bottom" aria-hidden="true" />
      <i className="cs-line" aria-hidden="true" />
    </div>
  );
}
