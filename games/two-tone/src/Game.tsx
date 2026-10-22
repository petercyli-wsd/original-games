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
import { PairGrid, Ring, type Bust, type Pending } from './Board';
import {
  EDGES,
  NODES,
  RTP,
  addEdge,
  afterSafeEdge,
  bipartiteChance,
  edgesAllowed,
  emptyGraph,
  fatalPairs,
  finishChance,
  isFatal,
  maxEdgesFor,
  maxMultiplier,
  oddCycle,
  openPairs,
  risk,
  volatilityOf,
  type Edges,
  type Graph,
  type Nodes,
  type Pair,
} from './math';

const ACCENT = '#cdb4db';

type Phase = 'idle' | 'drawing' | 'checkpoint' | 'over';
type Outcome = 'bust' | 'cashed' | 'full' | 'saturated';

interface Round {
  nodes: Nodes;
  target: Edges;
  stake: number;
  graph: Graph;
  cash: number;
  outcome: Outcome | null;
  bust: Bust | null;
}

const OUTCOME_TITLE: Record<Outcome, string> = {
  bust: 'Odd cycle',
  cashed: 'Cashed out',
  full: 'Still two-toned',
  saturated: 'No safe pair left',
};

/** A few open cells for the picker to flicker over before it lands. Cosmetic, deterministic. */
function scanCells(open: Pair[], pick: Pair, step: number): Pair[] {
  const others = open.filter(([a, b]) => a !== pick[0] || b !== pick[1]);
  if (others.length === 0) return [];
  const out: Pair[] = [];
  for (let k = 0; k < 5; k++) out.push(others[(pick[0] * 7 + pick[1] * 13 + step * 31 + k * 17 + k * k * 5) % others.length]);
  return out;
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [nodes, setNodes] = useState<Nodes>(8);
  const [target, setTarget] = useState<Edges>(8);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // The edge in flight is decided the moment it starts, so leaving mid-draw
  // settles at its real result, never at the safer pre-edge value.
  const resolved = useRef<number>(0);
  const ticket = useTicket(() => (phase === 'drawing' ? resolved.current : round?.cash ?? 0));

  const live = phase === 'drawing' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPending(null);
    setPhase('over');
  }

  function draw(r: Round) {
    const open = openPairs(r.graph);
    const { q } = risk(r.graph);
    const pick = open[rng.int(open.length)];
    const [u, v] = pick;
    const safe = !isFatal(r.graph, u, v);
    const cash = safe ? afterSafeEdge(r.cash, q) : 0;
    resolved.current = cash;
    // Free edges (q = 0) draw quickly and without the picker; risky ones flicker first.
    const ms = q === 0 ? (turbo.turbo ? 110 : 380) : turbo.turbo ? 190 : 760;
    const id = ++seq.current;
    setPending({ id, u, v, safe, ms, scan: q === 0 ? [] : scanCells(open, pick, r.graph.edges.length) });
    setPhase('drawing');
    timers.after(ms, () => {
      if (!safe) return finish({ ...r, bust: { u, v, cycle: oddCycle(r.graph, u, v) } }, 'bust', 0);
      const graph = addEdge(r.graph, u, v);
      const next: Round = { ...r, graph, cash };
      if (graph.edges.length >= r.target) return finish(next, 'full', cash);
      const after = risk(graph);
      if (after.q >= 1) return finish(next, 'saturated', cash);
      setRound(next);
      // Nothing can bust the next edge: keep drawing.
      if (after.q === 0) return draw(next);
      setPending(null);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: finishChance(r.nodes, r.target, graph) });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { nodes, target, stake: bet.value, graph: emptyGraph(nodes), cash: RTP, outcome: null, bust: null };
    setRound(r);
    draw(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setPending(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? draw(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const n = round?.nodes ?? nodes;
  const E = round?.target ?? target;
  const graph = round?.graph ?? emptyGraph(n);
  const m = graph.edges.length;
  const { fatal, open, q } = risk(graph);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const finishNow = round && live ? finishChance(n, E, graph) : finishChance(n, E);
  const theorem = bipartiteChance(n, E);
  const pick = finishChance(nodes, target);
  const vol = volatilityOf(nodes, target);

  let status = `Ready · ${n} nodes, ${E} edges`;
  if (phase === 'drawing') status = `Drawing edge ${m + 1} of ${E}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${m} of ${E} edges`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${m} of ${E} edges`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const mode = phase === 'idle' ? 'idle' : phase === 'over' ? (round?.outcome === 'bust' ? 'bust' : round?.outcome === 'cashed' ? 'cashed' : 'won') : 'live';
  const won = phase === 'over' && (round?.outcome === 'full' || round?.outcome === 'saturated');

  return (
    <GameLayout
      name="Two-Tone"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Nodes</Label>
          <Chips
            label="Nodes on the ring"
            options={NODES.map((v) => ({ value: v, label: v }))}
            value={nodes}
            disabled={live}
            onChange={(v) =>
              change(() => {
                setNodes(v);
                if (!edgesAllowed(v, target)) setTarget(maxEdgesFor(v));
              })
            }
          />

          <Label hint="pays out when placed">Edges to place</Label>
          <Chips
            label="Edges to place"
            options={EDGES.map((v) => ({
              value: v,
              label: v,
              disabled: !edgesAllowed(nodes, v),
              title: edgesAllowed(nodes, v) ? undefined : `Up to ${nodes + 2} edges on ${nodes} nodes`,
            }))}
            value={target}
            disabled={live}
            onChange={(v) => change(() => setTarget(v))}
          />
          <dl className="og-stats">
            <dt>Chance to finish</dt>
            <dd>{fmtChance(pick)}</dd>
            <dt>Average full prize</dt>
            <dd>{fmtMult(RTP / pick)}</dd>
            <dt>Max win</dt>
            <dd>{fmtMult(maxMultiplier(nodes, target))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && draw(round)}>
                Add edge · {fmtChance(1 - q)} safe
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'drawing' ? 'Drawing…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            label: 'Next edge safe',
            value: live ? fmtChance(1 - q) : '—',
            sub: live ? (fatal === 0 ? 'no red pairs' : `${open - fatal} of ${open} pairs green`) : phase === 'over' ? 'round over' : 'first edges are free',
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: formatAmount(stake * cash, 2), tone: 'cash' },
          {
            label: live ? 'If it lands safe' : 'Average full prize',
            value: live ? fmtMult(cash / (1 - q)) : fmtMult(RTP / finishNow),
            sub: live ? `edge ${m + 1} of ${E}` : `${fmtChance(finishNow)} to finish`,
            tone: 'prize',
          },
        ]}
      />

      <Board className="tt-stage">
        <div className="tt-board">
          <Ring graph={graph} fatal={live || round?.outcome === 'cashed' ? fatalPairs(graph) : []} pending={pending} bust={round?.bust ?? null} won={won} />
          <PairGrid graph={graph} pending={pending} bust={round?.bust ?? null} fatal={fatal} open={open} mode={mode} target={E} />
        </div>
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
          p={1 - q}
          label="Next edge lands safe"
          note={`${fatal} red of ${open} open pairs would close an odd cycle. From here you place all ${E} edges ${fmtChance(finishNow)} of the time.`}
        />
      ) : (
        <Caption>
          Place {E} random edges on {n} nodes without closing an odd cycle. A random {E}-edge graph on {n} nodes is two-colourable{' '}
          {fmtChance(theorem)} of the time
          {Math.abs(finishNow - theorem) > 5e-5 ? ` (${fmtChance(finishNow)} to finish, counting the early cash-out when every pair turns red)` : ''}. RTP{' '}
          {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Two-Tone" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Random edges join the nodes on the ring, one at a time. Keep the graph <b>two-toned</b>: every edge must join a light node to a dark one. Place
              the number of edges you chose and the round pays out.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many nodes sit on the ring and how many edges to place, then bet.</li>
              <li>Each new edge joins a uniformly random pair of nodes that aren't joined yet. Edges that can't hurt you are drawn straight away.</li>
              <li>At every checkpoint, cash out (C) or add the next edge (Space).</li>
              <li>An edge between two nodes of the same tone in one cluster closes an odd cycle and the round is lost.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Each cluster of joined nodes is coloured with two tones, light and dark (a lone node has no tone yet). Joining two clusters is always safe: one
              flips its tones if it has to. Inside a cluster, a light–dark edge is safe and a same-tone edge is fatal.
            </p>
            <p>
              The <b>pairs grid</b> has one cell per pair of nodes. Filled cells are edges, <b style={{ color: 'var(--red)' }}>red cells</b> are the fatal
              pairs (also drawn as faint red lines on the ring) and <b style={{ color: 'var(--green)' }}>green cells</b> are safe. The next edge is a random
              unfilled cell, so the chance it busts is exactly red ÷ (red + green).
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              A graph is bipartite (two-colourable) exactly when it has no odd cycle. After E random edges the graph is a uniform random graph G(n, E), so you
              reach E edges with chance B(n, E) / C(N, E), where N = n(n−1)/2 and B(n, E) counts the bipartite graphs with E edges. (On 6 nodes the graph
              can also fill up into a complete bipartite graph first, which pays too; the panel's chance to finish includes it.)
            </p>
            <p>
              B comes from one identity: a connected bipartite graph has exactly two colourings, so in exponential generating functions the bipartite graphs
              are the square root of the two-coloured ones, Σ B<sub>n</sub>(y) xⁿ/n! = √(Σ<sub>n</sub> Σ<sub>k</sub> C(n, k)(1+y)<sup>k(n−k)</sup> xⁿ/n!).
            </p>
            <p>
              With clusters of tone sizes (a<sub>i</sub>, b<sub>i</sub>) the red count is Σ C(a<sub>i</sub>, 2) + C(b<sub>i</sub>, 2) out of N − m open
              pairs. The chance to finish from the current graph depends only on those sizes and the edge count m, so it is computed exactly and shown under
              the safety bar.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Surviving an edge with bust chance q multiplies your cash-out by 1/(1−q), so every edge is a fair bet and the round is worth{' '}
              {(RTP * 100).toFixed(0)}% of your stake however and whenever you cash out. If every open pair turns red before your target (a complete
              bipartite graph), the round cashes out automatically. The largest possible payout with your settings is{' '}
              {fmtMult(maxMultiplier(nodes, target))}, and {fmtMult(maxMultiplier(10, 12))} over all settings.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
