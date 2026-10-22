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
import { useMemo, useRef, useState } from 'react';
import Field, { LETTERS } from './Board';
import {
  MAX_MULTIPLIER,
  MAX_PICKS,
  RTP,
  SIZES,
  decide,
  grid,
  initialState,
  prizeFor,
  quickPicks,
  resolution,
  startChance,
  step,
  volatilityOf,
  winChance,
  type Pick,
  type QuickPick,
  type Size,
  type TreeState,
} from './math';

type Phase = 'idle' | 'sweeping' | 'checkpoint' | 'over';
type Outcome = 'win' | 'lose' | 'cashed';

interface Round {
  size: Size;
  picks: Pick[];
  stake: number;
  /** Locked at bet time: RTP / P₀. */
  prize: number;
  state: TreeState;
  cash: number;
  outcome: Outcome | null;
}

const ACCENT = '#b8c0ff';
const OUTCOME_TITLE: Record<Outcome, string> = { win: 'All edges came good', lose: 'An edge went wrong', cashed: 'Cashed out' };
const sizeLabel = (s: Size) => s.replace('x', '×');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** A middle edge backed IN and a right-hand rung laid OUT. */
function defaultPicks(size: Size): Pick[] {
  const g = grid(size);
  const find = (r: number, c: number, horizontal: boolean) => g.edges.findIndex((e) => e.r === r && e.c === c && e.horizontal === horizontal);
  return [
    { edge: find(Math.floor(g.rows / 2), Math.floor((g.cols - 2) / 2), true), want: 'in' },
    { edge: find(g.rows - 2, g.cols - 1, false), want: 'out' },
  ];
}

/** Which sweep layer a state has reached, as "rows swept". */
function layersDone(st: TreeState) {
  const g = grid(st.size);
  return st.next >= g.edges.length ? g.layers : g.edges[st.next].layer;
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [size, setSize] = useState<Size>('4x4');
  const [picks, setPicks] = useState<Pick[]>(() => defaultPicks('4x4'));
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // A sweep is decided the moment it starts, so leaving mid-animation settles
  // at its real result, never at the pre-sweep value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'sweeping' ? resolved.current : round?.cash ?? 0));

  const revealMs = turbo.turbo ? 80 : 320;
  const live = phase === 'sweeping' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setFlash(null);
    setPhase('over');
  }

  function sweep(r: Round) {
    const { state, reveals } = step(r.state, r.picks, rng);
    const res = resolution(state, r.picks);
    const cash = res ? (res === 'win' ? r.prize : 0) : r.prize * winChance(state, r.picks);
    resolved.current = cash;
    setPhase('sweeping');

    // Play the reveals one edge at a time.
    let shown = r.state;
    reveals.forEach(({ inTree }, i) => {
      shown = decide(shown, inTree);
      const frame = shown;
      timers.after(i * revealMs, () => {
        setFlash(frame.next - 1);
        setRound({ ...r, state: frame });
      });
    });
    timers.after(reveals.length * revealMs + (turbo.turbo ? 40 : 160), () => {
      const next = { ...r, state, cash };
      if (res === 'win') return finish(next, 'win', r.prize);
      if (res === 'lose') return finish(next, 'lose', 0);
      setRound(next);
      setFlash(null);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: winChance(state, r.picks) });
    });
  }

  async function start() {
    if (live || bet.blocked || picks.length === 0) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { size, picks, stake: bet.value, prize: prizeFor(size, picks), state: initialState(size), cash: RTP, outcome: null };
    setRound(r);
    sweep(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setFlash(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (live) return;
    apply();
    if (phase === 'over') clear();
  };

  // Tap cycle on an edge: off → IN → OUT → off. Laying OUT edges that would cut a
  // dot off (no tree could avoid them all) is skipped. A fourth pick drops the oldest.
  function toggle(edge: number) {
    change(() =>
      setPicks((prev) => {
        const i = prev.findIndex((p) => p.edge === edge);
        if (i < 0) {
          const next = [...prev, { edge, want: 'in' } as Pick].slice(-MAX_PICKS);
          return startChance(size, next) > 0 ? next : prev;
        }
        if (prev[i].want === 'in') {
          const next = prev.map((p, j): Pick => (j === i ? { ...p, want: 'out' } : p));
          if (startChance(size, next) > 0) return next;
        }
        return prev.filter((_, j) => j !== i);
      }),
    );
  }

  function quick(kind: QuickPick) {
    change(() => setPicks(quickPicks(size, kind === 'safe' ? 1 : kind === 'random' ? 2 : 3, kind, rng)));
  }

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? sweep(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const idleState = useMemo(() => initialState(size), [size]);
  const st = round?.state ?? idleState;
  const shownPicks = round?.picks ?? picks;
  const g = grid(st.size);
  const p0 = picks.length ? startChance(size, picks) : 0;
  const prize = round?.prize ?? (p0 > 0 ? RTP / p0 : 0);
  const pNow = round ? (round.outcome === 'cashed' ? winChance(st, shownPicks) : round.outcome ? (round.outcome === 'win' ? 1 : 0) : winChance(st, shownPicks)) : p0;
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const swept = layersDone(st);
  const nextLayer = st.next < g.edges.length ? g.edges[st.next].layer : null;
  const nextLabel = nextLayer === null ? '' : nextLayer % 2 === 0 ? `row ${nextLayer / 2 + 1}` : `rungs ${(nextLayer + 1) / 2}–${(nextLayer + 3) / 2}`;
  const pickWord = (ps: Pick[]) => ps.map((p, i) => `${LETTERS[i]} ${p.want.toUpperCase()}`).join(', ');

  let status = picks.length ? `Ready · ${sizeLabel(size)} grid, backing ${pickWord(picks)}` : `Ready · tap edges to back them`;
  if (phase === 'sweeping') status = `Sweeping ${nextLabel || 'the last row'}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${swept} of ${g.layers} sweeps done`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${plural(swept, 'sweep')}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Spanning"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={p0 > 0 ? <VolBadge level={volatilityOf(p0)} /> : undefined}>Grid</Label>
          <Chips
            label="Grid size"
            options={SIZES.map((v) => ({ value: v, label: sizeLabel(v) }))}
            value={size}
            disabled={live}
            onChange={(v) =>
              change(() => {
                setSize(v);
                setPicks(defaultPicks(v));
              })
            }
          />

          <Label hint={`tap the board · up to ${MAX_PICKS}`}>Your edges</Label>
          <div className="og-chips" role="group" aria-label="Quick picks">
            {(
              [
                ['safe', 'Safe'],
                ['random', 'Random'],
                ['long', 'Long shot'],
              ] as const
            ).map(([kind, label]) => (
              <button key={kind} type="button" className="og-chip" disabled={live} onClick={() => quick(kind)}>
                {label}
              </button>
            ))}
          </div>
          <div className="span-picks">
            {picks.length === 0 && <span className="none">No edges backed yet</span>}
            {picks.map((p, i) => (
              <span key={p.edge} className={'chip ' + p.want}>
                <b>{LETTERS[i]}</b> {p.want === 'in' ? 'IN' : 'OUT'}
              </span>
            ))}
          </div>

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{p0 > 0 ? fmtChance(p0) : '—'}</dd>
            <dt>Prize</dt>
            <dd>{p0 > 0 ? fmtMult(RTP / p0) : '—'}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && sweep(round)}>
                Sweep {nextLabel}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked || picks.length === 0} onClick={() => void start()}>
              {phase === 'sweeping' ? 'Sweeping…' : picks.length === 0 ? 'Back an edge first' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            value: shownPicks.length ? fmtChance(pNow) : '—',
            sub: live ? `${plural(g.layers - swept, 'sweep')} left` : phase === 'over' ? `after ${plural(swept, 'sweep')}` : 'all edges as backed',
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'after each sweep', tone: 'cash' },
          { label: 'Prize', value: prize > 0 ? fmtMult(prize) : '—', sub: prize > 0 ? formatAmount(stake * prize, 2) : 'back an edge', tone: 'prize' },
        ]}
      />

      <Board className={'span-stage' + (phase === 'over' ? ' over' : '')}>
        <Field
          state={st}
          picks={shownPicks}
          editable={!live}
          onToggle={toggle}
          flash={flash}
          live={live}
          outcome={round?.outcome ?? null}
        />
        {phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={OUTCOME_TITLE[round.outcome]}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement="inline"
          />
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={pNow}
          label="Chance every backed edge comes good"
          note="The last funnel bar: each edge's live chance given the ones before it, multiplied. Edges revealed OUT widen the rest; edges revealed IN thin them."
        />
      ) : (
        <Caption>
          A uniform random spanning tree of the {sizeLabel(st.size)} grid is revealed row by row. Back up to three edges IN or OUT: these settings win{' '}
          {p0 > 0 ? fmtChance(p0) : '—'} of the time. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Spanning" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A <b>spanning tree</b> links every dot of the grid with no loops. One is chosen uniformly at random from all of them (the 4×4 grid has 100,352)
              and revealed row by row. Back up to three edges: each must end up IN the tree, or OUT of it, as you called it.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a grid. Tap an edge to back it IN, tap again to lay it OUT, a third time to drop it. Quick picks choose for you: Safe backs one likely edge, Random two edges, Long shot three unlikely calls.</li>
              <li>Bet: the sweep reveals the top row. After each sweep (a row, or the rungs below it) you can cash out (C), or sweep on (Space).</li>
              <li>The round ends the moment your edges are settled: all as called wins the prize, any one wrong loses.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Every edge is drawn as wide as its chance of being in the tree right now. Revealed IN edges are solid; OUT edges fade to a thin dashed line. Each
              backed edge carries a badge with its own live chance.
            </p>
            <p>
              The funnel under the grid multiplies them out: A's chance, then B's chance given A, then C's given both. The last bar is your win chance. Edges
              compete: when a neighbour comes IN, yours gets thinner; when one goes OUT, yours gets wider, so the odds swing both ways.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Kirchhoff (1847): treat every edge as a 1 Ω resistor. The chance an edge is in a uniform spanning tree equals the effective resistance between its
              ends. Revealed IN edges are short-circuited and OUT edges cut, and the same rule gives the next edge's chance, so revealing the sweep edge by edge
              with these chances draws the tree exactly.
            </p>
            <p>
              Burton and Pemantle (1993): for several edges, the chance they are all in the tree is the determinant of the <b>transfer-current matrix</b> Y(e, f),
              the voltage across f when a unit current flows through e. Backing an edge OUT swaps its row for the matching row of I − Y. The game computes these
              exactly from the grid's Laplacian, and the starting chances from the matrix-tree theorem's integer tree counts.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is fixed when you bet at {(RTP * 100).toFixed(0)}% ÷ (your starting chance). Cashing out pays prize × your chance now. That is the
              average of the final payout given everything revealed so far, so every sweep is a fair bet and the round is worth {(RTP * 100).toFixed(0)}% of
              your stake whenever you cash out. Which edges you back, and how, only trades chance for prize. The largest prize is{' '}
              {fmtMult(RTP * 48)} (three laid edges that leave 4 of the 3×3 grid's 192 trees), within the {MAX_MULTIPLIER}× cap.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
