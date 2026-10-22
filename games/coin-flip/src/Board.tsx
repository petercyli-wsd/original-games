import type { CSSProperties } from 'react';
import type { Side } from './math';

/**
 * The two coin faces, drawn geometrically: Heads is a gold sunburst, Tails a
 * silver crescent. Drawn in a 100×100 box centred on (0, 0).
 */
export function Emblem({ side }: { side: Side }) {
  if (side === 0) {
    const rays = Array.from({ length: 12 }, (_, i) => i * 30);
    return (
      <g className="cf-emblem heads">
        <circle r={41} className="rim-line" />
        {rays.map((a) => (
          <path key={a} d="M0 -34 L5 -22 L-5 -22 Z" transform={`rotate(${a})`} className="ray" />
        ))}
        <circle r={17} className="core" />
        <circle r={9} className="core-in" />
      </g>
    );
  }
  return (
    <g className="cf-emblem tails">
      <circle r={41} className="rim-line" />
      <path d="M10 -26 A27 27 0 1 0 10 26 A34 34 0 0 1 10 -26 Z" className="moon" />
      <path d="M20 -12 l2.4 5 5 2.4 -5 2.4 -2.4 5 -2.4 -5 -5 -2.4 5 -2.4 Z" className="star" />
      <circle cx={26} cy={12} r={2.6} className="star" />
    </g>
  );
}

/** A small flat coin for buttons, the streak row and the history. */
export function CoinIcon({ side, className }: { side: Side; className?: string }) {
  return (
    <svg viewBox="-50 -50 100 100" className={`cf-icon ${side === 0 ? 'heads' : 'tails'}` + (className ? ` ${className}` : '')} aria-hidden="true">
      <circle r={48} className="disc" />
      <Emblem side={side} />
    </svg>
  );
}

const EDGE_LAYERS = [-3, -2, -1, 0, 1, 2, 3];

/** One 3D coin. `rot` is its cumulative X rotation in degrees (a multiple of 180: 0 mod 360 = heads up). */
function Coin({ rot, tossKey, tossing, ms, tone, delay }: { rot: number; tossKey: number; tossing: boolean; ms: number; tone: string; delay: number }) {
  const spin = { transform: `rotateX(${rot}deg)`, transitionDuration: `${ms}ms`, transitionDelay: `${delay}ms` } as CSSProperties;
  const toss = { animationDuration: `${ms}ms`, animationDelay: `${delay}ms` } as CSSProperties;
  return (
    <div className={'cf-coin ' + tone}>
      <div key={tossKey} className={'cf-toss' + (tossing ? ' up' : '')} style={toss}>
        <div className="cf-spin" style={spin}>
          {EDGE_LAYERS.map((z) => (
            <i key={z} className="cf-edge" style={{ transform: `translateZ(${z}px)` }} />
          ))}
          <div className="cf-face heads">
            <svg viewBox="-50 -50 100 100" aria-hidden="true">
              <Emblem side={0} />
            </svg>
          </div>
          <div className="cf-face tails">
            <svg viewBox="-50 -50 100 100" aria-hidden="true">
              <Emblem side={1} />
            </svg>
          </div>
        </div>
      </div>
      <div key={`s${tossKey}`} className={'cf-shadow' + (tossing ? ' up' : '')} style={toss} />
    </div>
  );
}

export interface CoinsProps {
  /** Cumulative rotation per coin. */
  rots: number[];
  /** Bumps per toss, restarting the toss arc. */
  tossKey: number;
  tossing: boolean;
  ms: number;
  /** After a landed flip: which coins show the called side, and whether the flip won. */
  result: { call: Side; coins: Side[]; win: boolean } | null;
  /** The round-over card is up: the coins rise to make room for it. */
  lifted?: boolean;
}

export default function Coins({ rots, tossKey, tossing, ms, result, lifted }: CoinsProps) {
  const n = rots.length;
  return (
    <div className={'cf-coins' + (lifted ? ' lifted' : '')} data-n={n}>
      {rots.map((r, i) => {
        let tone = '';
        if (result && !tossing) tone = result.coins[i] === result.call ? (result.win ? 'match win' : 'match') : result.win ? 'miss' : 'miss lose';
        return <Coin key={i} rot={r} tossKey={tossKey} tossing={tossing} ms={ms} tone={tone} delay={tossing ? i * Math.min(60, ms / 12) : 0} />;
      })}
    </div>
  );
}

/** Rotation that lands `side` face up from `rot`, after `turns` full turns forward. */
export function turnTo(rot: number, side: Side, turns: number): number {
  const up: Side = ((Math.round(rot / 180) % 2) + 2) % 2 === 0 ? 0 : 1;
  if (turns === 0) return up === side ? rot : rot + 180;
  const base = rot - (up === 1 ? 180 : 0);
  return base + 360 * turns + 180 * side;
}
