import type { CSSProperties } from 'react';
import { gridColumns } from './math';
import type { CardState } from './round';

interface Props {
  board: CardState[];
  /** Winner shown faintly once a round is lost or sold. */
  ghost: number | null;
  /** The card being scratched right now, keyed so the wipe replays. */
  anim: { i: number; id: number } | null;
  playable: boolean;
  /** Dim the board (preview before a bet). */
  preview: boolean;
  /** The round has ended: covered cards fade back. */
  over: boolean;
  onScratch(i: number): void;
}

/** Geometric scratch cards: a foil that wipes away to a miss (X) or the gold diamond. */
export default function Board({ board, ghost, anim, playable, preview, over, onScratch }: Props) {
  const n = board.length;
  const cols = gridColumns(n, 1.65);
  const colsSm = gridColumns(n, 0.95);
  const rows = Math.ceil(n / cols);
  const rowsSm = Math.ceil(n / colsSm);
  const style = {
    '--cols': cols,
    '--cols-sm': colsSm,
    '--ar': (cols * 3) / (rows * 4),
    '--ar-sm': (colsSm * 3) / (rowsSm * 4),
    '--gap': n > 60 ? '5px' : n > 24 ? '7px' : '10px',
  } as CSSProperties;

  return (
    <div className={'board' + (preview ? ' preview' : '') + (playable ? ' playable' : '')} style={style}>
      {board.map((state, i) => {
        const animating = anim?.i === i;
        const isGhost = ghost === i && state === 'hidden';
        const cls = ['card', state, animating ? 'animating' : '', isGhost ? 'ghost' : '', over && state === 'hidden' && !isGhost ? 'spent' : '']
          .filter(Boolean)
          .join(' ');
        return (
          <button
            key={i}
            className={cls}
            disabled={!playable || state !== 'hidden'}
            onClick={() => onScratch(i)}
            aria-label={state === 'hidden' ? `Card ${i + 1}, covered` : `Card ${i + 1}, ${state === 'win' ? 'winner' : 'miss'}`}
          >
            <span className="under" aria-hidden="true">
              {state === 'win' || isGhost ? (
                <svg viewBox="0 0 40 52">
                  <path className="gem" d="M20 8 L33 26 L20 44 L7 26 Z" />
                  <path className="gem-facet" d="M7 26 H33 M20 8 L15 26 L20 44 L25 26 Z" />
                </svg>
              ) : state === 'miss' ? (
                <svg viewBox="0 0 40 52">
                  <path className="x" d="M14 20 L26 32 M26 20 L14 32" />
                </svg>
              ) : null}
            </span>
            {(state === 'hidden' && !isGhost) || animating ? (
              <span className={'foil' + (animating ? ' wipe' : '')} key={animating ? anim.id : 'foil'} aria-hidden="true">
                <svg viewBox="0 0 40 52">
                  <path d="M20 16 L28 26 L20 36 L12 26 Z" />
                </svg>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
