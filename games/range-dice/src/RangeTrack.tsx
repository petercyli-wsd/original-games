// The 0–9999 track: green where the bet wins, red where it loses, two handles
// that set [low, high], a draggable band between them, the rolled marker and
// faint ticks for the last few rolls on this range.

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { MAX_N, SIZE, setEnd, shift, width, winZones, type Range } from './math';

export interface Marker {
  pos: number;
  value: number;
  tone: 'moving' | 'win' | 'lose';
  id: number;
}

export interface Ghost {
  id: number;
  n: number;
  win: boolean;
}

type Drag = { kind: 'low' | 'high' } | { kind: 'band'; offset: number };

const pct = (cells: number) => `${(cells / SIZE) * 100}%`;
export const fmtN = (n: number) => String(n).padStart(4, '0');

export default function RangeTrack({
  range,
  onChange,
  disabled,
  marker,
  ghosts,
}: {
  range: Range;
  onChange(r: Range): void;
  disabled?: boolean;
  marker: Marker | null;
  ghosts: Ghost[];
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const latest = useRef(range);
  latest.current = range;

  const cellAt = (clientX: number) => {
    const box = track.current!.getBoundingClientRect();
    return Math.min(SIZE, Math.max(0, ((clientX - box.left) / box.width) * SIZE));
  };

  const apply = (d: Drag, x: number) => {
    const r = latest.current;
    if (d.kind === 'band') onChange(shift(r, Math.round(x - d.offset)));
    else if (d.kind === 'low') onChange(setEnd(r, 'low', Math.round(x)));
    else onChange(setEnd(r, 'high', Math.round(x) - 1));
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    const x = cellAt(e.clientX);
    const target = (e.target as HTMLElement).closest('[data-end]') as HTMLElement | null;
    let d: Drag;
    if (target) d = { kind: target.dataset.end as 'low' | 'high' };
    else if (x >= range.low && x <= range.high + 1) d = { kind: 'band', offset: x - range.low };
    else d = { kind: x < range.low ? 'low' : 'high' };
    drag.current = d;
    track.current!.setPointerCapture(e.pointerId);
    if (d.kind !== 'band') apply(d, x);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) apply(drag.current, cellAt(e.clientX));
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (track.current?.hasPointerCapture(e.pointerId)) track.current.releasePointerCapture(e.pointerId);
  };

  const onKey = (end: 'low' | 'high') => (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = e.shiftKey ? 100 : 1;
    const cur = range[end];
    const next: Record<string, number> = {
      ArrowLeft: cur - big,
      ArrowDown: cur - big,
      ArrowRight: cur + big,
      ArrowUp: cur + big,
      PageDown: cur - 1000,
      PageUp: cur + 1000,
      Home: 0,
      End: MAX_N,
    };
    if (!(e.key in next)) return;
    e.preventDefault();
    onChange(setEnd(range, end, next[e.key]));
  };

  const zones = winZones(range);
  const band = { left: pct(range.low), width: pct(width(range)) };

  return (
    <div className={'rd-track-wrap' + (disabled ? ' locked' : '')}>
      {marker && (
        <div
          key={marker.tone === 'moving' ? 'm' : marker.id}
          className={`rd-marker ${marker.tone}`}
          style={{ left: pct(marker.pos) }}
          aria-live="polite"
        >
          <span style={{ transform: `translateX(${-(15 + 70 * (marker.pos / SIZE))}%)` }}>{fmtN(marker.value)}</span>
        </div>
      )}
      <div ref={track} className={'rd-track ' + range.dir} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="rd-rail" />
        {zones.map(([a, b]) => (
          <div key={a} className={'rd-zone' + (a === 0 ? ' start' : '') + (b === SIZE ? ' end' : '')} style={{ left: pct(a), width: pct(b - a) }} />
        ))}
        <div className="rd-band" style={band} />
        {ghosts.map((g) => (
          <i key={g.id} className={'rd-ghost' + (g.win ? ' w' : ' l')} style={{ left: pct(g.n + 0.5) }} />
        ))}
        {marker && marker.tone !== 'moving' && <i key={`p${marker.id}`} className={`rd-pulse ${marker.tone}`} style={{ left: pct(marker.pos) }} />}
        {(['low', 'high'] as const).map((end) => (
          <div
            key={end}
            data-end={end}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={end === 'low' ? 'Range low' : 'Range high'}
            aria-valuemin={0}
            aria-valuemax={MAX_N}
            aria-valuenow={range[end]}
            aria-disabled={disabled}
            className={`rd-handle ${end}`}
            style={{ left: pct(end === 'low' ? range.low : range.high + 1) }}
            onKeyDown={onKey(end)}
          >
            <b />
            <em>{fmtN(range[end])}</em>
          </div>
        ))}
      </div>
      <div className="rd-scale" aria-hidden="true">
        {[0, 2500, 5000, 7500, 10000].map((v) => (
          <span key={v} style={{ left: pct(v) }}>
            {v === 10000 ? '9999' : v}
          </span>
        ))}
      </div>
    </div>
  );
}
