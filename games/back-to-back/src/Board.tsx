import type { CSSProperties } from 'react';
import { ACCENTS } from '@originals/game-sdk/ui';
import { total } from './math';

// Team colours: the rules name them. Red and Green use the kit's content colours,
// Blue and Yellow use the kit accent palette (no raw hex, docs/STYLE.md).
export const COLOURS = [
  { name: 'Red', fill: 'var(--suit-red)', ink: 'var(--text)' },
  { name: 'Blue', fill: ACCENTS.blue, ink: 'var(--bg)' },
  { name: 'Green', fill: 'var(--suit-green)', ink: 'var(--text)' },
  { name: 'Yellow', fill: ACCENTS.amber, ink: 'var(--bg)' },
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
  const cap = top >= 0 && !snapped ? 'Outlined: snaps if turned next' : 'The first card turned cannot snap';

  return (
    <div className="b2b">
      <div className="b2b-cap">
        <span>Cards left by colour</span>
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
      <div className="b2b-note">
        {ghosts ? (
          <>
            <span>Below: your chance if it is next</span>
            <span>{cap}</span>
          </>
        ) : (
          <span>Round over: last two cards stay marked</span>
        )}
      </div>

      <div className={'b2b-pair' + (snapped ? ' snapped' : '')}>
        <Slot colour={shownPrev >= 0 ? shownPrev : null} label="Before" snap={snapped} fresh={false} ms={ms} />
        <span className="b2b-eq">{snapped ? 'Snap' : '='}</span>
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
          you: {COLOURS[me].name}
        </b>
      </div>
      <div className="b2b-title">
        {chances.map((p, j) =>
          p <= 0 ? null : (
            <div key={j} className={'b2b-tseg' + (j === me ? ' mine' : '')} style={{ flexGrow: p, background: COLOURS[j].fill, color: COLOURS[j].ink }} title={`${COLOURS[j].name} ${fmtChance(p)}`} />
          ),
        )}
      </div>
    </div>
  );
}
