import { useEffect, useRef, type CSSProperties } from 'react';
import type { Side } from './math';

const LETTER = ['H', 'T'] as const;

const sideOf = (rot: number): Side => (((Math.round(rot / 180) % 2) + 2) % 2 === 0 ? 0 : 1);

/** A small flat disc with H or T, for the call buttons. */
export function CoinIcon({ side, className }: { side: Side | 'random'; className?: string }) {
  return (
    <svg viewBox="-50 -50 100 100" className={'cf-icon' + (className ? ` ${className}` : '')} aria-hidden="true">
      <circle r={46} className="disc" />
      <text className="ltr" textAnchor="middle" dominantBaseline="central" y={3}>
        {side === 'random' ? '?' : LETTER[side]}
      </text>
    </svg>
  );
}

/**
 * One flat coin. `rot` is its cumulative rotation in degrees (a multiple of 180: 0 mod 360 = heads up); only
 * its parity matters now. A toss squashes the disc to a line and back (scaleX) while the letter swaps at each
 * edge-on moment: two turns end on the side it started on, three on the other.
 */
function Coin({ rot, tossKey, tossing, ms, tone, delay }: { rot: number; tossKey: number; tossing: boolean; ms: number; tone: string; delay: number }) {
  const final = sideOf(rot);
  const settled = useRef<Side>(final);
  useEffect(() => {
    if (!tossing) settled.current = final;
  });
  const start = settled.current;
  const style = { animationDuration: `${ms}ms`, animationDelay: `${delay}ms` } as CSSProperties;
  return (
    <div className={'cf-coin ' + tone}>
      <div key={tossKey} className={'cf-disc' + (tossing ? (start === final ? ' flip2' : ' flip3') : '')} style={style}>
        {tossing ? (
          <>
            <span className="cf-ltr first" style={style}>{LETTER[start]}</span>
            <span className="cf-ltr second" style={style}>{LETTER[start === 0 ? 1 : 0]}</span>
          </>
        ) : (
          <span className="cf-ltr">{LETTER[final]}</span>
        )}
      </div>
    </div>
  );
}

export interface CoinsProps {
  /** Cumulative rotation per coin. */
  rots: number[];
  /** Bumps per toss, restarting the animation. */
  tossKey: number;
  tossing: boolean;
  ms: number;
  /** After a landed flip: which coins show the called side, and whether the flip won. */
  result: { call: Side; coins: Side[]; win: boolean } | null;
  /** The player has called a side (not Random): the coins are marked with the accent until the flip lands. */
  called?: boolean;
}

export default function Coins({ rots, tossKey, tossing, ms, result, called }: CoinsProps) {
  const n = rots.length;
  return (
    <div className="cf-coins" data-n={n}>
      {rots.map((r, i) => {
        let tone = '';
        if (result && !tossing) tone = result.coins[i] === result.call ? (result.win ? 'match win' : 'match') : result.win ? 'miss' : 'miss lose';
        else if (called) tone = 'called';
        return <Coin key={i} rot={r} tossKey={tossKey} tossing={tossing} ms={ms} tone={tone} delay={tossing ? i * Math.min(60, ms / 12) : 0} />;
      })}
    </div>
  );
}

/** Rotation that lands `side` face up from `rot`, after `turns` full turns forward. */
export function turnTo(rot: number, side: Side, turns: number): number {
  const up: Side = sideOf(rot);
  if (turns === 0) return up === side ? rot : rot + 180;
  const base = rot - (up === 1 ? 180 : 0);
  return base + 360 * turns + 180 * side;
}
