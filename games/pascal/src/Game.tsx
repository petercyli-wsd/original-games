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
import { useEffect, useRef, useState } from 'react';
import Field, { type Outcome, type Phase } from './Board';
import {
  MAX_MULTIPLIER,
  RTP,
  SIZES,
  START,
  WIDTHS,
  choose,
  downRightChance,
  gateCentre,
  headlineTally,
  maxWidth,
  placeGate,
  positions,
  prizeFor,
  rowCentre,
  rowOf,
  runToGate,
  sealed,
  step,
  tally,
  volatilityOf,
  type Gate,
  type Pos,
  type Size,
} from './math';

const ACCENT = '#b8f2e6';

interface Round {
  id: number;
  n: Size;
  gate: Gate;
  stake: number;
  /** Locked at the bet: RTP / P(win). */
  prize: number;
  /** Every tile the path has reached after the start, including a move still animating. */
  path: Pos[];
  /** The resolved cash-out after the latest move. */
  cash: number;
  outcome: Outcome | null;
  running: boolean;
}

const TITLE: Record<Outcome, string> = {
  through: 'Through the gate',
  locked: 'Gate locked in',
  missed: 'Missed the gate',
  unreachable: 'Gate out of reach',
  cashed: 'Cashed out',
};

const fmtCount = (x: number) => x.toLocaleString('en-US');
const plural = (x: number, w: string) => `${x} ${w}${x === 1 ? '' : 's'}`;

function offsetText(g: Gate, n: number) {
  const d = gateCentre(g) - rowCentre(n, g.row);
  if (Math.abs(d) < 1e-9) return 'centre';
  const k = Math.abs(d);
  return `${k % 1 ? k.toFixed(1) : k} ${d < 0 ? 'left' : 'right'}`;
}

/** Narrow boards get the result card inline, below the board, so it never covers the crossing bar. */
function useNarrow(threshold: number) {
  const [el, setEl] = useState<SVGSVGElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < threshold));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, threshold]);
  return [narrow, setEl] as const;
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();
  const [narrow, svgRef] = useNarrow(470);

  const [size, setSize] = useState<Size>(6);
  const [gate, setGate] = useState<Gate>(() => placeGate(6, 6, 1, 3));
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [shown, setShown] = useState(0);
  const [stepMs, setStepMs] = useState(380);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // A move is decided the moment it starts, so leaving mid-animation settles
  // at its real result, never at the pre-move value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'stepping' ? resolved.current : round?.cash ?? 0));

  const speed = turbo.turbo ? 0.25 : 1;
  const live = phase === 'stepping' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash, running: false });
    setShown(r.path.length);
    setPhase('over');
  }

  /** One step, or run until the round is sealed; then checkpoint or end. */
  function move(r: Round, run: boolean) {
    const seen = r.path.length;
    const from = r.path[seen - 1] ?? START;
    const drawn = run ? runToGate(r.n, from, r.gate, rng) : [step(r.n, from, rng)];
    const path = [...r.path, ...drawn];
    const end = path[path.length - 1];
    const fate = sealed(r.n, end, r.gate);
    const t = tally(r.n, end, r.gate);
    const cash = fate === 'win' ? r.prize : fate === 'lose' ? 0 : (r.prize * t.through) / t.total;
    resolved.current = cash;
    const next: Round = { ...r, path, cash, running: run };

    const per = Math.round((run ? 190 : 380) * speed);
    const hold = Math.round((run ? 220 : 60) * speed);
    // A new round snaps the walker back to the top before it moves.
    const lead = seen === 0 ? 40 : 0;
    setStepMs(seen === 0 ? 0 : per);
    setRound(next);
    setPhase('stepping');
    setShown(seen);
    drawn.forEach((_, i) =>
      timers.after(lead + per * i, () => {
        setStepMs(per);
        setShown(seen + i + 1);
      }),
    );

    timers.after(lead + per * drawn.length + hold, () => {
      if (fate) {
        const onRow = rowOf(end) === r.gate.row;
        return finish(next, fate === 'win' ? (onRow ? 'through' : 'locked') : onRow ? 'missed' : 'unreachable', cash);
      }
      setShown(path.length);
      setRound({ ...next, running: false });
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: t.through / t.total });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = {
      id: ++seq.current,
      n: size,
      gate,
      stake: bet.value,
      prize: prizeFor(size, gate),
      path: [],
      cash: RTP,
      outcome: null,
      running: false,
    };
    move(r, false);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setShown(0);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (live) return;
    apply();
    if (phase === 'over') clear();
  };

  const setGateRow = (row: number) =>
    change(() => setGate((g) => placeGate(size, row, g.width, rowCentre(size, row) + (gateCentre(g) - rowCentre(size, g.row)))));
  const setGateWidth = (width: number) => change(() => setGate((g) => placeGate(size, g.row, width, gateCentre(g))));
  const setGateLo = (lo: number) => change(() => setGate((g) => ({ ...g, lo })));
  const setGrid = (n: Size) =>
    change(() => {
      const k = n / size;
      const row = Math.min(2 * n - 1, Math.max(1, Math.round(gate.row * k)));
      setSize(n);
      setGate(placeGate(n, row, gate.width, rowCentre(n, row) + (gateCentre(gate) - rowCentre(size, gate.row)) * k));
    });
  const pickTile = (tile: Pos) => change(() => setGate((g) => placeGate(size, rowOf(tile), g.width, tile.a)));

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? move(round, false) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const n = round?.n ?? size;
  const g = round?.gate ?? gate;
  const trail = round ? round.path.slice(0, phase === 'stepping' ? shown : round.path.length) : [];
  const walker = trail[trail.length - 1] ?? START;
  const prize = round?.prize ?? prizeFor(size, gate);
  const stake = round?.stake ?? bet.value;
  const now = tally(n, walker, g);
  const pNow = now.through / now.total;
  const cash = phase === 'over' && round ? round.cash : round ? prize * pNow : RTP;
  const steps = rowOf(walker);
  const head = headlineTally(size, gate);
  const p0 = head.through / head.total;
  const qR = downRightChance(n, walker);
  const lows = positions(size, gate.row, gate.width);

  let status = `Ready · gate on row ${g.row} of ${2 * n}`;
  if (phase === 'stepping') status = round?.running ? `Running to the gate · step ${steps}` : `Step ${steps} of ${g.row}`;
  if (phase === 'checkpoint') status = `Checkpoint · step ${steps} of ${g.row}`;
  if (phase === 'over' && round?.outcome) status = `${TITLE[round.outcome]} · step ${steps}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Pascal"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={`${fmtCount(choose(2 * size, size))} equal paths`}>Grid</Label>
          <Chips label="Grid size" options={SIZES.map((v) => ({ value: v, label: `${v}×${v}` }))} value={size} disabled={live} onChange={setGrid} />

          <Label hint={`${plural(gate.row, 'step')} to decide`}>
            Gate row: <b style={{ color: 'var(--text)' }}>{gate.row}</b> of {2 * size}
          </Label>
          <Slider label="Gate row" min={1} max={2 * size - 1} value={gate.row} disabled={live} onChange={setGateRow} />

          <Label hint={<VolBadge level={volatilityOf(p0)} />}>Gate width</Label>
          <Chips
            label="Gate width"
            options={WIDTHS.map((v) => ({
              value: v,
              label: `${v} tile${v > 1 ? 's' : ''}`,
              disabled: v > maxWidth(size, gate.row),
              title: v > maxWidth(size, gate.row) ? 'A gate must cover less than half its row' : undefined,
            }))}
            value={gate.width}
            disabled={live}
            onChange={setGateWidth}
          />

          <Label hint={offsetText(gate, size)}>Gate position</Label>
          <Slider
            label="Gate position"
            min={lows[0]}
            max={lows[lows.length - 1]}
            value={gate.lo}
            disabled={live || lows.length < 2}
            onChange={setGateLo}
          />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(p0)}</dd>
            <dt>Paths through gate</dt>
            <dd>
              {fmtCount(head.through)} / {fmtCount(head.total)}
            </dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(size, gate))}</dd>
          </dl>

          {live && round ? (
            <>
              <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={() => move(round, false)}>
                Step · ↙ {Math.round((1 - qR) * 100)}% / ↘ {Math.round(qR * 100)}%
              </ActionButton>
              <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={() => move(round, true)}>
                Run to the gate
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={!!bet.blocked} onClick={() => void start()}>
              {phase === 'over' ? 'Bet again' : 'Bet'}
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
            value: fmtChance(pNow),
            sub: `${fmtCount(now.through)} of ${fmtCount(now.total)} paths`,
            tone: 'chance',
          },
          {
            label: 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'after every step',
            tone: 'cash',
          },
          { label: 'Prize', value: fmtMult(prize), sub: `pays ${formatAmount(stake * prize, 2)}`, tone: 'prize' },
        ]}
      />

      <Board className="pas-board">
          <Field
            svgRef={svgRef}
            n={n}
            gate={g}
            walker={walker}
            trail={trail}
            phase={phase}
            outcome={round?.outcome ?? null}
            stepMs={phase === 'stepping' ? stepMs : 0}
            onPick={live ? undefined : pickTile}
          />
          {phase === 'over' && round?.outcome && (
            <RoundOver
              key={history[0]?.id}
              title={TITLE[round.outcome]}
              multiplier={round.cash}
              stake={round.stake}
              nextBet={bet.value}
              blocked={bet.blocked}
              onBetAgain={() => void start()}
              onClear={clear}
              placement={narrow ? 'inline' : g.row > n ? 'top' : 'bottom'}
            />
          )}
        </Board>

      {live ? (
        <ChanceBar
          p={pNow}
          label="Chance the path crosses your gate"
          note="The green share of the crossing bar: paths from the walker through your gate, out of every path from the walker."
        />
      ) : (
        <Caption>
          All {fmtCount(choose(2 * n, n))} paths from top to bottom are equally likely. {fmtCount(headlineTally(n, g).through)} of them cross row {g.row}{' '}
          through your gate: {fmtChance(headlineTally(n, g).through / headlineTally(n, g).total)}. Click any tile to move the gate. RTP{' '}
          {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Pascal" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A random path runs from the top tile to the bottom tile, one step at a time, down-left (↙) or down-right (↘). Before it starts you place a{' '}
              <b style={{ color: 'var(--green)' }}>gate</b>: one to four tiles on one row. If the path crosses that row through your gate, you win the prize.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the grid, the gate's row, its width and its position (or click a tile on the board), then bet. The bet takes the first step.</li>
              <li>
                After every step you can cash out (C), take one more <b>Step</b> (Space), or <b>Run to the gate</b> and let it play out. Slow or fast, both
                are worth the same.
              </li>
              <li>
                The round ends the moment it is decided: when every path left passes your gate (you win), when none can (you lose), or when the path reaches
                the gate row.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              <b>The numbers count paths.</b> Above the gate row each tile shows how many ways the walker can still reach it: Pascal's triangle, grown from
              the walker, each number the sum of the two above it. Below the gate row each tile shows how many ways lead from it to the bottom: Pascal's
              triangle grown upwards from the end. On the gate row the two meet, and each tile shows <b>ways in × ways out</b>, the number of whole paths
              that cross there.
            </p>
            <p>
              <b>The crossing bar</b> under the board splits every path still possible by where it crosses the gate row. The{' '}
              <b style={{ color: 'var(--green)' }}>green share</b> is exactly your chance to win. The corner meters show the moves left and the chance the
              next step goes each way; the arrows from the walker are drawn in proportion.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              On an n×n grid a path makes n moves each way, so there are C(2n, n) paths: 924 on 6×6, 12,870 on 8×8. Every one is equally likely. A
              tile i steps ↘ and j steps ↙ from the start is crossed by C(i+j, i) · C(2n−i−j, n−i) of them, so
            </p>
            <p style={{ textAlign: 'center' }}>
              <b>P(through gate) = Σ (ways in × ways out) ÷ C(2n, n)</b>
            </p>
            <p>
              A uniform path is a shuffled deck of n ↘ cards and n ↙ cards, so the next step is ↘ with chance (↘ left) ÷ (moves left). That is what makes it
              different from Plinko: Plinko bounces 50/50 forever, while here the deck runs out, which keeps pulling the walker back towards the middle. Every
              row of the board is crossed exactly once, which is why a gate's tiles simply add up. Row r and row 2n − r have the same odds, so a far gate is
              just a longer ride.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is locked when you bet at {(RTP * 100).toFixed(0)}% ÷ (your gate's chance). Cashing out pays prize × your chance now, an exact ratio
              of path counts. By Pascal's rule (each count is the sum of the two below it) your chance after a step averages exactly to your chance before
              it, so every step is a fair bet and, by optional stopping, the round is worth {(RTP * 100).toFixed(0)}% of your stake whenever you cash out and
              wherever you put the gate. A gate must cover less than half its row and have at least a 1 in 2,000 chance, so the largest prize is{' '}
              {fmtMult(MAX_MULTIPLIER)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
