import type { Colour } from '../math';

interface Props {
  balls: Colour[];
  /** Balls the round started with; anything after these is a twin and pops in. */
  initial: number;
  /** Most balls the urn will hold this round, so it is sized once and never reflows. */
  capacity: number;
  picked: number | null;
}

// The urn as a jar of circles stacked from the bottom. Twins are appended, so
// they land on top, and the jar fills as the round goes on.
export default function Urn({ balls, initial, capacity, picked }: Props) {
  const cols = Math.min(10, Math.max(4, Math.ceil(Math.sqrt(capacity * 1.5))));
  const rows = Math.ceil(capacity / cols);
  const blue = balls.filter((b) => b === 'blue').length;
  return (
    <div
      className="urn"
      style={{ ['--cols' as string]: cols, aspectRatio: `${cols} / ${rows}` }}
      role="img"
      aria-label={`Urn: ${blue} blue, ${balls.length - blue} red`}
    >
      {balls.map((c, i) => (
        <span key={i} className="slot">
          <i className={`ball ${c}${i === picked ? ' picked' : ''}${i >= initial ? ' twin' : ''}`} />
        </span>
      ))}
    </div>
  );
}
