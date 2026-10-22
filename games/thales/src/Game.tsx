import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  BetField,
  Board,
  Caption,
  ChanceBar,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  Label,
  PanelFoot,
  Readouts,
  RoundOver,
  StageTop,
  VolBadge,
  fmtChance,
  fmtMult,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { formatAmount } from '@originals/game-sdk';
import { useRef, useState } from 'react';
import { ArenaBoard, Tally, ZoneCard, type TriRec } from './Board';
import {
  RTP,
  SERIES,
  acuteChance,
  arenaArea,
  bandArea,
  cashOutValue,
  formulaText,
  sideFormulaText,
  onSide,
  prizeOf,
  samplePoint,
  sideChance,
  sideShare,
  stateWinChance,
  thalesArea,
  volatilityOf,
  winChance,
  type Arena,
  type RoundState,
  type Series,
  type Settings,
  type Side,
} from './math';

const ACCENT = '#ff9b85';

/**
 * idle → dropping (A and B fall) → landed (checkpoint) → falling (C) →
 * between (checkpoint, more triangles to go) → … → over. When C can no longer
 * go either way (a measure-zero corner case) `sure` drops it on its own.
 */
type Phase = 'idle' | 'dropping' | 'landed' | 'sure' | 'falling' | 'between' | 'over';
type Outcome = 'won' | 'lost' | 'cashed';

interface Round {
  s: Settings;
  stake: number;
  tris: TriRec[];
  cash: number;
  outcome: Outcome | null;
}

const ARENA_LABEL: Record<Arena, string> = { square: 'Square', disc: 'Disc', triangle: 'Triangle' };

function outcomeTitle(r: Round): string {
  if (r.outcome === 'cashed') return 'Cashed out';
  if (r.outcome === 'won') return r.s.series > 1 ? `All ${r.s.series} ${r.s.side}` : r.s.side === 'acute' ? 'Acute triangle' : 'Obtuse triangle';
  return `${r.s.side === 'acute' ? 'Obtuse' : 'Acute'}: C landed in the red`;
}

function roundState(r: Round, phase: Phase): RoundState {
  const settled = r.tris.filter((t) => t.win === true).length;
  const cur = r.tris[r.tris.length - 1];
  const ab = cur && cur.win === null && phase !== 'dropping' ? ([cur.a, cur.b] as RoundState['ab']) : null;
  return { settled, ab };
}

function ArenaGlyph({ arena }: { arena: Arena }) {
  return (
    <svg viewBox="0 0 16 16" className="th-glyph" aria-hidden="true">
      {arena === 'square' ? <rect x={2} y={2} width={12} height={12} /> : arena === 'disc' ? <circle cx={8} cy={8} r={6.5} /> : <polygon points="8,2 14.5,14 1.5,14" />}
    </svg>
  );
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [side, setSide] = useState<Side>('acute');
  const [arena, setArena] = useState<Arena>('square');
  const [series, setSeries] = useState<Series>(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [roundKey, setRoundKey] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);

  // Each reveal is decided the moment it starts, so leaving mid-animation
  // settles at its real result, never at the pre-reveal value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'dropping' || phase === 'falling' || phase === 'sure' ? resolved.current : round?.cash ?? 0));

  const dropMs = turbo.turbo ? 180 : 720;
  const pauseMs = turbo.turbo ? 150 : 600;
  const live = phase !== 'idle' && phase !== 'over';
  const busy = phase === 'dropping' || phase === 'falling' || phase === 'sure';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  function dropC(r: Round, ms = dropMs) {
    const k = r.tris.length - 1;
    const cur = r.tris[k];
    const c = samplePoint(r.s.arena, rng.next(), rng.next());
    const win = onSide(r.s.side, cur.a, cur.b, c);
    const cash = win ? cashOutValue(r.s, { settled: k + 1, ab: null }) : 0;
    resolved.current = cash;
    const fell = { ...r, tris: r.tris.map((t, i) => (i === k ? { ...t, c } : t)) };
    setRound(fell);
    setPhase('falling');
    timers.after(ms, () => {
      const done = { ...fell, tris: fell.tris.map((t, i) => (i === k ? { ...t, win } : t)) };
      if (!win) return finish(done, 'lost', 0);
      if (k + 1 >= r.s.series) return finish(done, 'won', cash);
      setRound({ ...done, cash });
      setPhase('between');
      track({ type: 'checkpoint', multiplier: cash, winChance: stateWinChance(r.s, { settled: k + 1, ab: null }) });
    });
  }

  function dropAB(r: Round) {
    const k = r.tris.length;
    const a = samplePoint(r.s.arena, rng.next(), rng.next());
    const b = samplePoint(r.s.arena, rng.next(), rng.next());
    const cash = cashOutValue(r.s, { settled: k, ab: [a, b] });
    resolved.current = cash;
    const next: Round = { ...r, tris: [...r.tris, { a, b, c: null, win: null }] };
    setRound(next);
    setPhase('dropping');
    timers.after(dropMs, () => {
      const landed = { ...next, cash };
      setRound(landed);
      const q = sideShare(r.s, a, b);
      if (q <= 0 || q >= 1) {
        setPhase('sure');
        timers.after(pauseMs, () => dropC(landed));
        return;
      }
      setPhase('landed');
      track({ type: 'checkpoint', multiplier: cash, winChance: stateWinChance(r.s, { settled: k, ab: [a, b] }) });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { s: { arena, side, series }, stake: bet.value, tris: [], cash: RTP, outcome: null };
    setRoundKey((n) => n + 1);
    setRound(r);
    dropAB(r);
  }

  function next() {
    if (!round) return;
    if (phase === 'landed') dropC(round);
    else if (phase === 'between') dropAB(round);
  }

  function cashOut() {
    if ((phase !== 'landed' && phase !== 'between') || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setPhase('idle');
  }

  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'landed' || phase === 'between' ? next() : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const chosen: Settings = { arena, side, series };
  const s: Settings = round?.s ?? chosen;
  const p = sideChance(s);
  const prize = prizeOf(s);
  const stake = round?.stake ?? bet.value;
  const tris = round?.tris ?? [];
  const k = tris.length;
  const cur = tris[k - 1] ?? null;
  const st = round ? roundState(round, phase) : { settled: 0, ab: null };
  const cash = round?.cash ?? RTP;
  const winNow = !round ? winChance(s) : round.outcome === 'won' ? 1 : round.outcome === 'lost' ? 0 : stateWinChance(s, st);

  // Once A and B are down the zone is exact; before (idle, or between triangles) it's the average.
  const exact = !!cur && phase !== 'dropping' && !(phase === 'between');
  const area = arenaArea(s.arena);
  const band = exact && cur ? bandArea(s.arena, cur.a, cur.b) / area : null;
  const disc = exact && cur ? thalesArea(s.arena, cur.a, cur.b) / area : null;
  const share = exact && cur ? sideShare(s, cur.a, cur.b) : p;
  const remaining = s.series - st.settled - (st.ab ? 1 : 0);
  const nextChance = st.ab ? sideShare(s, st.ab[0], st.ab[1]) : p;
  const triWord = (n: number) => `${n} triangle${n === 1 ? '' : 's'}`;

  let status = `Ready · back ${s.side === 'acute' ? 'Acute' : 'Obtuse'} · ${triWord(s.series)} in a ${s.arena}`;
  if (phase === 'dropping') status = `Dropping A and B · triangle ${k} of ${s.series}`;
  if (phase === 'landed') status = `Checkpoint · A and B landed`;
  if (phase === 'sure') status = share >= 1 ? 'C cannot miss' : 'No room left for C';
  if (phase === 'falling') status = `Dropping C · triangle ${k} of ${s.series}`;
  if (phase === 'between') status = `Checkpoint · ${st.settled} of ${s.series} ${s.side}`;
  if (phase === 'over' && round?.outcome) status = outcomeTitle(round);
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const formula = sideFormulaText(s);

  // The board shows the current triangle; between triangles it keeps the last one until the next drop.
  const boardTri = cur;

  return (
    <GameLayout
      name="Thales"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={volatilityOf(chosen)} />}>Back</Label>
          <Chips
            label="Back acute or obtuse"
            options={[
              { value: 'acute' as Side, label: 'Acute', title: 'Win if every angle is under 90°' },
              { value: 'obtuse' as Side, label: 'Obtuse', title: 'Win if one angle is 90° or more' },
            ]}
            value={side}
            disabled={live}
            onChange={(v) => change(() => setSide(v))}
          />

          <Label hint="where the points land">Arena</Label>
          <Chips
            label="Arena"
            options={(['square', 'disc', 'triangle'] as Arena[]).map((a) => ({
              value: a,
              label: (
                <span className="th-chip">
                  <ArenaGlyph arena={a} /> {ARENA_LABEL[a]}
                </span>
              ),
              title: `Acute ${fmtChance(acuteChance(a))}`,
            }))}
            value={arena}
            disabled={live}
            onChange={(v) => change(() => setArena(v))}
          />

          <Label hint="every one must land your way">Triangles</Label>
          <Chips
            label="Triangles per round"
            options={SERIES.map((n) => ({ value: n, label: n }))}
            value={series}
            disabled={live}
            onChange={(v) => change(() => setSeries(v))}
          />

          <dl className="og-stats">
            <dt>Per triangle</dt>
            <dd>{fmtChance(sideChance(chosen))}</dd>
            <dt>Chance to win</dt>
            <dd>{fmtChance(winChance(chosen))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeOf(chosen))}</dd>
          </dl>

          {phase === 'landed' || phase === 'between' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={next}>
                {phase === 'landed' ? `Drop C · ${fmtChance(nextChance)} ${s.side}` : `Next triangle · ${fmtChance(p)}`}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {busy ? 'Dropping…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          {
            label: 'Win chance',
            value: fmtChance(winNow),
            sub: round
              ? round.outcome === 'won' || round.outcome === 'lost'
                ? `${triWord(st.settled)} of ${s.series} ${s.side}`
                : st.ab
                  ? `C ${fmtChance(nextChance)}${remaining > 0 ? ` · then ${triWord(remaining)} at ${fmtChance(p)}` : ''}`
                  : `${triWord(Math.max(0, s.series - st.settled))} at ${fmtChance(p)} each`
              : s.series > 1
                ? `(${formula})${s.series === 2 ? '²' : '³'}`
                : formula,
            tone: 'chance',
          },
          {
            label: phase === 'over' ? 'Paid' : 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'once A and B land',
            tone: 'cash',
          },
          { label: 'Full win', value: fmtMult(prize), sub: s.series > 1 ? `if all ${s.series} are ${s.side}` : `if ABC is ${s.side}`, tone: 'prize' },
        ]}
      />

      <Board>
        <div className="th-board">
          <ArenaBoard
            arena={s.arena}
            side={s.side}
            tri={boardTri}
            zone={!!boardTri && phase !== 'dropping'}
            falling={phase === 'dropping' ? 'ab' : phase === 'falling' ? 'c' : null}
            dropKey={`${roundKey}-${k}`}
            dropMs={dropMs}
          />
          <div className="th-side">
            <ZoneCard side={s.side} share={share} band={band} disc={disc} average={!exact} />
            <div className="th-slot">
              {phase === 'over' && round?.outcome ? (
                <RoundOver
                  key={history[0]?.id}
                  title={outcomeTitle(round)}
                  multiplier={round.cash}
                  stake={round.stake}
                  nextBet={bet.value}
                  blocked={bet.blocked}
                  onBetAgain={() => void start()}
                  onClear={clear}
                  placement="center"
                />
              ) : (
                <Tally tris={tris} count={s.series} side={s.side} />
              )}
            </div>
          </div>
        </div>
      </Board>

      {live ? (
        <ChanceBar
          p={nextChance}
          label={st.ab ? `C makes it ${s.side}` : `Next triangle is ${s.side}`}
          note={
            st.ab
              ? `C lands uniformly in the ${s.arena}: the green share of the arena is exactly this chance.`
              : `Before A and B land, a triangle is ${s.side} with chance ${formula} = ${fmtChance(p)}.`
          }
        />
      ) : (
        <Caption>
          Thales: the angle at C is 90° exactly on the circle with diameter AB. A triangle in a {s.arena} is acute with chance{' '}
          {s.arena === 'triangle' ? 'about' : `${formulaText(s.arena)} =`} {fmtChance(acuteChance(s.arena))}. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Thales" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Three points A, B and C land at random in an arena. Back <b>Acute</b> (every angle of triangle ABC under 90°) or <b>Obtuse</b> (one angle 90°
              or more). With a series of triangles, every one must land your way.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick Acute or Obtuse, the arena (square, disc or triangle) and how many triangles, then bet.</li>
              <li>A and B land first. That's a checkpoint: cash out, or drop C (Space).</li>
              <li>C lands anywhere in the arena with equal chance. With more triangles to go, you reach another checkpoint before the next pair drops.</li>
              <li>Land every triangle your way and the prize pays automatically.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Once A and B are down, the arena is split in two. The triangle is acute exactly when C lands inside the <b>band</b> between the two dashed
              lines (square to AB through A and through B) and outside the <b>circle</b> with diameter AB. The <b style={{ color: 'var(--green)' }}>green</b>{' '}
              area is where C wins and the <b style={{ color: 'var(--red)' }}>red</b> area where it loses; the green share of the arena is your exact chance.
              The card beside the board adds it up: band − circle = acute.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              <b>Thales' theorem:</b> the angle at C is a right angle exactly when C is on the circle with diameter AB; inside the circle it is obtuse, outside
              acute. The angle at A is obtuse when C lies behind the line square to AB at A, and likewise at B. So the acute region is the band minus the
              disc, and its area (clipped to the arena) is computed exactly.
            </p>
            <p>
              Averaged over A and B: in a square, P(obtuse) = 97/150 + π/40 ≈ 72.52%; in a disc, P(acute) = 4/π² − 1/8 ≈ 28.03%; in an equilateral
              triangle, P(acute) ≈ 25.18% (piecewise Gauss quadrature, checked against the square's closed form to 12 digits).
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              With n triangles and per-triangle chance p, the prize is {(RTP * 100).toFixed(0)}% / pⁿ. At any moment the cash-out is the prize times your
              exact chance to win from here (the green share for the current C, times p for each triangle still to come). That value is a martingale, so the
              round is worth {(RTP * 100).toFixed(0)}% of your stake however and whenever you cash out, and whatever settings you choose.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
