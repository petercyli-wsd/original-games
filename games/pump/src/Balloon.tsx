import { fmtMult } from '@originals/game-sdk/ui';

// Geometry (viewBox 0 0 560 360): one flat circle in the accent that grows with
// each safe pump, inside a thin outline of its full size. A pop leaves a --lose
// ring where the circle was.
const CX = 280;
const CY = 180;
const R_MAX = 160;
const R_MIN = 44;

export type BalloonState = 'idle' | 'live' | 'strain' | 'popped' | 'cashed' | 'max';

export interface BalloonProps {
  /** Balloon size, 0 (small start) to 1 (every safe pump used). */
  fill: number;
  state: BalloonState;
  /** Cash-out multiplier shown inside the circle (null hides it). */
  label: number | null;
  /** How long the circle takes to grow for one pump. */
  pumpMs: number;
}

/** Radius of the circle for a fill level. */
export const radiusOf = (fill: number) => R_MIN + (R_MAX - R_MIN) * Math.pow(Math.min(1, Math.max(0, fill)), 0.75);

export default function Balloon({ fill, state, label, pumpMs }: BalloonProps) {
  const r = radiusOf(fill);
  return (
    <svg viewBox="0 0 560 360" className={`pump-svg ${state}`} role="img" aria-label={state === 'popped' ? 'The balloon popped' : `Balloon at ${Math.round(fill * 100)}% of full size`}>
      <circle cx={CX} cy={CY} r={R_MAX} className="max-outline" />
      {state === 'popped' ? (
        <circle cx={CX} cy={CY} r={r} className="pop-ring" />
      ) : (
        <>
          <circle cx={CX} cy={CY} r={r} className="body" style={{ transitionDuration: `${pumpMs}ms` }} />
          {label !== null && (
            <text x={CX} y={CY} dy="0.35em" className="mult">
              {fmtMult(label)}
            </text>
          )}
        </>
      )}
    </svg>
  );
}
