import type { Effect, Hand, Throw } from './math';

/** A geometric hand mark, drawn in a 100×100 box centred on (0, 0). */
export function HandShape({ hand }: { hand: Hand }) {
  if (hand === 0)
    return (
      <g className="hs rock">
        <path className="body" d="M-34 -6 L-20 -30 L6 -37 L31 -20 L37 8 L20 32 L-10 36 L-32 19 Z" />
        <path className="facet" d="M-34 -6 L-6 -6 L6 -37 M-6 -6 L37 8 M-6 -6 L-10 36" />
        <path className="shine" d="M-22 -24 L-4 -30" />
      </g>
    );
  if (hand === 1)
    return (
      <g className="hs paper" transform="rotate(-8)">
        <path className="body" d="M-26 -36 H12 L26 -22 V36 H-26 Z" />
        <path className="facet" d="M12 -36 V-22 H26" />
        <path className="lines" d="M-16 -14 H16 M-16 -2 H16 M-16 10 H16 M-16 22 H6" />
      </g>
    );
  return (
    <g className="hs scissors">
      <path className="blade" d="M-11 12 L18 -38" />
      <path className="blade" d="M11 12 L-18 -38" />
      <circle className="ring" cx={-15} cy={23} r={11} />
      <circle className="ring" cx={15} cy={23} r={11} />
      <circle className="pivot" cx={0} cy={-6.5} r={3.5} />
    </g>
  );
}

/** A small stand-alone icon for buttons and the throw log. */
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
  /** Big centre word and its small line. */
  centre: { word: string; sub: string } | null;
  /** Animation key, bumps per throw. */
  seq: number;
  shakeMs: number;
  /** The round-over card is up: the hands step apart to make room. */
  away?: boolean;
}

export default function Duel({ player, house, throwing, last, centre, seq, shakeMs, away }: DuelProps) {
  const tone = !throwing && last ? TONE[last.effect] : null;
  const pTone = tone ? (tone === 'win' ? 'win' : tone === 'lose' ? 'lose' : 'draw') : '';
  const hTone = tone ? (tone === 'win' ? 'lose' : tone === 'lose' ? 'win' : 'draw') : '';
  const style = { animationDuration: `${shakeMs}ms` };

  return (
    <svg viewBox="0 0 640 290" className={'rps-duel' + (away ? ' away' : '')} role="img" aria-label={centre ? `${centre.word}: ${centre.sub}` : 'Pick a hand and bet'}>
      <defs>
        <radialGradient id="rps-disc" cx="50%" cy="38%" r="65%">
          <stop offset="0%" stopColor="#2a2433" />
          <stop offset="100%" stopColor="#141219" />
        </radialGradient>
      </defs>

      {/* The clash line between the two hands. */}
      <line x1={262} y1={140} x2={378} y2={140} className={'clash-line' + (tone ? ` ${tone}` : '')} />

      <g className={'side you ' + pTone} transform="translate(160 140)">
        <g className="step">
        <circle r={104} className="halo" />
        <circle r={92} className="disc" />
        <circle r={92} className="ring" />
        <g key={`p${seq}`} className={throwing ? 'shake' : last ? 'pop' : ''} style={style}>
          <g transform="scale(1.32)">
            <HandShape hand={player} />
          </g>
        </g>
        </g>
      </g>

      <g className={'side house ' + hTone} transform="translate(480 140)">
        <g className="step">
        <circle r={104} className="halo" />
        <circle r={92} className="disc" />
        <circle r={92} className="ring" />
        <g key={`h${seq}`} className={throwing ? 'shake' : last ? 'pop' : ''} style={style}>
          {house === null ? (
            <text className="hidden-face" y={22}>
              ?
            </text>
          ) : (
            <g transform="scale(1.32)" className={throwing ? 'cycling' : ''}>
              <HandShape hand={house} />
            </g>
          )}
        </g>
        </g>
      </g>

      <g className="centre" transform="translate(320 140)">
        {centre ? (
          <g key={`c${seq}`} className={'verdict ' + (tone ?? '')}>
            <text className="word" y={4}>
              {centre.word}
            </text>
            <text className="sub" y={28}>
              {centre.sub}
            </text>
          </g>
        ) : (
          <text className="vs" y={10}>
            VS
          </text>
        )}
      </g>

      <g className="tags">
        <text x={160} y={276} className="tag you">
          YOU
        </text>
        <text x={480} y={276} className="tag house">
          HOUSE
        </text>
      </g>
    </svg>
  );
}
