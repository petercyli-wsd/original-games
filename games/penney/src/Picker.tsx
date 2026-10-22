import { MAX_LEN, MIN_LEN } from './math';

/** A row of coins: click a coin to turn it over, − / + to change the length. */
export default function Picker({
  value,
  onChange,
  side,
  disabled,
  label,
}: {
  value: string;
  onChange(value: string): void;
  side: 'you' | 'house';
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className={`pn-picker ${side}`} role="group" aria-label={label}>
      <div className="pn-picks">
        {[...value].map((c, i) => (
          <button
            key={i}
            type="button"
            className={`pn-pick ${c}`}
            disabled={disabled}
            title="Click to turn this coin over"
            aria-label={`${label}, coin ${i + 1}: ${c === 'H' ? 'heads' : 'tails'}`}
            onClick={() => onChange(value.slice(0, i) + (c === 'H' ? 'T' : 'H') + value.slice(i + 1))}
          >
            {c}
          </button>
        ))}
        {Array.from({ length: MAX_LEN - value.length }, (_, i) => (
          <span key={`e${i}`} className="pn-pick empty" aria-hidden="true" />
        ))}
      </div>
      <button type="button" className="pn-len" disabled={disabled || value.length <= MIN_LEN} aria-label={`${label}: one coin fewer`} onClick={() => onChange(value.slice(0, -1))}>
        −
      </button>
      <button type="button" className="pn-len" disabled={disabled || value.length >= MAX_LEN} aria-label={`${label}: one coin more`} onClick={() => onChange(value + 'H')}>
        +
      </button>
    </div>
  );
}
