import { fmtMult } from '@originals/game-sdk/ui';
import { useEffect, useRef } from 'react';

export type RungState = 'passed' | 'current' | 'next' | 'future' | 'pop' | 'ghost' | 'missed';

export interface LadderProps {
  /** Rung i is the cash-out after i + 1 pumps. */
  rungs: number[];
  state: (i: number) => RungState;
  /** The rung to keep in view. */
  focus: number;
  /** Auto mode's cash-out rung (0-based), flagged on the ladder. */
  target?: number | null;
}

/** The multiplier ladder: one rung per pump, scrolled to keep the action in view. */
export default function Ladder({ rungs, state, focus, target = null }: LadderProps) {
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = track.current;
    const rung = el?.children[focus] as HTMLElement | undefined;
    if (!el || !rung) return;
    el.scrollTo({ left: rung.offsetLeft - el.clientWidth / 2 + rung.offsetWidth / 2, behavior: 'smooth' });
  }, [focus, rungs.length]);

  return (
    <div className="pump-ladder" ref={track} aria-label="Multiplier ladder">
      {rungs.map((m, i) => {
        const st = state(i);
        return (
          <div key={i} className={`rung ${st}` + (target === i ? ' target' : '')} title={`Pump ${i + 1}: ${fmtMult(m)}`}>
            <span className="n">{st === 'pop' || st === 'missed' ? 'POP' : `Pump ${i + 1}`}</span>
            <b>{fmtMult(m)}</b>
          </div>
        );
      })}
    </div>
  );
}
