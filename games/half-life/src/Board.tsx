import { fmtChance, fmtMult } from '@originals/game-sdk/ui';
import type { CSSProperties } from 'react';
import {
  AXIS_Y,
  COMPACT,
  NEXT_H,
  NEXT_Y,
  ROWS_TOP,
  VIEW_H,
  WIDE,
  axisMax,
  axisTicks,
  barLength,
  halvingMarks,
  nextSegments,
  nucleusRadius,
  rowHeight,
  rowY,
  tailHalfWidth,
  tailPath,
  timeX,
} from './layout';
import { has, halfLife, halfLifeLabel, lastChances, nextChance } from './math';

export type Phase = 'idle' | 'running' | 'checkpoint' | 'over';
export type Outcome = 'decayed' | 'last' | 'cashed';

export interface DecayMark {
  atom: number;
  /** Lab minute it decayed at. */
  t: number;
}

export interface BoardProps {
  k: number;
  /** Survivors (bitmask over atoms 1..k). */
  mask: number;
  backed: number;
  decays: DecayMark[];
  /** The lab clock, in minutes. */
  now: number;
  phase: Phase;
  outcome: Outcome | null;
  /** The value you could switch with (the cash-out, or RTP before a bet). */
  value: number;
  prize: number;
  burstMs: number;
  /** Narrow frames use shorter lanes so the text keeps its size. */
  compact?: boolean;
  /** Clicking an atom picks it (idle/over) or switches to it (checkpoint). */
  onPick?: (atom: number) => void;
}

const SPOKES = [0, 45, 90, 135, 180, 225, 270, 315];

export default function Board({ k, mask, backed, decays, now, phase, outcome, value, prize, burstMs, compact, onPick }: BoardProps) {
  const L = compact ? COMPACT : WIDE;
  const max = axisMax(now);
  const rowH = rowHeight(k);
  const h0 = Math.min(rowH * 0.3, 14);
  const probs = lastChances(mask);
  const running = phase === 'running';
  const over = phase === 'over';
  const won = over && outcome === 'last';
  const lost = over && outcome === 'decayed';
  const pickable = !!onPick && (phase === 'idle' || phase === 'over' || phase === 'checkpoint');
  const nowX = timeX(L, now, max);
  const yourNext = nextChance(mask, backed);
  const ticks = axisTicks(max);

  return (
    <svg
      viewBox={`0 0 ${L.viewW} ${VIEW_H}`}
      className={'hl' + (running ? ' running' : '')}
      role="img"
      aria-label={`${k} atoms. Your ${halfLifeLabel(backed)}-minute atom decays last with chance ${fmtChance(probs[backed])}.`}
      style={{ '--burst': `${burstMs}ms` } as CSSProperties}
    >
      {/* Column heads */}
      <text x={L.atomX} y={20} className="head mid">
        T½ min
      </text>
      <text x={L.textX} y={20} className="head end">
        chance to be last
      </text>

      {/* The lab clock: a cursor sweeping along every lane. */}
      <line x1={nowX} y1={ROWS_TOP - 8} x2={nowX} y2={AXIS_Y} className="now-line" />
      <text x={Math.max(L.laneX0 + 14, Math.min(nowX, L.laneX1 - 70))} y={20} className="clock">
        <tspan className="clock-k">clock </tspan>
        {now.toFixed(1)} min
      </text>

      {Array.from({ length: k }, (_, idx) => {
        const atom = idx + 1;
        const cy = rowY(k, atom);
        const alive = has(mask, atom);
        const mine = atom === backed;
        const decay = decays.find((d) => d.atom === atom);
        const endX = decay ? timeX(L, decay.t, max) : nowX;
        const r = nucleusRadius(k, atom);
        const p = probs[atom] ?? 0;
        const spin = {
          '--spin': `${(halfLife(atom) * 0.1).toFixed(2)}s`,
        } as CSSProperties;
        const cls =
          'row' +
          (mine ? ' mine' : '') +
          (alive ? ' alive' : ' dead') +
          (mine && won ? ' won' : '') +
          (mine && lost ? ' lost' : '') +
          (pickable && alive && !mine ? ' can-pick' : '');
        const switchValue = alive && p > 0 ? value / p : 0;

        return (
          <g key={atom} className={cls} transform={`translate(0 ${cy.toFixed(2)})`}>
            {mine && <rect x={4} y={-rowH / 2 + 2} width={L.viewW - 8} height={rowH - 4} rx={10} className="mine-band" />}

            {/* Lane: lifeline from t = 0 to now (or to the decay), then the survival tail. */}
            <line x1={L.laneX0} y1={0} x2={L.laneX1} y2={0} className="lane" />
            <line x1={L.laneX0} y1={0} x2={endX} y2={0} className="life" />
            {alive && !over && <path d={tailPath(L, atom, now, max, h0)} className="tail" />}
            {alive &&
              !over &&
              halvingMarks(L, atom, now, max).map((n) => {
                const x = timeX(L, now + n * halfLife(atom), max);
                const w = tailHalfWidth(atom, n * halfLife(atom), h0);
                return <line key={n} x1={x} y1={-w} x2={x} y2={w} className="half-mark" />;
              })}
            {alive ? (
              <circle cx={endX} cy={0} r={3.5} className="head-dot" />
            ) : (
              <g className="burst" transform={`translate(${endX.toFixed(2)} 0)`}>
                <circle r={Math.min(10, rowH * 0.24)} className="shock" />
                {SPOKES.map((a) => (
                  <line key={a} x1={0} y1={-4.5} x2={0} y2={-8.5} transform={`rotate(${a})`} className="spoke" />
                ))}
                <circle r={2.6} className="core" />
              </g>
            )}

            {/* Nucleus: bigger = heavier = slower. The dashed orbit spins at its decay rate while the clock runs. */}
            <g transform={`translate(${L.atomX} 0)`}>
              {alive && <circle r={r + 4} className="orbit" style={spin} />}
              <circle r={r} className="nucleus" />
              {!alive && <circle r={r} className="flash" />}
              <text y={0} className="hl-label" style={{ fontSize: Math.max(10, Math.min(13, r * 0.78)) }}>
                {halfLifeLabel(atom)}
              </text>
            </g>

            {/* Chance to be last: a literal bar (full track = 100%). */}
            <rect x={L.barX0} y={-4} width={L.barW} height={8} rx={4} className="bar-track" />
            {alive && (
              <rect
                x={L.barX0}
                y={-4}
                width={L.barW}
                height={8}
                rx={4}
                className="bar"
                style={{ transform: `scaleX(${barLength(L, p) / L.barW})` }}
              />
            )}
            <text x={L.textX} y={-3} className="pct">
              {alive ? (mine && won ? 'last!' : fmtChance(p)) : 'decayed'}
            </text>
            <text x={L.textX} y={11} className="sub">
              {!alive
                ? `at ${decay ? decay.t.toFixed(1) : '?'} min`
                : mine
                  ? `prize ${fmtMult(prize)}`
                  : over
                    ? 'still here'
                    : phase === 'checkpoint'
                      ? `switch ${fmtMult(switchValue)}`
                      : `pays ${fmtMult(switchValue)}`}
            </text>

            {pickable && (alive || phase !== 'checkpoint') && (
              <rect
                x={0}
                y={-rowH / 2}
                width={L.viewW}
                height={rowH}
                className={`pick pick-${atom}`}
                role="button"
                aria-label={`${phase === 'checkpoint' ? 'Switch to' : 'Back'} the ${halfLifeLabel(atom)}-minute atom`}
                onClick={() => onPick?.(atom)}
              />
            )}
          </g>
        );
      })}

      {/* Time axis */}
      <line x1={L.laneX0} y1={AXIS_Y} x2={L.laneX1} y2={AXIS_Y} className="axis" />
      {ticks.map((t) => (
        <g key={t} transform={`translate(${timeX(L, t, max).toFixed(2)} ${AXIS_Y})`}>
          <line y1={0} y2={4} className="axis" />
          <text y={15} className="tick">
            {t === ticks[ticks.length - 1] ? `${t} min` : t}
          </text>
        </g>
      ))}

      {/* Next decay: each survivor's share of the total decay rate (hidden once the round is over). */}
      {!over && (
        <>
          <text x={L.laneX0} y={NEXT_Y - 7} className="next-title">
            Next to decay
          </text>
          <text x={L.textX} y={NEXT_Y - 7} className="next-yours end">
            yours <tspan className="red">{fmtChance(yourNext)}</tspan>
          </text>
          {nextSegments(L, mask).map((s) => (
            <g key={s.atom}>
              <rect x={s.x} y={NEXT_Y} width={Math.max(0.5, s.w)} height={NEXT_H} rx={4} className={'seg' + (s.atom === backed ? ' mine' : '')} />
              {s.w >= 24 && (
                <text x={s.x + s.w / 2} y={NEXT_Y + NEXT_H / 2 + 0.5} className={'seg-label' + (s.atom === backed ? ' mine' : '')}>
                  {halfLifeLabel(s.atom)}
                </text>
              )}
            </g>
          ))}
          <text x={L.laneX0} y={NEXT_Y + NEXT_H + 14} className="next-note">
            one slice per atom, sized by its decay rate (1 / half-life)
          </text>
        </>
      )}
    </svg>
  );
}
