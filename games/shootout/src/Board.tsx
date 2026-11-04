import type { CSSProperties } from 'react';
import { KICKS, keeperZone, type Forecast, type Kicks, type Odds, type Pick, type Team } from './math';

/** Names shown to the player. The rules never name a colour, so the board needs no team colours. */
export const TEAM_LABEL: Record<Team, string> = { A: 'Home', B: 'Away' };
export const PICK_LABEL: Record<Pick, string> = { A: 'Home', B: 'Away', SD: 'Sudden death' };

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
  /** Whether this kick settles your bet either way it goes. */
  decisive?: boolean;
}

export interface BoardProps {
  s: Kicks;
  /** Scoring chance of each side, for the keeper. */
  pA: number;
  pB: number;
  pick: Pick;
  odds: Odds;
  /** The next kick (null when the round is over). */
  next: Forecast | null;
  shot: Shot | null;
  /** Which side's keeper is in goal now. */
  goalFor: Team;
}

const GX = 120;
const GW = 400;
const GY = 130;
const GH = 130;
const SPOT = { x: 320, y: 314 };
const BAR = { x: 20, y: 384, w: 600, h: 26 };

/** Where a shot at u lands inside the mouth (the height is cosmetic, derived from u). */
export function shotPoint(u: number) {
  const x = GX + 10 + u * (GW - 20);
  const h = (u * 7919.37) % 1;
  return { x, y: GY + 26 + h * (GH - 52) };
}

function Pip({ x, y, state, next }: { x: number; y: number; state: boolean | null; next: boolean }) {
  return (
    <g className={`pip ${state === null ? 'empty' : state ? 'goal' : 'miss'}`}>
      {next && <circle cx={x} cy={y} r={20} className="next-ring" />}
      <circle cx={x} cy={y} r={14} />
      {state === false && <path d={`M ${x - 6} ${y - 6} L ${x + 6} ${y + 6} M ${x + 6} ${y - 6} L ${x - 6} ${y + 6}`} className="x" />}
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
  mine,
}: {
  team: Team;
  y: number;
  kicks: readonly boolean[];
  sdShown: boolean;
  sdStart: number;
  next: number | null;
  mine: boolean;
}) {
  const goals = kicks.filter(Boolean).length;
  return (
    <g className={'row' + (mine ? ' mine' : '')}>
      <rect x={8} y={y - 22} width={624} height={44} rx={8} className="row-bg" />
      <text x={24} y={y + 7} className="name">
        {TEAM_LABEL[team]}
      </text>
      <text x={146} y={y + 9} className="score">
        {goals}
      </text>
      {Array.from({ length: KICKS }, (_, i) => (
        <Pip key={i} x={190 + i * 44} y={y} state={i < kicks.length ? kicks[i] : null} next={next === i} />
      ))}
      {sdShown &&
        Array.from({ length: 5 }, (_, j) => {
          const i = sdStart + j;
          if (i >= kicks.length && next !== i) return null;
          return <Pip key={`sd${i}`} x={428 + j * 42} y={y} state={i < kicks.length ? kicks[i] : null} next={next === i} />;
        })}
    </g>
  );
}

export default function Board({ s, pA, pB, pick, odds, next, shot, goalFor }: BoardProps) {
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

  // The outcome bar: Home outright | Home via sudden death | Away via sudden death | Away outright.
  const aSd = Math.max(0, odds.A - odds.regA);
  const bSd = Math.max(0, odds.B - odds.regB);
  const seg = [odds.regA, aSd, bSd, odds.regB];
  const xs: number[] = [BAR.x];
  for (const v of seg) xs.push(xs[xs.length - 1] + v * BAR.w);
  const pickSpan = pick === 'A' ? [xs[0], xs[2]] : pick === 'B' ? [xs[2], xs[4]] : [xs[1], xs[3]];
  const kickerName = next ? TEAM_LABEL[next.team] : TEAM_LABEL[goalFor];
  const kickNo = next ? (next.team === 'A' ? s.a.length : s.b.length) + 1 : 0;

  // The keeper dives as the ball flies: to the ball on a save, the wrong way on a goal.
  // Only the block moves; the zones (the odds) stay put.
  let dive: CSSProperties | undefined;
  if (shot && target) {
    const centre = kx + kw / 2;
    const side = Math.sign(target.x - centre) || 1;
    const dx = shot.goal ? -side * Math.max(18, kw * 0.22) : (target.x - centre) * 0.75;
    dive = {
      '--kdx': `${dx}px`,
      animationDuration: `${shot.ms * 0.85}ms`,
      animationDelay: `${shot.ms * 0.12}ms`,
    } as CSSProperties;
  }

  return (
    <svg viewBox="0 0 640 450" className="shoot" role="img" aria-label={`Home ${s.a.filter(Boolean).length}, Away ${s.b.filter(Boolean).length}`}>
      {/* Scoreboard: five kicks each, then sudden-death pairs. Your side is marked with the accent. */}
      <Row team="A" y={30} kicks={s.a} sdShown={sdShown} sdStart={sdStart} next={nextIdx('A')} mine={pick === 'A'} />
      <Row team="B" y={80} kicks={s.b} sdShown={sdShown} sdStart={sdStart} next={nextIdx('B')} mine={pick === 'B'} />
      <line x1={406} y1={10} x2={406} y2={100} className="sd-split" />
      {sdShown ? (
        hidden > 0 && (
          <text x={406} y={114} className="sd-more">
            +{hidden} earlier pairs
          </text>
        )
      ) : (
        <text x={518} y={60} className="sd-label">
          sudden death
        </text>
      )}

      {/* The goal: the keeper covers 1 − p of the mouth, the green corners are the chance to score. */}
      <g className="goal">
        <rect x={GX} y={GY} width={GW} height={GH} className="net-bg" />
        <rect x={GX} y={GY} width={lo * GW} height={GH} className="zone score" />
        <rect x={GX + hi * GW} y={GY} width={(1 - hi) * GW} height={GH} className="zone score" />
        <rect x={kx} y={GY} width={kw} height={GH} className="zone save" />
        {/* The keeper: a neutral block spanning exactly the zone it covers. */}
        <g className="keeper">
          <g key={shot?.id ?? 'still'} className={'dive' + (dive ? ' go' : '')} style={dive}>
            <rect x={kx + 4} y={GY + GH - 64} width={Math.max(0, kw - 8)} height={60} rx={4} />
          </g>
        </g>
        <path d={`M ${GX} ${GY + GH} L ${GX} ${GY} L ${GX + GW} ${GY} L ${GX + GW} ${GY + GH}`} className="frame" />
        <line x1={GX - 40} y1={GY + GH} x2={GX + GW + 40} y2={GY + GH} className="ground" />
      </g>

      {/* The spot and the ball: an accent dot that stays where the last kick landed. */}
      <circle cx={SPOT.x} cy={SPOT.y + 12} r={3} className="spot" />
      <g key={shot?.id ?? 'rest'} className={'ball-wrap' + (flying ? ' fly' : landed ? ' at' : '')} style={flyStyle}>
        <circle cx={SPOT.x} cy={SPOT.y} r={11} className={'ball' + (landed ? (shot!.goal ? ' in' : ' out') : '')} />
      </g>
      {next && (
        <text x={SPOT.x} y={350} className="kicker">
          {kickerName} · {kickNo > KICKS ? `sudden death kick ${kickNo - KICKS}` : `kick ${kickNo} of ${KICKS}`}
        </text>
      )}
      {!next && landed && (
        <text x={SPOT.x} y={350} className={'kicker ' + (shot!.goal ? 'in' : 'out')}>
          {shot!.goal ? 'Goal' : 'Saved'}
        </text>
      )}

      {/* The odds bar: lengths are the exact chances; the pale middle is sudden death. */}
      <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={6} className="bar-bg" />
      {seg.map((v, i) =>
        v > 0 ? (
          <rect key={i} x={xs[i]} y={BAR.y} width={v * BAR.w} height={BAR.h} className={'bar-seg ' + (i === 1 || i === 2 ? 'sd' : 'out')} />
        ) : null,
      )}
      {odds.A > 0 && odds.B > 0 && <line x1={xs[2]} y1={BAR.y - 4} x2={xs[2]} y2={BAR.y + BAR.h + 4} className="bar-split" />}
      {pickSpan[1] - pickSpan[0] > 0.5 && (
        <rect x={pickSpan[0]} y={BAR.y - 3} width={pickSpan[1] - pickSpan[0]} height={BAR.h + 6} rx={7} className="bar-pick" />
      )}
      {/* SD bracket under the middle. */}
      {odds.SD > 0 && odds.SD < 1 && <path d={`M ${xs[1]} ${BAR.y + BAR.h + 4} v 5 H ${xs[3]} v -5`} className="sd-bracket" />}
      <text x={BAR.x} y={BAR.y + BAR.h + 32} className={'bar-label a' + (pick === 'A' ? ' mine' : '')}>
        Home
      </text>
      <text x={320} y={BAR.y + BAR.h + 32} className={'bar-label sd' + (pick === 'SD' ? ' mine' : '')}>
        Sudden death
      </text>
      <text x={BAR.x + BAR.w} y={BAR.y + BAR.h + 32} className={'bar-label b' + (pick === 'B' ? ' mine' : '')}>
        Away
      </text>
    </svg>
  );
}
