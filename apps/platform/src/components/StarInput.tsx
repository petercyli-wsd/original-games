import { useState } from 'react';

const STARS = [1, 2, 3, 4, 5];

/** Five clickable stars showing `value`, with hover preview. */
export function StarInput({
  value,
  onRate,
  disabled = false,
  size = 'md',
  label = 'Your rating',
}: {
  value: number;
  onRate: (stars: number) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  label?: string;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className={`star-input star-input-${size}`} role="radiogroup" aria-label={label} onMouseLeave={() => setHover(0)}>
      {STARS.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          aria-label={`${s} star${s > 1 ? 's' : ''}`}
          className={s <= shown ? 'on' : ''}
          disabled={disabled}
          onMouseEnter={() => setHover(s)}
          onFocus={() => setHover(s)}
          onBlur={() => setHover(0)}
          onClick={() => onRate(s)}
        >
          ★
        </button>
      ))}
    </div>
  );
}
