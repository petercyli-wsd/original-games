import type { Drawing } from '../game';
import type { Colour } from '../math';

interface Props {
  balls: Colour[];
  /** Balls the round started with; anything after these is a twin. */
  initial: number;
  /** Most balls the urn will hold this round, so it is sized once and never reflows. */
  capacity: number;
  /** The ball out of the urn right now, if a draw is under way. */
  drawing: Drawing | null;
  /** The ball drawn last; it and its twin (the last ball) are ringed. */
  lastDrawn: number | null;
}

const NAME: Record<Colour, string> = { blue: 'Blue', red: 'Red' };

// The urn as a jar of circles stacked from the bottom. A draw lifts one ball
// out into the tray above, shows its twin beside it, then both go in: the ball
// back to its place and the twin on top, so the jar grows by one per draw.
export default function Urn({ balls, initial, capacity, drawing, lastDrawn }: Props) {
  const cols = Math.min(10, Math.max(5, Math.ceil(Math.sqrt(capacity * 1.6))));
  const rows = Math.ceil(capacity / cols);
  const blue = balls.filter((b) => b === 'blue').length;
  const out = drawing ? balls[drawing.index] : null;
  const back = !drawing && lastDrawn !== null ? balls[lastDrawn] : null;
  return (
    <div className="urn-col">
      <div className="tray" aria-live="polite">
        {out ? (
          <>
            <span className="tray-balls">
              <i className={`ball ${out} lifted`} />
              {drawing?.twin && <i className={`ball ${out} twin-new`} />}
            </span>
            <span className={`tray-text t-${out}`}>{drawing?.twin ? `${NAME[out]} + twin go in` : `${NAME[out]} drawn`}</span>
          </>
        ) : back ? (
          <span className={`tray-text t-${back}`}>{NAME[back]} went back with a twin</span>
        ) : (
          <span className="tray-text muted">Urn · {balls.length} balls</span>
        )}
      </div>
      <div
        className="urn"
        style={{ ['--cols' as string]: cols, aspectRatio: `${cols} / ${rows}` }}
        role="img"
        aria-label={`Urn: ${blue} blue, ${balls.length - blue} red`}
      >
        {balls.map((c, i) => {
          const cls = ['ball', c];
          if (drawing?.index === i) cls.push('gone');
          if (i >= initial) cls.push('twin');
          if (back && (i === lastDrawn || i === balls.length - 1)) cls.push('ringed');
          return (
            <span key={i} className="slot">
              <i className={cls.join(' ')} />
            </span>
          );
        })}
      </div>
    </div>
  );
}
