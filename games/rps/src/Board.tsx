import { HAND_NAMES, type Effect, type Hand, type Throw } from './math';

/** A plain geometric hand mark, drawn in a 100×100 box centred on (0, 0) in the current colour: rock is a disc, paper a square, scissors a cross. */
export function HandShape({ hand }: { hand: Hand }) {
  if (hand === 0) return <circle className="hs" cx={0} cy={0} r={30} fill="currentColor" />;
  if (hand === 1) return <rect className="hs" x={-28} y={-28} width={56} height={56} rx={3} fill="currentColor" />;
  return <path className="hs" d="M-26 -26 L26 26 M26 -26 L-26 26" fill="none" stroke="currentColor" strokeWidth={12} strokeLinecap="butt" />;
}

/** A small stand-alone icon for buttons. */
export function HandIcon({ hand, className }: { hand: Hand; className?: string }) {
  return (
    <svg viewBox="-50 -50 100 100" className={'rps-icon' + (className ? ` ${className}` : '')} aria-hidden="true">
      <HandShape hand={hand} />
    </svg>
  );
}

const TONE: Record<Effect, string> = { advance: 'win', replay: 'draw', bust: 'lose' };

export interface DuelProps {
  /** The hand the player shows (selected hand when idle). */
  player: Hand;
  /** The house hand to show, or null for the hidden "?" face. */
  house: Hand | null;
  /** The throw being animated. */
  throwing: boolean;
  /** The last resolved throw, to colour the result. */
  last: Throw | null;
  /** Centre word and its small line. */
  centre: { word: string; sub: string } | null;
}

function Side({ who, hand, tone }: { who: 'you' | 'house'; hand: Hand | null; tone: string }) {
  return (
    <div className={`side ${who} ${tone}`}>
      <div className="face">
        {hand === null ? (
          <span className="hidden-face">?</span>
        ) : (
          <>
            <svg viewBox="-50 -50 100 100" className="glyph" aria-hidden="true">
              <HandShape hand={hand} />
            </svg>
            <span className="hand-name">{HAND_NAMES[hand]}</span>
          </>
        )}
      </div>
      <span className="tag">{who === 'you' ? 'You' : 'House'}</span>
    </div>
  );
}

export default function Duel({ player, house, throwing, last, centre }: DuelProps) {
  const tone = !throwing && last ? TONE[last.effect] : null;
  const pTone = tone ?? '';
  const hTone = tone ? (tone === 'win' ? 'lose' : tone === 'lose' ? 'win' : 'draw') : '';

  return (
    <div className="rps-duel" role="img" aria-label={centre ? `${centre.word}: ${centre.sub}` : 'Pick a hand and bet'}>
      <Side who="you" hand={player} tone={pTone} />
      <div className={'centre ' + (tone ?? '')}>
        {centre ? (
          <>
            <span className="word">{centre.word}</span>
            <span className="sub">{centre.sub}</span>
          </>
        ) : (
          <span className="vs">VS</span>
        )}
      </div>
      <Side who="house" hand={house} tone={hTone} />
    </div>
  );
}
