import type { CSSProperties } from 'react';
import { total } from './math';

export const COLOURS = [
  { name: 'Red', fill: '#e5484d', ink: '#fff' },
  { name: 'Blue', fill: '#3b82f6', ink: '#fff' },
  { name: 'Green', fill: '#2fb36b', ink: '#07140c' },
  { name: 'Yellow', fill: '#f4e04d', ink: '#1a1604' },
] as const;

export function fmtChance(p: number): string {
  const x = p * 100;
  if (x >= 99.95) return '100%';
  if (x >= 10) return `${x.toFixed(1)}%`;
  if (x >= 0.1) return `${x.toFixed(2)}%`;
  return x === 0 ? '0%' : '<0.1%';
}

const short = (p: number) => `${Math.round(p * 100)}%`;

function Slot({ colour, label, snap, fresh, ms }: { colour: number | null; label: string; snap: boolean; fresh: boolean; ms: number }) {
  const c = colour !== null && colour >= 0 ? COLOURS[colour] : null;
  return (
    <div className="b2b-slot">
      <span className="b2b-slot-cap">{label}</span>
      <div
        key={fresh ? `new-${colour}` : `old-${colour}`}
        className={'b2b-card' + (c ? '' : ' empty') + (snap ? ' snap' : '') + (fresh ? ' fresh' : '')}
        style={{ background: c?.fill, color: c?.ink, '--ms': `${ms}ms` } as CSSProperties}
      >
        {c ? c.name : '—'}
      </div>
    </div>
  );
}

interface FieldProps {
  counts: readonly number[];
  top: number;
  /** The card turned before the top one (the other half of the pair). */
  prev: number;
  /** Colour being turned right now. */
  drawing: number | null;
  pile: readonly number[];
  me: number;
  /** Chance each colour snaps first, from this state. */
  chances: readonly number[];
  /** My chance if each colour is the next card. */
  ghosts: readonly number[] | null;
  /** The last two cards matched: that colour won. */
  snapped: boolean;
  /** My chance now, for colouring the ghosts. */
  mine: number;
  live: boolean;
  ms: number;
}

export default function Field({ counts, top, prev, drawing, pile, me, chances, ghosts, snapped, mine, live, ms }: FieldProps) {
  const n = total(counts);
  const shownTop = drawing !== null ? drawing : top;
  const shownPrev = drawing !== null ? top : prev;
  const cap = top >= 0 && !snapped ? `Outlined: another ${COLOURS[top].name.toLowerCase()} snaps it (${fmtChance(counts[top] / Math.max(1, n))})` : 'The first card turned cannot snap';

  return (
    <div className="b2b">
      <div className="b2b-cap">
        <span>Deck · cards left by colour</span>
        <b>{n} left</b>
      </div>
      <div className="b2b-deck" role="img" aria-label={`Deck: ${counts.map((c, j) => `${c} ${COLOURS[j].name}`).join(', ')}`}>
        {counts.map((c, j) =>
          c === 0 ? null : (
            <div
              key={j}
              className={'b2b-seg' + (top === j && !snapped ? ' snap' : '') + (drawing === j ? ' pulse' : '')}
              style={{ flexGrow: c, background: COLOURS[j].fill, color: COLOURS[j].ink }}
            >
              <b>{c}</b>
              <span>{short(c / n)}</span>
            </div>
          ),
        )}
      </div>
      {ghosts && (
        <div className="b2b-ghosts" aria-hidden="true">
          {counts.map((c, j) =>
            c === 0 ? null : (
              <i key={j} style={{ flexGrow: c }} className={ghosts[j] > mine + 1e-9 ? 'up' : ghosts[j] < mine - 1e-9 ? 'down' : ''}>
                {short(ghosts[j])}
              </i>
            ),
          )}
        </div>
      )}
      <div className="b2b-note">{ghosts ? `Under each segment: your chance if that colour is the next card. ${cap}.` : 'Round over. The last two cards stay marked until the next bet.'}</div>

      <div className={'b2b-pair' + (snapped ? ' snapped' : '')}>
        <Slot colour={shownPrev >= 0 ? shownPrev : null} label="Before" snap={snapped} fresh={false} ms={ms} />
        <span className="b2b-eq">{snapped ? 'SNAP' : '='}</span>
        <Slot colour={shownTop >= 0 ? shownTop : null} label={live || snapped ? 'Turned' : 'Next'} snap={snapped} fresh={drawing !== null} ms={ms} />
      </div>

      <div className="b2b-strip" aria-label="Cards turned so far">
        {pile.length === 0 ? (
          <em>cards turned so far appear here</em>
        ) : (
          pile.map((c, i) => <i key={i} style={{ background: COLOURS[c].fill }} className={i >= pile.length - 2 ? 'last' : ''} title={COLOURS[c].name} />)
        )}
      </div>

      <div className="b2b-cap">
        <span>Chance to snap first</span>
        <b>
          you: <u>{COLOURS[me].name}</u>
        </b>
      </div>
      <div className="b2b-title">
        {chances.map((p, j) =>
          p <= 0 ? null : (
            <div key={j} className={'b2b-tseg' + (j === me ? ' mine' : '')} style={{ flexGrow: p, background: COLOURS[j].fill, color: COLOURS[j].ink }} title={`${COLOURS[j].name} ${fmtChance(p)}`}>
              {p > 0.07 ? short(p) : ''}
            </div>
          ),
        )}
      </div>
      <div className="b2b-legend">
        {chances.map((p, j) =>
          p <= 0 ? null : (
            <span key={j} className={j === me ? 'mine' : ''}>
              <i style={{ background: COLOURS[j].fill }} />
              {COLOURS[j].name} {fmtChance(p)}
            </span>
          ),
        )}
      </div>
    </div>
  );
}
