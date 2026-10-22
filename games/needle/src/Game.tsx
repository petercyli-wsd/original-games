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
  Slider,
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
import { useRef, useState, type CSSProperties } from 'react';
import { Dial, Floor, Tally, type NeedleRec } from './Board';
import {
  LENGTH_MAX,
  LENGTH_MIN,
  LENGTH_STEP,
  NEEDLES,
  RTP,
  averageCrossingArcs,
  cashOutValue,
  complementArcs,
  crossChance,
  formulaText,
  onSide,
  prizeOf,
  sideChance,
  sideFraction,
  snapLength,
  stateWinChance,
  volatilityOf,
  winArcs,
  winChance,
  type Floor as FloorKind,
  type NeedleCount,
  type RoundState,
  type Settings,
  type Side,
} from './math';

const ACCENT = '#ffd166';

/**
 * idle → dropping (a centre falls) → landed (checkpoint) → spinning → between
 * (checkpoint, more needles to go) → … → over. A centre whose spin is already
 * decided (every direction wins, or none does) goes through `sure` and spins
 * on its own.
 */
type Phase = 'idle' | 'dropping' | 'landed' | 'sure' | 'spinning' | 'between' | 'over';
type Outcome = 'won' | 'lost' | 'cashed';

interface Round {
  s: Settings;
  stake: number;
  needles: NeedleRec[];
  /** The cash-out multiplier of the state shown. */
  cash: number;
  outcome: Outcome | null;
}

function outcomeTitle(r: Round): string {
  const cross = r.s.side === 'cross';
  if (r.outcome === 'cashed') return 'Cashed out';
  if (r.outcome === 'won') return r.s.needles > 1 ? (cross ? 'Every needle crossed' : 'Every needle missed') : cross ? 'Crossed' : 'Clean miss';
  return cross ? 'Missed the lines' : 'Touched a line';
}

/** The round's state for pricing: needles settled on your side, and the current centre if it has landed. */
function roundState(r: Round, phase: Phase): RoundState {
  const settled = r.needles.filter((n) => n.win === true).length;
  const cur = r.needles[r.needles.length - 1];
  const landed = cur && cur.win === null && phase !== 'dropping' ? cur.centre : null;
  return { settled, landed };
}

function SideGlyph({ side }: { side: Side }) {
  return (
    <svg viewBox="0 0 22 14" className="nd-glyph" aria-hidden="true">
      <line x1={0} x2={22} y1={11} y2={11} className="l" />
      {side === 'cross' ? <line x1={6} y1={14} x2={16} y2={1} className="n" /> : <line x1={4} y1={5} x2={18} y2={2} className="n" />}
    </svg>
  );
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [side, setSide] = useState<Side>('cross');
  const [floor, setFloor] = useState<FloorKind>('lines');
  const [length, setLength] = useState(0.75);
  const [needles, setNeedles] = useState<NeedleCount>(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [roundKey, setRoundKey] = useState(0);
  const [spinFor, setSpinFor] = useState(0);

  // Each reveal is decided the moment it starts, so leaving mid-animation
  // settles at its real result, never at the pre-reveal value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'dropping' || phase === 'spinning' ? resolved.current : round?.cash ?? 0));

  const dropMs = turbo.turbo ? 160 : 620;
  const spinMs = turbo.turbo ? 320 : 1250;
  const pauseMs = turbo.turbo ? 160 : 650;
  const live = phase !== 'idle' && phase !== 'over';
  const busy = phase === 'dropping' || phase === 'spinning' || phase === 'sure';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  function spin(r: Round, ms = spinMs) {
    const k = r.needles.length - 1;
    const cur = r.needles[k];
    const theta = Math.PI * rng.next();
    const win = onSide(r.s, cur.centre, theta);
    const cash = win ? cashOutValue(r.s, { settled: k + 1, landed: null }) : 0;
    resolved.current = cash;
    // Whole half-turns first (a needle looks the same after half a turn), then θ.
    const spinDeg = (turbo.turbo ? 360 : 900) + (theta * 180) / Math.PI;
    const spun = { ...r, needles: r.needles.map((n, i) => (i === k ? { ...n, theta, spinDeg } : n)) };
    setRound(spun);
    setSpinFor(ms);
    setPhase('spinning');
    timers.after(ms, () => {
      const done = { ...spun, needles: spun.needles.map((n, i) => (i === k ? { ...n, win } : n)) };
      if (!win) return finish(done, 'lost', 0);
      if (k + 1 >= r.s.needles) return finish(done, 'won', cash);
      setRound({ ...done, cash });
      setPhase('between');
      track({ type: 'checkpoint', multiplier: cash, winChance: stateWinChance(r.s, { settled: k + 1, landed: null }) });
    });
  }

  function dropNext(r: Round) {
    const k = r.needles.length;
    const centre = { u: rng.next(), v: rng.next() };
    const cash = cashOutValue(r.s, { settled: k, landed: centre });
    resolved.current = cash;
    const next: Round = { ...r, needles: [...r.needles, { centre, theta: null, spinDeg: 0, win: null }] };
    setRound(next);
    setPhase('dropping');
    timers.after(dropMs, () => {
      const landed = { ...next, cash };
      setRound(landed);
      const q = sideFraction(r.s, centre);
      if (q <= 0 || q >= 1) {
        // Nothing left to decide: show the circle, then spin on its own.
        setPhase('sure');
        timers.after(pauseMs, () => spin(landed, Math.round(spinMs * 0.6)));
        return;
      }
      setPhase('landed');
      track({ type: 'checkpoint', multiplier: cash, winChance: stateWinChance(r.s, { settled: k, landed: centre }) });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { s: { floor, side, length, needles }, stake: bet.value, needles: [], cash: RTP, outcome: null };
    setRoundKey((n) => n + 1);
    setRound(r);
    dropNext(r);
  }

  function next() {
    if (!round) return;
    if (phase === 'landed') spin(round);
    else if (phase === 'between') dropNext(round);
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

  // Changing a setting after a round clears the finished board to a preview.
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
  const s: Settings = round?.s ?? { floor, side, length, needles };
  const chosen: Settings = { floor, side, length, needles };
  const p = sideChance(s);
  const prize = prizeOf(s);
  const stake = round?.stake ?? bet.value;
  const recs = round?.needles ?? [];
  const cur = recs[recs.length - 1] ?? null;
  const st = round ? roundState(round, phase) : { settled: 0, landed: null };
  const winNow = !round
    ? winChance(s)
    : round.outcome === 'won'
      ? 1
      : round.outcome === 'lost'
        ? 0
        : stateWinChance(s, st);
  const cash = round?.cash ?? RTP;
  const remaining = s.needles - st.settled - (st.landed ? 1 : 0);

  // The current needle's exact odds are shown once its centre is down; before
  // that (idle, or between needles) the dial shows the cell average.
  const showExact = !!cur && (phase === 'landed' || phase === 'sure' || phase === 'spinning' || phase === 'over');
  const curWin = cur ? winArcs(s, cur.centre) : [];
  const avgCross = averageCrossingArcs(s.floor, s.length);
  const dialWin = showExact ? curWin : s.side === 'cross' ? avgCross : complementArcs(avgCross);
  const share = showExact && cur ? sideFraction(s, cur.centre) : p;

  const word = s.side === 'cross' ? 'cross' : 'miss';
  const needleWord = (n: number) => `${n} needle${n === 1 ? '' : 's'}`;
  const k = recs.length; // needles dropped so far

  let status = `Ready · back ${word === 'cross' ? 'Cross' : 'Miss'} · ${needleWord(s.needles)}`;
  if (phase === 'dropping') status = `Dropping needle ${k} of ${s.needles}`;
  if (phase === 'landed') status = `Checkpoint · needle ${k} landed`;
  if (phase === 'sure')
    status =
      share >= 1
        ? s.side === 'cross'
          ? "Can't miss · every direction crosses"
          : 'Clear · no direction reaches a line'
        : s.side === 'cross'
          ? 'Out of reach · no direction crosses'
          : 'Boxed in · every direction touches';
  if (phase === 'spinning') status = `Spinning needle ${k} of ${s.needles}`;
  if (phase === 'between') status = `Checkpoint · ${st.settled} of ${s.needles} ${s.side === 'cross' ? 'crossed' : 'missed'}`;
  if (phase === 'over' && round?.outcome) status = outcomeTitle(round);
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const formula = formulaText(s.floor, s.side);
  const headline = s.needles > 1 ? `(${formula})${s.needles === 2 ? '²' : '³'}` : formula;

  // Next step's chance: this needle's spin once its centre is down, else a fresh needle.
  const nextChance = st.landed ? sideFraction(s, st.landed) : p;

  return (
    <GameLayout
      name="Needle"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={volatilityOf(chosen)} />}>Back</Label>
          <Chips
            label="Back cross or miss"
            options={[
              { value: 'cross' as Side, label: <span className="nd-chip"><SideGlyph side="cross" /> Cross</span>, title: 'Win if the needle touches a line' },
              { value: 'miss' as Side, label: <span className="nd-chip"><SideGlyph side="miss" /> Miss</span>, title: 'Win if the needle touches no line' },
            ]}
            value={side}
            disabled={live}
            onChange={(v) => change(() => setSide(v))}
          />

          <Label hint={floor === 'lines' ? "Buffon" : 'Buffon–Laplace'}>Floor</Label>
          <Chips
            label="Floor"
            options={[
              { value: 'lines' as FloorKind, label: 'Lines', title: 'Parallel lines 1 apart' },
              { value: 'grid' as FloorKind, label: 'Grid', title: 'A square grid, lines 1 apart both ways' },
            ]}
            value={floor}
            disabled={live}
            onChange={(v) => change(() => setFloor(v))}
          />

          <Label hint={<>ℓ = <b>{length.toFixed(2)}</b> of the spacing</>}>Needle length</Label>
          <Slider
            label="Needle length"
            min={LENGTH_MIN}
            max={LENGTH_MAX}
            step={LENGTH_STEP}
            value={length}
            disabled={live}
            onChange={(v) => change(() => setLength(snapLength(v)))}
          />

          <Label hint="every one must land your way">Needles</Label>
          <Chips
            label="Needles per round"
            options={NEEDLES.map((n) => ({ value: n, label: n }))}
            value={needles}
            disabled={live}
            onChange={(v) => change(() => setNeedles(v))}
          />

          <dl className="og-stats">
            <dt>Per needle</dt>
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
                {phase === 'landed' ? `Spin · ${fmtChance(nextChance)} to ${word}` : `Drop needle ${k + 1} · ${fmtChance(p)} avg`}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'dropping' ? 'Dropping…' : busy ? 'Spinning…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
                ? `${needleWord(st.settled)} of ${s.needles} landed your way`
                : st.landed
                ? `this needle ${fmtChance(share)}${remaining > 0 ? ` · then ${needleWord(remaining)} at ${fmtChance(p)}` : ''}`
                : `${needleWord(Math.max(0, s.needles - st.settled))} at ${fmtChance(p)} each`
              : headline,
            tone: 'chance',
          },
          {
            label: phase === 'over' ? 'Paid' : 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'once a centre lands',
            tone: 'cash',
          },
          { label: 'Full win', value: fmtMult(prize), sub: s.needles > 1 ? `if all ${s.needles} ${word}` : `if it ${word === 'cross' ? 'crosses' : 'misses'}`, tone: 'prize' },
        ]}
      />

      <Board>
        <div className="nd-board" style={{ '--nd-speed': turbo.turbo ? 0.3 : 1 } as CSSProperties}>
          <Floor
            drop={s}
            needles={recs}
            roundKey={roundKey}
            landed={showExact}
            win={curWin}
            lose={complementArcs(curWin)}
            dropMs={dropMs}
            spinMs={spinFor || spinMs}
            spinning={phase === 'spinning'}
            idle={!round}
          />
          <div className="nd-side">
            <Dial
              side={s.side}
              floor={s.floor}
              win={dialWin}
              lose={complementArcs(dialWin)}
              average={!showExact}
              share={share}
              needle={showExact ? cur : null}
              needleKey={`${roundKey}-${k}`}
              spinMs={spinFor || spinMs}
              spinning={phase === 'spinning'}
              waiting={phase === 'dropping'}
            />
            <div className="nd-slot">
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
                <Tally needles={recs} count={s.needles} side={s.side} />
              )}
            </div>
          </div>
        </div>
      </Board>

      {live ? (
        <ChanceBar
          p={nextChance}
          label={st.landed ? `Needle ${k} lands on ${word === 'cross' ? 'Cross' : 'Miss'}` : `Next needle lands on ${word === 'cross' ? 'Cross' : 'Miss'}`}
          note={
            st.landed
              ? "The green share of the direction dial is exactly this chance: the needle settles at a uniformly random angle."
              : `Before its centre lands, a needle ${word === 'cross' ? 'crosses' : 'misses'} with chance ${formula} = ${fmtChance(p)}.`
          }
        />
      ) : (
        <Caption>
          {s.side === 'cross' ? 'Back Cross: the needle must touch a line.' : 'Back Miss: the needle must touch no line.'}{' '}
          {s.floor === 'lines' ? "Buffon: a needle of length ℓ on lines 1 apart crosses with chance 2ℓ/π" : 'Buffon–Laplace: on a unit grid it touches a line with chance (4ℓ − ℓ²)/π'}
          {' '}= {fmtChance(crossChance(s.floor, s.length))}. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Needle" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A needle is dropped on a floor ruled with lines 1 apart. Back <b>Cross</b> (it must touch a line) or <b>Miss</b> (it must touch none). With
              several needles, every one must land your way.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick Cross or Miss, the floor (parallel lines, or a grid), the needle length ℓ and how many needles, then bet.</li>
              <li>The needle's centre lands first, anywhere in the cell. That's a checkpoint: cash out, or spin (Space).</li>
              <li>The needle then spins and settles at a random angle. With more needles to go, you reach another checkpoint before the next one drops.</li>
              <li>If every direction would win (or none would), the needle spins on its own. Land them all your way and the prize pays automatically.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Once a centre is down, the circle round it has radius ℓ/2: the reach of the needle. The <b style={{ color: 'var(--green)' }}>green</b>{' '}
              directions win and the <b style={{ color: 'var(--red)' }}>red</b> ones lose. The dial on the right is the same thing magnified: every needle
              direction from 0° to 180°, equally likely. Its green share is exactly your chance on this spin.
            </p>
            <p>
              Before a centre lands, the shaded bands along the lines show where a centre can reach a line (darker means a better chance to touch it),
              and the dial shows the directions that cross on average over the cell.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              <b>Buffon's needle:</b> a needle of length ℓ ≤ 1 dropped on lines 1 apart crosses one with probability 2ℓ/π. On a square grid
              (Buffon–Laplace) it touches a line with probability (4ℓ − ℓ²)/π.
            </p>
            <p>
              Given the centre, at distance d from the nearest line, the needle reaches it when its angle to the line is within arccos(2d/ℓ) of square,
              so a fraction (2/π)·arccos(2d/ℓ) of directions cross. On the grid the two bow-ties add up (to at most 100%). Averaging over the cell gives
              Buffon's formula back.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              With n needles and per-needle chance p, the prize is {(RTP * 100).toFixed(0)}% / pⁿ. At any moment the cash-out is the prize times your exact
              chance to win from here (this needle's green share, times p for each needle still to come). That value is a martingale, so the round is worth
              {' '}{(RTP * 100).toFixed(0)}% of your stake however and whenever you cash out, and whatever settings you choose.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}

