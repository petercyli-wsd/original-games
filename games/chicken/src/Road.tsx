// The road: a start kerb, 20 lanes and a finish kerb, scrolled so the token
// stays in view. Each lane carries a pad with the cash-out for reaching it.
// Geometric art only: a token built from circles and triangles, block cars,
// striped barriers on the lanes already crossed.

import { fmtMult } from '@originals/game-sdk/ui';
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { LANES, multiplier, type Difficulty, type Road as RoadT } from './math';

const CAR_COLOURS = ['#60a5fa', '#f472b6', '#a78bfa', '#34d399', '#fb923c', '#e2e8f0', '#22d3ee', '#f87171'];

export function Token() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="ck-token-art">
      <ellipse cx="24" cy="44" rx="12" ry="2.6" className="tk-shadow" />
      <line x1="20" y1="38" x2="19" y2="43.5" className="tk-leg" />
      <line x1="28" y1="38" x2="29" y2="43.5" className="tk-leg" />
      <circle cx="21.5" cy="12.5" r="3.1" className="tk-comb" />
      <circle cx="25.5" cy="10.8" r="3.5" className="tk-comb" />
      <circle cx="29.5" cy="12.8" r="2.9" className="tk-comb" />
      <ellipse cx="24" cy="27" rx="14" ry="13" className="tk-body" />
      <ellipse cx="19" cy="29.5" rx="7.5" ry="5" transform="rotate(-14 19 29.5)" className="tk-wing" />
      <polygon points="37,23.5 43.5,26.2 37,29" className="tk-beak" />
      <circle cx="31" cy="22" r="2.3" className="tk-eye" />
      <circle cx="31.7" cy="21.3" r="0.7" className="tk-glint" />
    </svg>
  );
}

function Car({ colour }: { colour: string }) {
  return (
    <svg viewBox="0 0 46 74" aria-hidden="true" className="ck-car-art" style={{ '--car': colour } as CSSProperties}>
      <rect x="3" y="2" width="40" height="70" rx="10" className="cr-body" />
      <rect x="8" y="10" width="30" height="13" rx="4" className="cr-glass" />
      <rect x="8" y="46" width="30" height="16" rx="4" className="cr-glass front" />
      <rect x="10" y="27" width="26" height="15" rx="3" className="cr-roof" />
      <rect x="7" y="65" width="9" height="4" rx="2" className="cr-light" />
      <rect x="30" y="65" width="9" height="4" rx="2" className="cr-light" />
    </svg>
  );
}

function Flag() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="ck-flag">
      <line x1="5" y1="2" x2="5" y2="18" />
      <polygon points="5,3 16,6.5 5,10" />
    </svg>
  );
}

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
          const ambient = !crossed && !isHit && lane !== moving && !revealed;
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
          const colour = CAR_COLOURS[(lane * 5) % CAR_COLOURS.length];
          return (
            <div
              key={lane}
              className={cls}
              data-lane={lane}
              style={
                {
                  '--dur': `${2.3 + ((lane * 37) % 17) / 10}s`,
                  '--delay': `${-((lane * 53) % 31) / 10}s`,
                } as CSSProperties
              }
            >
              {ambient && (
                <div className="ck-car ambient">
                  <Car colour={colour} />
                </div>
              )}
              {isHit && (
                <div className="ck-car slam">
                  <Car colour="#f87171" />
                </div>
              )}
              {revealed && traffic && (
                <div className="ck-car parked">
                  <Car colour={colour} />
                </div>
              )}
              {crossed && <div className="ck-barrier" />}
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
          <Flag />
          <span className="ck-kerb-label">Finish</span>
          <b>{fmtMult(multiplier(d, LANES))}</b>
        </div>

        <div
          className={'ck-token' + (snap ? ' snap' : '') + (hit !== null ? ' squash' : '') + (won ? ' won' : '')}
          style={{ left: tokenLeft(tokenLane) }}
        >
          <div key={tokenLane} className={'ck-hop' + (tokenLane > 0 && !snap ? ' go' : '')}>
            <Token />
          </div>
          {hit !== null && <i className="ck-impact" />}
        </div>
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
