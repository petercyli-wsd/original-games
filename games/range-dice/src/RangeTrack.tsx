// The 0.00–99.99 track: green where the bet wins, red where it loses, two or
// four handles that set the ranges, draggable bands between them, the rolled
// marker and faint ticks for the last few rolls on this set-up.

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { ENDS, MAX_N, SIZE, setEnd, shift, winZones, type Config, type EndKey } from './math';

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

type Drag = { kind: 'end'; end: EndKey } | { kind: 'band'; piece: 0 | 1; offset: number };

const pct = (cells: number) => `${(cells / SIZE) * 100}%`;
/** Cell n shown as 0.00–99.99. */
export const fmtN = (n: number) => (n / 100).toFixed(2);

const isHigh = (e: EndKey) => e === 'high' || e === 'high2';
/** Track position of a handle: low handles sit on the first cell, high handles after the last. */
const posOf = (c: Config, e: EndKey) => (isHigh(e) ? c[e] + 1 : c[e]);

export default function RangeTrack({
  range,
  onChange,
  disabled,
  marker,
  ghosts,
}: {
  range: Config;
  onChange(r: Config): void;
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
    if (d.kind === 'band') onChange(shift(r, d.piece, Math.round(x - d.offset)));
    else onChange(setEnd(r, d.end, Math.round(isHigh(d.end) ? x - 1 : x)));
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    const x = cellAt(e.clientX);
    const target = (e.target as HTMLElement).closest('[data-end]') as HTMLElement | null;
    let d: Drag | null = null;
    if (target) d = { kind: 'end', end: target.dataset.end as EndKey };
    else {
      const bands: [number, number][] =
        range.mode === 'two'
          ? [
              [range.low, range.high],
              [range.low2, range.high2],
            ]
          : [[range.low, range.high]];
      const hit = bands.findIndex(([a, b]) => x >= a && x <= b + 1);
      if (hit >= 0) d = { kind: 'band', piece: hit as 0 | 1, offset: x - bands[hit][0] };
      else {
        // Outside every band: the nearest handle jumps to the pointer.
        let best: EndKey = 'low';
        let dist = Infinity;
        for (const k of ENDS[range.mode]) {
          const dd = Math.abs(posOf(range, k) - x);
          if (dd < dist) {
            dist = dd;
            best = k;
          }
        }
        d = { kind: 'end', end: best };
      }
    }
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

  const onKey = (end: EndKey) => (e: KeyboardEvent<HTMLDivElement>) => {
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
  const bands: [number, number][] =
    range.mode === 'two'
      ? [
          [range.low, range.high],
          [range.low2, range.high2],
        ]
      : [[range.low, range.high]];
  const names: Record<EndKey, string> = { low: 'Low', high: 'High', low2: 'Second low', high2: 'Second high' };

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
      <div ref={track} className={'rd-track ' + range.mode} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="rd-rail" />
        {zones.map(([a, b]) => (
          <div key={a} className={'rd-zone' + (a === 0 ? ' start' : '') + (b === SIZE ? ' end' : '')} style={{ left: pct(a), width: pct(b - a) }} />
        ))}
        {bands.map(([a, b]) => (
          <div key={'b' + a} className="rd-band" style={{ left: pct(a), width: pct(b - a + 1) }} />
        ))}
        {ghosts.map((g) => (
          <i key={g.id} className={'rd-ghost' + (g.win ? ' w' : ' l')} style={{ left: pct(g.n + 0.5) }} />
        ))}
        {ENDS[range.mode].map((end) => (
          <div
            key={end}
            data-end={end}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={`Range ${names[end]}`}
            aria-valuemin={0}
            aria-valuemax={MAX_N}
            aria-valuenow={range[end]}
            aria-disabled={disabled}
            className={`rd-handle ${isHigh(end) ? 'high' : 'low'}`}
            style={{ left: pct(posOf(range, end)) }}
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
            {v / 100}
          </span>
        ))}
      </div>
    </div>
  );
}
