// Flat item art: a prize tile is just its multiplier as text on a neutral fill.

/** The case itself: a flat box with a lid and a lock; dots show the difficulty. */
export function CaseIcon({ level, open }: { level: number; open?: boolean }) {
  return (
    <svg viewBox="0 0 72 60" className={'cs-case-icon' + (open ? ' open' : '')} aria-hidden="true">
      <rect x="6" y="20" width="60" height="32" rx="6" className="body" />
      <rect x="3" y="10" width="66" height="14" rx="5" className="lid" />
      <rect x="29" y="18" width="14" height="15" rx="3" className="lock" />
      {[0, 1, 2, 3].map((i) => (
        <circle key={i} cx={27 + i * 6} cy="57" r="2" className={i <= level ? 'dot on' : 'dot'} />
      ))}
    </svg>
  );
}

export const multLabel = (m: number) => (m >= 1000 ? m.toLocaleString('en-US') : m >= 100 ? String(m) : m.toFixed(m >= 10 ? 0 : 2)) + '×';

export function ItemCard({ mult, className }: { mult: number; className?: string }) {
  return (
    <div className={'cs-item' + (mult >= 1 ? ' up' : '') + (className ? ` ${className}` : '')}>
      <b>{multLabel(mult)}</b>
    </div>
  );
}

/** The unopened slot under the marker before the first bet: no prize is implied. */
export function MysteryCard() {
  return (
    <div className="cs-item mystery" aria-label="Unopened">
      <b>?</b>
    </div>
  );
}
