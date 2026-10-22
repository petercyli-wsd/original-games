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
import Field from './Board';
import {
  NODES,
  RTP,
  SIDES,
  SIDE_NAME,
  SPARES,
  budgetOf,
  clampSpare,
  connectPossible,
  decided,
  mergeChance,
  offered,
  openPairList,
  partsOf,
  prizeFor,
  startChance,
  volatilityOf,
  winChance,
  type Edge,
  type Nodes,
  type Side,
  type Spare,
} from './math';

type Phase = 'idle' | 'placing' | 'checkpoint' | 'over';
/** How the round ended: joined up, budget spent while split, settled early either way, or cashed. */
type Outcome = 'connected' | 'spent' | 'unreachable' | 'certain' | 'cashed';

interface Round {
  side: Side;
  n: Nodes;
  E: number;
  stake: number;
  /** Locked at bet time: RTP / P₀. */
  prize: number;
  edges: Edge[];
  cash: number;
  outcome: Outcome | null;
}

const ACCENT = '#90f1ef';

const TITLE: Record<Side, Record<Outcome, string>> = {
  connect: { connected: 'Connected', spent: 'Out of edges', unreachable: 'Out of reach', certain: 'Bound to connect', cashed: 'Cashed out' },
  split: { connected: 'Joined up', spent: 'Stayed split', unreachable: 'Can’t be joined', certain: 'Bound to join', cashed: 'Cashed out' },
};

function outcomeOf(parts: number[], m: number, E: number): Outcome {
  if (parts.length === 1) return 'connected';
  if (m >= E) return 'spent';
  return connectPossible(parts, m, E) ? 'certain' : 'unreachable';
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [side, setSide] = useState<Side>('connect');
  const [n, setN] = useState<Nodes>(8);
  const [spare, setSpare] = useState<Spare>(2);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  // The next edge is decided the moment it is picked, so leaving mid-animation
  // settles at its real result, never at the pre-edge value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'placing' ? resolved.current : round?.cash ?? 0));

  const speed = turbo.turbo ? 0.25 : 1;
  const cursorMs = Math.round(520 * speed);
  const drawMs = Math.round(380 * speed);
  const live = phase === 'placing' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPick(null);
    setDrawing(false);
    setPhase('over');
  }

  function place(r: Round) {
    const open = openPairList(r.n, r.edges);
    const i = rng.int(open.length);
    const edges: Edge[] = [...r.edges, [open[i].a, open[i].b]];
    const parts = partsOf(r.n, edges);
    const p = winChance(r.side, parts, edges.length, r.E);
    const cash = r.prize * p;
    resolved.current = cash;

    setPhase('placing');
    setPick(i);
    setDrawing(false);
    timers.after(cursorMs, () => setDrawing(true));
    timers.after(cursorMs + drawMs, () => {
      const next = { ...r, edges, cash };
      if (decided(parts, edges.length, r.E)) return finish(next, outcomeOf(parts, edges.length, r.E), cash);
      setRound(next);
      setPick(null);
      setDrawing(false);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: p });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { side, n, E: budgetOf(n, spare), stake: bet.value, prize: prizeFor(side, n, spare), edges: [], cash: RTP, outcome: null };
    setRound(r);
    place(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setPick(null);
    setDrawing(false);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (live) return;
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? place(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const s = round?.side ?? side;
  const nn = round?.n ?? n;
  const E = round?.E ?? budgetOf(n, spare);
  const edges = round?.edges ?? [];
  // While an edge is being placed, the strip still shows the pairs it was drawn from.
  const open = openPairList(nn, edges);
  const parts = partsOf(nn, edges);
  const m = edges.length;
  const pNow = winChance(s, parts, m, E);
  const merge = parts.length > 1 ? mergeChance(parts, m) : 0;
  const cross = open.filter((p) => p.cross).length;
  const prize = round?.prize ?? prizeFor(side, n, spare);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const p0 = startChance(side, n, spare);
  const k = parts.length;

  let status = `Ready · ${SIDE_NAME[side]} with ${budgetOf(n, spare)} edges on ${n} nodes`;
  if (phase === 'placing') status = `Placing edge ${m + 1} of ${E}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${m} of ${E} edges, ${plural(k, 'group')}`;
  if (phase === 'over' && round?.outcome) status = `${TITLE[s][round.outcome]} · ${plural(m, 'edge')}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const nextLabel =
    s === 'connect'
      ? `Add edge · ${fmtChance(merge)} joins`
      : k === 2
        ? `Add edge · ${fmtChance(1 - merge)} stays split`
        : `Add edge · ${fmtChance(merge)} joins`;

  return (
    <GameLayout
      name="Connect"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={volatilityOf(side, n, spare)} />}>Back</Label>
          <Chips
            label="Back"
            options={SIDES.map((v) => ({ value: v, label: SIDE_NAME[v] }))}
            value={side}
            disabled={live}
            onChange={(v) => change(() => setSide(v))}
          />

          <Label hint="on a circle">Nodes</Label>
          <Chips
            label="Nodes"
            options={NODES.map((v) => ({ value: v, label: v }))}
            value={n}
            disabled={live}
            onChange={(v) =>
              change(() => {
                setN(v);
                setSpare((x) => clampSpare(v, x));
              })
            }
          />

          <Label hint={`a tree is ${n - 1}`}>Edge budget</Label>
          <Chips
            label="Edge budget"
            wrap
            options={SPARES.map((x) => ({
              value: x,
              label: budgetOf(n, x),
              disabled: !offered(n, x),
              title: offered(n, x) ? `${n - 1} + ${x} spare` : 'Not offered: one side would have under 1%',
            }))}
            value={spare}
            disabled={live}
            onChange={(v) => change(() => setSpare(v))}
          />
          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(p0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(side, n, spare))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && place(round)}>
                {nextLabel}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'placing' ? 'Placing…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            label: `${SIDE_NAME[s]} chance`,
            value: fmtChance(phase === 'over' && round?.outcome !== 'cashed' ? (round!.cash > 0 ? 1 : 0) : pNow),
            sub: live ? `${plural(E - m, 'edge')} left` : phase === 'over' ? `after ${plural(m, 'edge')}` : `${E} edges, ${nn} nodes`,
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'after each edge', tone: 'cash' },
          { label: `${SIDE_NAME[s]} prize`, value: fmtMult(prize), sub: formatAmount(stake * prize, 2), tone: 'prize' },
        ]}
      />

      <Board className="cx-board">
        <Field side={s} n={nn} E={E} edges={edges} open={open} pick={pick} drawing={drawing} cursorMs={cursorMs} drawMs={drawMs} live={live} />
        {phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={TITLE[round.side][round.outcome]}
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
          label={`Chance the graph ends ${s === 'connect' ? 'connected' : 'split'}`}
          note={
            <>
              The next edge is one of the {open.length} cells on the strip, all equally likely. The {cross} coloured ones join two groups
              {s === 'split' && k === 2 ? ' and would connect the graph' : ''}.
            </>
          }
        />
      ) : (
        <Caption>
          Random edges join {nn} nodes, one open pair at a time. {s === 'connect' ? 'Connected' : 'Split'} wins if after {E} edges the graph is{' '}
          {s === 'connect' ? 'one piece' : 'still in pieces'}: {fmtChance(p0)} for these settings. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Connect" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Nodes sit on a circle with no links. Random edges are added one at a time until the edge budget is spent. Back <b>Connected</b> (every node can
              reach every other by the end) or <b>Split</b> (the graph is still in two or more pieces).
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a side, the number of nodes and the edge budget, then bet. The first edge is placed at once.</li>
              <li>After each edge you can cash out (C), or add the next edge (Space).</li>
              <li>
                The round ends by itself as soon as the result is settled: the graph connects, the budget runs out, or the remaining edges can no longer
                change the result.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Each faint line on the circle, and each cell on the strip below it, is a pair not yet joined. The next edge is one of them, all equally likely.
              The coloured cells (<b style={{ color: 'var(--green)' }}>green</b> when you back Connected, <b style={{ color: 'var(--red)' }}>red</b> when you
              back Split) join two different groups. The grey ones fall inside a group and only use up budget. Their share of the strip is the literal chance
              that the next edge merges two groups.
            </p>
            <p>The pips count the budget. To connect, k groups need k − 1 more merges, so the graph can only join up while that fits in the edges left.</p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              This is the Erdős–Rényi random graph process. With m edges placed and groups of sizes s₁, s₂, …, there are C(n, 2) − m open pairs, and
              Σ<sub>i&lt;j</sub> s<sub>i</sub>·s<sub>j</sub> of them join groups i and j. So the next edge merges groups i and j with chance s<sub>i</sub>s
              <sub>j</sub> / (C(n, 2) − m), and the state (group sizes, edges placed) is a small Markov chain. Your chance is computed exactly by dynamic
              programming over it, never by simulation.
            </p>
            <p>
              With a budget of exactly n − 1 edges you win Connected only if the edges form a spanning tree. By Cayley's formula there are n<sup>n−2</sup>{' '}
              of them, so the chance is n<sup>n−2</sup> / C(C(n, 2), n − 1): about 43% for 6 nodes and 11% for 10.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is locked when you bet, at {(RTP * 100).toFixed(0)}% ÷ (chance for your settings). Cashing out pays prize × your chance now. Your
              chance now is exactly the average of your chances after each possible next edge, so every edge is a fair bet, and by optional stopping the round
              is worth {(RTP * 100).toFixed(0)}% of your stake whenever you cash out. The side and budget only trade chance for prize. Budgets are offered
              while both sides keep at least a 1% chance, so the largest prize is about 91×.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
