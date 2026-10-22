// Geometric item art: one shape per rarity tier, coloured by the tier. No
// ids or gradients, so hundreds of copies on the reels stay cheap.

import type { Tier } from './math';
import { tierOf } from './math';

const star = (n: number, r1: number, r2: number, rot = -Math.PI / 2) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 ? r2 : r1;
    const a = rot + (i * Math.PI) / n;
    return `${(30 + r * Math.cos(a)).toFixed(2)},${(30 + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

const poly = (n: number, r: number, rot = -Math.PI / 2) =>
  Array.from({ length: n }, (_, i) => {
    const a = rot + (i * 2 * Math.PI) / n;
    return `${(30 + r * Math.cos(a)).toFixed(2)},${(30 + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

function Shape({ tier }: { tier: Tier }) {
  switch (tier) {
    case 'dud':
      return <circle cx="30" cy="30" r="15" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="5 4" />;
    case 'common':
      return (
        <>
          <circle cx="30" cy="30" r="15" fill="currentColor" />
          <circle cx="25" cy="25" r="5.5" fill="#fff" opacity="0.28" />
        </>
      );
    case 'uncommon':
      return (
        <>
          <polygon points="30,11 49,44 11,44" fill="currentColor" strokeLinejoin="round" stroke="currentColor" strokeWidth="3" />
          <polygon points="30,11 30,44 11,44" fill="#fff" opacity="0.2" />
        </>
      );
    case 'rare':
      return (
        <>
          <polygon points="30,9 49,30 30,51 11,30" fill="currentColor" />
          <polygon points="30,9 49,30 30,30" fill="#fff" opacity="0.3" />
          <polygon points="30,30 30,51 11,30" fill="#000" opacity="0.18" />
        </>
      );
    case 'epic':
      return (
        <>
          <polygon points={poly(6, 20)} fill="currentColor" />
          <polygon points={poly(6, 11)} fill="#fff" opacity="0.26" />
        </>
      );
    case 'mythic':
      return (
        <>
          <polygon points={star(5, 21, 9.5)} fill="currentColor" strokeLinejoin="round" stroke="currentColor" strokeWidth="2" />
          <polygon points={star(5, 10, 4.5)} fill="#fff" opacity="0.3" />
        </>
      );
    case 'legend':
      return (
        <>
          <circle cx="30" cy="30" r="24" fill="currentColor" opacity="0.16" />
          <polygon points={star(8, 23, 11)} fill="currentColor" />
          <polygon points={poly(8, 9, -Math.PI / 2 + Math.PI / 8)} fill="#fff" opacity="0.4" />
        </>
      );
  }
}

export function Gem({ mult, className }: { mult: number; className?: string }) {
  const tier = tierOf(mult);
  return (
    <svg viewBox="0 0 60 60" className={'cs-gem t-' + tier + (className ? ' ' + className : '')} aria-hidden="true">
      <Shape tier={tier} />
    </svg>
  );
}

const CASE_COLOURS = ['#4f9cf9', '#a78bfa', '#f472b6', '#fbbf24'];

/** The case itself: a geometric box with a lid, straps and a lock; pips show the difficulty. */
export function CaseIcon({ level, shaking }: { level: number; shaking?: boolean }) {
  const c = CASE_COLOURS[level] ?? CASE_COLOURS[0];
  return (
    <svg viewBox="0 0 72 60" className={'cs-case-icon' + (shaking ? ' shaking' : '')} style={{ color: c }} aria-hidden="true">
      <rect x="6" y="20" width="60" height="32" rx="6" fill="currentColor" opacity="0.28" stroke="currentColor" strokeWidth="2" />
      <g className="lid">
        <rect x="3" y="10" width="66" height="14" rx="5" fill="currentColor" />
        <rect x="3" y="10" width="66" height="5" rx="2.5" fill="#fff" opacity="0.25" />
      </g>
      <rect x="17" y="10" width="5" height="42" fill="currentColor" opacity="0.55" />
      <rect x="50" y="10" width="5" height="42" fill="currentColor" opacity="0.55" />
      <rect x="29" y="18" width="14" height="15" rx="3" fill="#0b0d12" stroke="currentColor" strokeWidth="2" />
      <circle cx="36" cy="25.5" r="2.6" fill="currentColor" />
      {[0, 1, 2, 3].map((i) => (
        <circle key={i} cx={27 + i * 6} cy="57" r="2" fill="currentColor" opacity={i <= level ? 1 : 0.2} />
      ))}
    </svg>
  );
}

export const multLabel = (m: number) => (m >= 1000 ? m.toLocaleString('en-US') : m >= 100 ? String(m) : m.toFixed(m >= 10 ? 0 : 2)) + '×';

export function ItemCard({ mult, className }: { mult: number; className?: string }) {
  const tier = tierOf(mult);
  return (
    <div className={`cs-item t-${tier}` + (className ? ` ${className}` : '')}>
      <Gem mult={mult} />
      <b>{multLabel(mult)}</b>
    </div>
  );
}
