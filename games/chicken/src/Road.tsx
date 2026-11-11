// The road: a start kerb, 20 lanes and a finish kerb, scrolled so the token
// stays in view. Each lane carries a pad with the cash-out for reaching it.
// Flat and geometric (docs/STYLE.md): the token is an accent dot, traffic is a
// red block that drops into its lane, and nothing moves between events.

import { fmtMult } from '@originals/game-sdk/ui';
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { LANES, multiplier, type Difficulty, type Road as RoadT } from './math';

export interface RoadView {
  difficulty: Difficulty;
  /** The real road (null for an idle preview). */
  road: RoadT | null;
  /** Lanes crossed safely. */
  pos: number;
  /** The lane being entered right now. */
  moving: number | null;
  /** The lane (1-based) whose traffic hit the token. */
  hit: number | null;
  /** Reveal the traffic in every lane (the round is over). */
  showAll: boolean;
  /** The round ended with a payout (gold highlights). */
  won: boolean;
  /** Waiting for the player to cross the next lane. */
  live: boolean;
}

export function RoadBoard({
  view,
  target,
  onLane,
  clickable,
  hopMs,
  slamMs,
}: {
  view: RoadView;
  /** Auto: the target lane. */
  target: number | null;
  onLane(lane: number): void;
  clickable: boolean;
  hopMs: number;
  slamMs: number;
}) {
  const { difficulty: d, road, pos, moving, hit, showAll, won, live } = view;
  const reached = hit ?? pos;
  const finished = pos >= LANES && hit === null;
  // On the far kerb once the last lane is crossed.
  const tokenLane = hit ?? moving ?? (finished && !live ? LANES + 1 : pos);

  // Snap (no slide) when the token jumps back to the start for a new round.
  const prevLane = useRef(tokenLane);
  const snap = tokenLane < prevLane.current;
  useEffect(() => {
    prevLane.current = tokenLane;
  }, [tokenLane]);

  // Keep the token (or, in Auto, the target lane) in view.
  const scroller = useRef<HTMLDivElement>(null);
  const focusLane = target !== null && !road ? target : tokenLane;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const node = el.querySelector<HTMLElement>(`[data-lane="${focusLane}"]`);
    if (!node) return;
    const centre = node.offsetLeft + node.offsetWidth / 2;
    const left = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, centre - el.clientWidth * 0.38));
    if (Math.abs(el.scrollLeft - left) < 2) return;
    el.scrollTo({ left, behavior: snap || hopMs < 120 ? 'auto' : 'smooth' });
  }, [focusLane, snap, hopMs]);

  const lanes = Array.from({ length: LANES }, (_, i) => i + 1);

  return (
    <div className={'ck-road' + (won ? ' won' : '') + (hit !== null ? ' busted' : '')} ref={scroller} style={{ '--hop': `${hopMs}ms`, '--slam': `${slamMs}ms` } as CSSProperties}>
      <div className="ck-strip">
        <div className="ck-kerb start" data-lane={0}>
          <span className="ck-kerb-label">Start</span>
        </div>

        {lanes.map((lane) => {
          const crossed = lane <= pos && lane !== hit;
          const isHit = lane === hit;
          const isNext = live && lane === pos + 1 && moving === null;
          const revealed = showAll && road !== null && lane > reached;
          const traffic = road ? road[lane - 1] : false;
          const isSel = target !== null && lane <= target;
          const isTarget = target !== null && lane === target;
          const cls = [
            'ck-lane',
            crossed && 'crossed',
            isHit && 'hit',
            isNext && 'next',
            lane === moving && 'entering',
            revealed && (traffic ? 'rv-hit' : 'rv-safe'),
            isSel && 'sel',
            isTarget && 'target',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={lane} className={cls} data-lane={lane}>
              {isHit && <i className="ck-block slam" />}
              {revealed && traffic && <i className="ck-block parked" />}
              <button
                type="button"
                className="ck-pad"
                disabled={!clickable || !(target !== null || isNext)}
                aria-label={`Lane ${lane}, pays ${fmtMult(multiplier(d, lane))}`}
                onClick={() => onLane(lane)}
              >
                <b>{fmtMult(multiplier(d, lane))}</b>
                {isTarget && <i className="ck-pad-tag">target</i>}
              </button>
              <span className="ck-lane-no">{lane}</span>
            </div>
          );
        })}

        <div className={'ck-kerb finish' + (finished && won ? ' reached' : '') + (target === LANES ? ' targeted' : '')} data-lane={LANES + 1}>
          <span className="ck-kerb-label">Finish</span>
          <b>{fmtMult(multiplier(d, LANES))}</b>
        </div>

        <i
          className={'ck-token' + (snap ? ' snap' : '') + (hit !== null ? ' hit' : '') + (won ? ' won' : '')}
          style={{ left: tokenLeft(tokenLane) }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

/** Centre of the start kerb (0), a lane (1–20) or the finish kerb (21). */
function tokenLeft(p: number): string {
  if (p <= 0) return 'calc(var(--kw) / 2)';
  if (p > LANES) return `calc(var(--kw) * 1.5 + ${LANES} * var(--lw))`;
  return `calc(var(--kw) + ${p - 0.5} * var(--lw))`;
}

/** The progress strip under the road: one pip per lane. */
export function Progress({ pos, hit, target, road, showAll }: { pos: number; hit: number | null; target: number | null; road: RoadT | null; showAll: boolean }) {
  const reached = hit ?? pos;
  return (
    <div className="ck-progress" aria-hidden="true">
      {Array.from({ length: LANES }, (_, i) => {
        const lane = i + 1;
        const cls = [
          lane <= pos && lane !== hit && 'ok',
          lane === hit && 'bad',
          showAll && road && lane > reached && (road[i] ? 'rv-hit' : 'rv-safe'),
          target !== null && lane <= target && 'sel',
          target === lane && 'target',
        ]
          .filter(Boolean)
          .join(' ');
        return <i key={lane} className={cls} />;
      })}
    </div>
  );
}
