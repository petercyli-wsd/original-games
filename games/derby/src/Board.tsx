import { fmtChance as kitChance } from '@originals/game-sdk/ui';
import { FIELD, GAITS, type LegOutcome } from './math';

/** Like the kit's, but never prints long strings of zeros. */
export const fmtChance = (p: number) => (p > 0 && p < 1e-4 ? '<0.01%' : kitChance(p));

export interface BoardProps {
  L: number;
  /** Displayed positions (runners that crossed may sit past the line). */
  pos: readonly number[];
  /** Live win chance of every runner (the tote). */
  chances: readonly number[];
  /** Chances before the latest tick while a leg runs (each % flashes up or down), else null. */
  prev?: readonly number[] | null;
  /** Your runner. */
  me: number;
  /** How the next leg could go for your runner, or null. */
  outcomes: LegOutcome[] | null;
  winners: readonly number[] | null;
  /** Runners that crossed in the final tick, with the instant (fraction of the tick). */
  crossed: readonly { runner: number; at: number }[];
  /** Duration of the current tick's movement. */
  moveMs: number;
  narrow: boolean;
  phase: 'idle' | 'live' | 'over';
  /** A leg is being run: the next-leg strip shows what it is deciding, dimmed. */
  running: boolean;
  /** Your chance when the leg starts (the average of the next-leg bars). */
  legNow: number;
  /** Lanes you can click (pick in idle, switch at a checkpoint). */
  pickable: (i: number) => boolean;
  onPick(i: number): void;
  /** Shown in the strip under the track when the round ended without a finish. */
  note?: string | null;
  /** Show the photo finish under the track when the race ends (manual play). */
  photo: boolean;
}

const LANE = 46;
const TOTE_Y = 26;
const TOTE_H = 26;
const LANES_Y = 66;
const RUNOUT = 4;

export default function Board(props: BoardProps) {
  const { L, pos, chances, prev, me, outcomes, winners, crossed, moveMs, narrow, phase, pickable, onPick, note, running, legNow, photo } = props;
  const W = narrow ? 420 : 640;
  const labelW = narrow ? 44 : 168;
  const rightW = narrow ? 58 : 82;
  const x0 = labelW + 22;
  const x1 = W - rightW - 10;
  const unit = (x1 - x0) / (L + RUNOUT);
  const xAt = (p: number) => x0 + Math.min(p, L + RUNOUT) * unit;
  const finishX = xAt(L);
  const lanesH = FIELD.length * LANE;
  const axisY = LANES_Y + lanesH + 4;
  const stripY = axisY + 26;
  const stripH = 104;
  const H = stripY + stripH + 6;
  const now = chances[me];

  // The tote: one bar split into every runner's live chance.
  let acc = 16;
  const toteW = W - 32;
  const tote = FIELD.map((r, i) => {
    const w = chances[i] * toteW;
    const seg = { i, x: acc, w, colour: r.colour };
    acc += w;
    return seg;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={'derby' + (narrow ? ' narrow' : '')} role="img" aria-label={`Race to ${L}. Your runner #${me + 1} has ${fmtChance(now)} to win.`}>
      {/* Tote */}
      <text x={16} y={16} className="cap">
        TOTE · live chance to win
      </text>
      <text x={W - 16} y={16} className="cap end">
        {phase === 'over' ? (winners ? 'result' : 'when you stopped') : 'sums to 100%'}
      </text>
      <rect x={16} y={TOTE_Y} width={toteW} height={TOTE_H} rx={6} className="tote-bg" />
      {tote.map((s) =>
        s.w > 0.2 ? (
          <g key={s.i} className={'tote-seg' + (s.i === me ? ' mine' : '')}>
            <rect x={s.x} y={TOTE_Y} width={s.w} height={TOTE_H} fill={s.colour} style={{ transition: `all ${Math.max(moveMs, 200)}ms ease` }} />
            {s.w > (narrow ? 44 : 54) && (
              <text x={s.x + s.w / 2} y={TOTE_Y + 17.5} className="tote-txt">
                #{s.i + 1} {Math.round(chances[s.i] * 100)}%
              </text>
            )}
          </g>
        ) : null,
      )}
      {tote[me].w > 0.2 && <rect x={tote[me].x} y={TOTE_Y - 2} width={tote[me].w} height={TOTE_H + 4} rx={3} className="tote-mine" />}

      {/* Lanes */}
      {FIELD.map((r, i) => {
        const y = LANES_Y + i * LANE;
        const cy = y + LANE / 2;
        const g = GAITS[r.gait];
        const mine = i === me;
        const won = winners?.includes(i);
        const canPick = pickable(i);
        return (
          <g
            key={i}
            className={'lane' + (mine ? ' mine' : '') + (canPick ? ' pick' : '') + (won ? ' won' : '')}
            onClick={canPick ? () => onPick(i) : undefined}
            role={canPick ? 'button' : undefined}
            aria-label={canPick ? `Back #${i + 1} ${g.name}` : undefined}
          >
            <rect x={6} y={y + 2} width={W - 12} height={LANE - 4} rx={9} className="lane-bg" />
            <circle cx={narrow ? 26 : 30} cy={cy} r={13} fill={r.colour} className="saddle" />
            <text x={narrow ? 26 : 30} y={cy + 5} className="saddle-no">
              {i + 1}
            </text>
            {!narrow && (
              <>
                <text x={52} y={cy - 3} className="name">
                  {g.name}
                </text>
                <text x={52} y={cy + 12} className="blurb">
                  {g.blurb}
                </text>
              </>
            )}
            {/* Track */}
            <line x1={x0} y1={cy} x2={x1} y2={cy} className="rail" />
            {/* Next-leg landing spots for your runner. */}
            {mine &&
              phase !== 'over' &&
              !running &&
              outcomes?.map((o) => (
                <rect
                  key={o.advance}
                  x={xAt(pos[i] + o.advance) - 2}
                  y={cy - 15}
                  width={4}
                  height={30}
                  rx={2}
                  className={'ghost ' + (o.chance > legNow + 1e-9 ? 'up' : o.chance < legNow - 1e-9 ? 'down' : '')}
                  style={{ opacity: 0.25 + 0.75 * Math.min(1, o.prob * 2.5) }}
                />
              ))}
            <g className="runner" style={{ transform: `translate(${xAt(pos[i])}px, ${cy}px)`, transition: `transform ${moveMs}ms linear` }}>
              {mine && <circle r={18} className="mine-ring" />}
              <circle r={12} fill={r.colour} className="token" />
              <text y={4.5} className="token-no">
                {i + 1}
              </text>
            </g>
            {/* Live chance, as a number and a bar. */}
            <text x={W - 14} y={cy + (narrow ? 2 : 0)} className={'pct' + (mine ? ' mine' : '') + moved(chances[i], prev?.[i])}>
              {phase === 'over' && winners ? (won ? (winners.length > 1 ? `÷${winners.length}` : 'WIN') : '—') : fmtChance(chances[i])}
            </text>
            <rect x={W - rightW + 2} y={cy + 8} width={rightW - 16} height={5} rx={2.5} className="pbar-bg" />
            <rect x={W - rightW + 2} y={cy + 8} width={Math.max(0, (rightW - 16) * chances[i])} height={5} rx={2.5} fill={r.colour} />
          </g>
        );
      })}

      {/* Finish line and distance marks */}
      <g className="finish">
        {Array.from({ length: Math.ceil(lanesH / 8) }, (_, k) => (
          <rect key={k} x={finishX - 4 + (k % 2) * 4} y={LANES_Y + k * 8} width={4} height={8} className="chk" />
        ))}
      </g>
      {Array.from({ length: Math.floor(L / 5) + 1 }, (_, k) => k * 5).map((d) => (
        <g key={d}>
          <line x1={xAt(d)} y1={LANES_Y + 2} x2={xAt(d)} y2={LANES_Y + lanesH - 2} className={'mark' + (d === 0 ? ' start' : '')} />
          {(!narrow || d % 10 === 0 || d === L) && (
            <text x={xAt(d)} y={axisY + 12} className="axis">
              {d === L ? `${L} · finish` : d}
            </text>
          )}
        </g>
      ))}

      {/* The next leg for your runner, or the photo finish. */}
      <g transform={`translate(0 ${stripY})`}>
        {phase === 'over' && winners && photo ? (
          <PhotoFinish W={W} crossed={crossed} winners={winners} me={me} />
        ) : note ? (
          <text x={W / 2} y={20} className="note">
            {note}
          </text>
        ) : outcomes ? (
          <NextLeg W={W} H={stripH} outcomes={outcomes} now={legNow} me={me} narrow={narrow} dim={running} />
        ) : null}
      </g>
    </svg>
  );
}

function NextLeg({ W, H, outcomes, now, me, narrow, dim }: { W: number; H: number; outcomes: LegOutcome[]; now: number; me: number; narrow: boolean; dim: boolean }) {
  const left = 16;
  const width = W - 32;
  const top = 38;
  const h = H - top - 16;
  // Heights are drawn against a scale that fits the largest outcome, so tiny chances stay visible.
  const scale = Math.min(1, niceCeil(Math.max(now * 1.25, ...outcomes.map((o) => o.chance * 1.12), 1e-6)));
  const yOf = (c: number) => top + h * (1 - c / scale);
  let acc = left;
  const r = FIELD[me];
  return (
    <g className={'next-leg' + (dim ? ' dim' : '')}>
      <text x={left} y={12} className="cap">
        {dim ? 'THIS LEG' : 'NEXT LEG'} · {narrow ? `#${me + 1}'s distance → chance after` : `how far #${me + 1} ${GAITS[r.gait].name} runs → its chance after`}
      </text>
      <text x={left} y={27} className="cap sub">
        {narrow ? `width = how likely · top = ${fmtChance(scale)}` : `bar width = how likely · height = chance after (top = ${fmtChance(scale)})`}
      </text>
      <text x={W - 16} y={27} className="now-txt">
        - - now {fmtChance(now)} = {narrow ? 'average' : 'their average'}
      </text>
      <rect x={left} y={top} width={width} height={h} rx={6} className="leg-bg" />
      {outcomes.map((o) => {
        const w = o.prob * width;
        const x = acc;
        acc += w;
        const cls = o.chance > now + 1e-9 ? 'up' : o.chance < now - 1e-9 ? 'down' : 'flat';
        const showText = w > 30;
        return (
          <g key={o.advance}>
            <rect x={x + 1} y={yOf(o.chance)} width={Math.max(1, w - 2)} height={top + h - yOf(o.chance)} className={'leg-bar ' + cls} />
            {showText && (
              <>
                <text x={x + w / 2} y={Math.max(top + 12, yOf(o.chance) - 4)} className={'leg-pct ' + cls}>
                  {fmtChance(o.chance)}
                </text>
                <text x={x + w / 2} y={top + h + 13} className="leg-adv">
                  {o.crosses ? `+${o.advance} ✓` : `+${o.advance}`}
                </text>
              </>
            )}
          </g>
        );
      })}
      <line x1={left} x2={left + width} y1={yOf(now)} y2={yOf(now)} className="now-line" />
    </g>
  );
}

/** ' up' / ' down' when a chance moved noticeably in the last tick. */
function moved(now: number, before: number | undefined): string {
  if (before === undefined) return '';
  const d = now - before;
  return Math.abs(d) < 0.002 ? '' : d > 0 ? ' up' : ' down';
}

/** Rounds a scale up to 1, 2 or 5 × a power of ten. */
function niceCeil(x: number): number {
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 2, 5, 10]) if (m * p >= x - 1e-15) return m * p;
  return 10 * p;
}

function PhotoFinish({ W, crossed, winners, me }: { W: number; crossed: readonly { runner: number; at: number }[]; winners: readonly number[]; me: number }) {
  const sorted = [...crossed].sort((a, b) => a.at - b.at);
  const left = 16;
  const width = W - 32;
  return (
    <g className="photo">
      <text x={left} y={12} className="cap">
        PHOTO FINISH · when each runner crossed in the last tick
      </text>
      <line x1={left} x2={left + width} y1={56} y2={56} className="rail" />
      {[0, 0.5, 1].map((f) => (
        <text key={f} x={left + f * width} y={76} className="axis">
          {f === 0 ? 'tick start' : f === 1 ? 'tick end' : '½'}
        </text>
      ))}
      {sorted.map((c, k) => (
        <g key={c.runner} transform={`translate(${left + c.at * width} 56)`}>
          <circle r={12} fill={FIELD[c.runner].colour} className={'token' + (c.runner === me ? ' me' : '')} />
          <text y={4.5} className="token-no">
            {c.runner + 1}
          </text>
          <text y={-18} className={'photo-lbl' + (winners.includes(c.runner) ? ' win' : '')}>
            {winners.includes(c.runner) ? (winners.length > 1 ? 'dead heat' : 'first') : `${k + 1}${k === 1 ? 'nd' : k === 2 ? 'rd' : 'th'}`}
          </text>
        </g>
      ))}
    </g>
  );
}
