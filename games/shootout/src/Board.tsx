import { fmtChance } from '@originals/game-sdk/ui';
import type { CSSProperties } from 'react';
import { KICKS, TEAM_NAME, keeperZone, type Forecast, type Kicks, type Odds, type Pick, type Team } from './math';

/** A kick in flight (or just landed): where the shot goes and whether it scores. */
export interface Shot {
  id: number;
  team: Team;
  u: number;
  goal: boolean;
  /** Flight time in ms. */
  ms: number;
  /** True once the ball has landed. */
  landed: boolean;
}

export interface BoardProps {
  s: Kicks;
  /** Scoring chance of each side, for the keeper and the labels. */
  pA: number;
  pB: number;
  pick: Pick;
  odds: Odds;
  /** The next kick and what it would do to your odds (null when the round is over). */
  next: Forecast | null;
  shot: Shot | null;
  /** Show the "what each kick does" labels as your odds (live) or as a preview (idle). */
  live: boolean;
  /** Which side's keeper is in goal now. */
  goalFor: Team;
}

const GX = 170;
const GW = 300;
const GY = 140;
const GH = 122;
const SPOT = { x: 320, y: 314 };
const BAR = { x: 20, y: 384, w: 600, h: 26 };

const pct = (p: number) => fmtChance(p);

/** Where a shot at u lands inside the mouth (the height is cosmetic, derived from u). */
export function shotPoint(u: number) {
  const x = GX + 10 + u * (GW - 20);
  const h = (u * 7919.37) % 1;
  return { x, y: GY + 26 + h * (GH - 52) };
}

function Pip({ x, y, state, team, next }: { x: number; y: number; state: boolean | null; team: Team; next: boolean }) {
  return (
    <g className={`pip ${team.toLowerCase()} ${state === null ? 'empty' : state ? 'goal' : 'miss'}`}>
      {next && <circle cx={x} cy={y} r={20} className="next-ring" />}
      <circle cx={x} cy={y} r={14} />
      {state === false && <path d={`M ${x - 6} ${y - 6} L ${x + 6} ${y + 6} M ${x + 6} ${y - 6} L ${x - 6} ${y + 6}`} className="x" />}
      {state === true && <circle cx={x} cy={y} r={4.5} className="dot" />}
    </g>
  );
}

function Row({
  team,
  y,
  kicks,
  sdShown,
  sdStart,
  next,
}: {
  team: Team;
  y: number;
  kicks: readonly boolean[];
  sdShown: boolean;
  sdStart: number;
  next: number | null;
}) {
  const goals = kicks.filter(Boolean).length;
  return (
    <g className={`row ${team.toLowerCase()}`}>
      <rect x={8} y={y - 22} width={624} height={44} rx={10} className="row-bg" />
      <circle cx={28} cy={y} r={8} className="swatch" />
      <text x={44} y={y + 6} className="name">
        {TEAM_NAME[team]}
      </text>
      <text x={146} y={y + 9} className="score">
        {goals}
      </text>
      {Array.from({ length: KICKS }, (_, i) => (
        <Pip key={i} x={190 + i * 44} y={y} state={i < kicks.length ? kicks[i] : null} team={team} next={next === i} />
      ))}
      {sdShown &&
        Array.from({ length: 5 }, (_, j) => {
          const i = sdStart + j;
          if (i >= kicks.length && next !== i) return null;
          return <Pip key={`sd${i}`} x={428 + j * 42} y={y} state={i < kicks.length ? kicks[i] : null} team={team} next={next === i} />;
        })}
    </g>
  );
}

export default function Board({ s, pA, pB, pick, odds, next, shot, live, goalFor }: BoardProps) {
  const sdShown = s.a.length > KICKS || (s.b.length >= KICKS && s.a.length >= KICKS);
  const pairs = Math.max(s.a.length, s.b.length) - KICKS;
  const sdStart = KICKS + Math.max(0, pairs - 5 + (s.a.length === s.b.length ? 1 : 0));
  const hidden = sdStart - KICKS;
  const nextIdx = (t: Team) => (next && next.team === t ? (t === 'A' ? s.a.length : s.b.length) : null);

  const p = goalFor === 'A' ? pA : pB;
  const { lo, hi } = keeperZone(p);
  const kx = GX + lo * GW;
  const kw = (hi - lo) * GW;
  const flying = shot && !shot.landed;
  const landed = shot && shot.landed;
  const target = shot ? shotPoint(shot.u) : null;
  const flyStyle =
    target && shot
      ? ({
          '--tx': `${target.x - SPOT.x}px`,
          '--ty': `${target.y - SPOT.y}px`,
          animationDuration: `${shot.ms}ms`,
        } as CSSProperties)
      : undefined;

  // The outcome bar: Teal outright | Teal via sudden death | Orange via sudden death | Orange outright.
  const aSd = Math.max(0, odds.A - odds.regA);
  const bSd = Math.max(0, odds.B - odds.regB);
  const seg = [odds.regA, aSd, bSd, odds.regB];
  const xs: number[] = [BAR.x];
  for (const v of seg) xs.push(xs[xs.length - 1] + v * BAR.w);
  const pickSpan = pick === 'A' ? [xs[0], xs[2]] : pick === 'B' ? [xs[2], xs[4]] : [xs[1], xs[3]];
  const kickerName = next ? TEAM_NAME[next.team] : TEAM_NAME[goalFor];
  const kickNo = next ? (next.team === 'A' ? s.a.length : s.b.length) + 1 : 0;

  return (
    <svg viewBox="0 0 640 450" className="shoot" role="img" aria-label={`Teal ${s.a.filter(Boolean).length}, Orange ${s.b.filter(Boolean).length}`}>
      <defs>
        <pattern id="sh-hatch-a" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" className="hatch-a-bg" />
          <rect width="3" height="8" className="hatch-a" />
        </pattern>
        <pattern id="sh-hatch-b" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" className="hatch-b-bg" />
          <rect width="3" height="8" className="hatch-b" />
        </pattern>
      </defs>

      {/* Scoreboard: five kicks each, then sudden-death pairs. */}
      <Row team="A" y={30} kicks={s.a} sdShown={sdShown} sdStart={sdStart} next={nextIdx('A')} />
      <Row team="B" y={80} kicks={s.b} sdShown={sdShown} sdStart={sdStart} next={nextIdx('B')} />
      <line x1={406} y1={10} x2={406} y2={100} className="sd-split" />
      {sdShown ? (
        hidden > 0 && (
          <text x={406} y={114} className="sd-more">
            +{hidden} earlier pairs
          </text>
        )
      ) : (
        <>
          <text x={518} y={50} className="sd-label">
            if level after 5:
          </text>
          <text x={518} y={68} className="sd-label strong">
            sudden death
          </text>
        </>
      )}

      {/* The goal: the keeper covers 1 − p of the mouth, the green corners are the chance to score. */}
      <g className={'goal' + (landed ? (shot!.goal ? ' scored' : ' saved') : '')}>
        <rect x={GX} y={GY} width={GW} height={GH} className="net-bg" />
        {Array.from({ length: 14 }, (_, i) => (
          <line key={`v${i}`} x1={GX + (i + 1) * 20} y1={GY} x2={GX + (i + 1) * 20} y2={GY + GH} className="net" />
        ))}
        {Array.from({ length: 5 }, (_, i) => (
          <line key={`h${i}`} x1={GX} y1={GY + (i + 1) * 20} x2={GX + GW} y2={GY + (i + 1) * 20} className="net" />
        ))}
        <rect x={GX} y={GY} width={lo * GW} height={GH} className="zone score" />
        <rect x={GX + hi * GW} y={GY} width={(1 - hi) * GW} height={GH} className="zone score" />
        <rect x={kx} y={GY} width={kw} height={GH} className="zone save" />
        {/* The keeper: arms spread across exactly the zone it covers. */}
        <g className="keeper">
          <rect x={kx + 3} y={GY + GH / 2 - 8} width={Math.max(0, kw - 6)} height={16} rx={8} />
          <circle cx={kx + kw / 2} cy={GY + GH / 2 - 24} r={11} />
          <rect x={kx + kw / 2 - 9} y={GY + GH / 2} width={18} height={GH / 2 - 4} rx={6} />
        </g>
        <text x={GX + (lo * GW) / 2} y={GY + GH - 10} className="zone-tag score">
          {lo * GW > 50 ? 'goal' : ''}
        </text>
        <text x={GX + hi * GW + ((1 - hi) * GW) / 2} y={GY + GH - 10} className="zone-tag score">
          {lo * GW > 50 ? 'goal' : ''}
        </text>
        <path d={`M ${GX} ${GY + GH} L ${GX} ${GY} L ${GX + GW} ${GY} L ${GX + GW} ${GY + GH}`} className="frame" />
        <line x1={GX - 40} y1={GY + GH} x2={GX + GW + 40} y2={GY + GH} className="ground" />
      </g>

      {/* What the next kick does to your odds: the two branches average to your chance now. */}
      {next && (
        <>
          <g className="branch goal-branch">
            <text x={85} y={156} className="b-title">
              {kickerName} scores
            </text>
            <text x={85} y={192} className="b-p">
              {pct(next.p)}
            </text>
            <text x={85} y={218} className="b-sub">
              {live ? 'your odds →' : 'then your odds'}
            </text>
            <text x={85} y={250} className={'b-to' + (next.ifGoal > odds[pick] + 1e-12 ? ' up' : next.ifGoal < odds[pick] - 1e-12 ? ' down' : '')}>
              {pct(next.ifGoal)}
            </text>
          </g>
          <g className="branch save-branch">
            <text x={555} y={156} className="b-title">
              Keeper saves
            </text>
            <text x={555} y={192} className="b-p">
              {pct(1 - next.p)}
            </text>
            <text x={555} y={218} className="b-sub">
              {live ? 'your odds →' : 'then your odds'}
            </text>
            <text x={555} y={250} className={'b-to' + (next.ifMiss > odds[pick] + 1e-12 ? ' up' : next.ifMiss < odds[pick] - 1e-12 ? ' down' : '')}>
              {pct(next.ifMiss)}
            </text>
          </g>
        </>
      )}

      {/* The spot and the ball. */}
      <circle cx={SPOT.x} cy={SPOT.y + 12} r={3} className="spot" />
      <g key={shot?.id ?? 'rest'} className={'ball-wrap' + (flying ? ' fly' : landed ? ' at' : '')} style={flyStyle}>
        <circle cx={SPOT.x} cy={SPOT.y} r={11} className={'ball ' + (shot ? shot.team.toLowerCase() : '') + (landed ? (shot!.goal ? ' in' : ' out') : '')} />
      </g>
      {next && (
        <text x={SPOT.x} y={350} className={'kicker ' + next.team.toLowerCase()}>
          {kickerName} · {kickNo > KICKS ? `sudden death kick ${kickNo - KICKS}` : `kick ${kickNo} of ${KICKS}`}
        </text>
      )}
      {!next && landed && (
        <text x={SPOT.x} y={350} className={'kicker ' + (shot!.goal ? 'in' : 'out')}>
          {shot!.goal ? 'Goal' : 'Saved'}
        </text>
      )}

      {/* The odds bar: lengths are the exact chances; the hatched middle is sudden death. */}
      <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={6} className="bar-bg" />
      {seg.map((v, i) =>
        v > 0 ? (
          <rect
            key={i}
            x={xs[i]}
            y={BAR.y}
            width={v * BAR.w}
            height={BAR.h}
            className={'bar-seg ' + ['a', 'a-sd', 'b-sd', 'b'][i]}
            fill={i === 1 ? 'url(#sh-hatch-a)' : i === 2 ? 'url(#sh-hatch-b)' : undefined}
          />
        ) : null,
      )}
      {odds.A > 0 && odds.B > 0 && <line x1={xs[2]} y1={BAR.y - 4} x2={xs[2]} y2={BAR.y + BAR.h + 4} className="bar-split" />}
      {pickSpan[1] - pickSpan[0] > 0.5 && (
        <>
          <rect x={pickSpan[0]} y={BAR.y - 3} width={pickSpan[1] - pickSpan[0]} height={BAR.h + 6} rx={7} className="bar-pick" />
          <text x={Math.min(BAR.x + BAR.w - 34, Math.max(BAR.x + 34, (pickSpan[0] + pickSpan[1]) / 2))} y={BAR.y - 9} className="bar-mine">
            your bet
          </text>
        </>
      )}
      {/* SD bracket under the hatched middle. */}
      {odds.SD > 0 && odds.SD < 1 && <path d={`M ${xs[1]} ${BAR.y + BAR.h + 4} v 5 H ${xs[3]} v -5`} className="sd-bracket" />}
      <text x={BAR.x} y={BAR.y + BAR.h + 32} className={'bar-label a' + (pick === 'A' ? ' mine' : '')}>
        Teal {pct(odds.A)}
      </text>
      <text x={320} y={BAR.y + BAR.h + 32} className={'bar-label sd' + (pick === 'SD' ? ' mine' : '')}>
        Sudden death {pct(odds.SD)}
      </text>
      <text x={BAR.x + BAR.w} y={BAR.y + BAR.h + 32} className={'bar-label b' + (pick === 'B' ? ' mine' : '')}>
        Orange {pct(odds.B)}
      </text>
    </svg>
  );
}
