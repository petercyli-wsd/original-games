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
import { Chain, Graph } from './Board';
import {
  BETS,
  EDGES,
  NODES,
  RTP,
  cashOut,
  decided,
  drawPair,
  nextK,
  prize,
  states,
  volatilityOf,
  winChance,
  type Bet,
  type Edges,
  type Nodes,
  type Settings,
} from './math';

type Phase = 'idle' | 'drawing' | 'checkpoint' | 'over';
type Outcome = 'won' | 'locked' | 'lost' | 'dead' | 'cashed';

interface Round {
  s: Settings;
  stake: number;
  edges: [number, number][];
  degrees: number[];
  k: number;
  cash: number;
  outcome: Outcome | null;
}

const OUTCOME_TITLE: Record<Outcome, string> = {
  won: 'Parity hit',
  locked: 'Locked in',
  lost: 'Wrong parity',
  dead: 'No way back',
  cashed: 'Cashed out',
};

const betOf = (id: Bet) => BETS.find((b) => b.id === id)!;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [nodes, setNodes] = useState<Nodes>(8);
  const [edgeCount, setEdgeCount] = useState<Edges>(5);
  const [backing, setBacking] = useState<Bet>('trail');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [pending, setPending] = useState<[number, number] | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // The edge in flight is decided the moment it starts, so leaving mid-draw
  // settles at its real result, never at the pre-edge value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'drawing' ? resolved.current : round?.cash ?? 0));

  const drawMs = turbo.turbo ? 200 : 750;
  const live = phase === 'drawing' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPending(null);
    setPhase('over');
  }

  function draw(r: Round) {
    const { s } = r;
    const [u, v] = drawPair(s.nodes, rng);
    const k = nextK(r.k, r.degrees[u] % 2 === 1, r.degrees[v] % 2 === 1);
    const left = s.edges - r.edges.length - 1;
    const end = decided(s.nodes, s.bet, k, left);
    const cash = end === 'lost' ? 0 : end === 'won' ? prize(s) : cashOut(s, k, left);
    resolved.current = cash;
    setPhase('drawing');
    setPending([u, v]);
    timers.after(drawMs, () => {
      const degrees = r.degrees.map((d, i) => (i === u || i === v ? d + 1 : d));
      const next: Round = { ...r, edges: [...r.edges, [u, v]], degrees, k, cash };
      if (end === 'lost') return finish(next, left === 0 ? 'lost' : 'dead', 0);
      if (end === 'won') return finish(next, left === 0 ? 'won' : 'locked', cash);
      setRound(next);
      setPending(null);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: winChance(s.nodes, s.bet, k, left) });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const s: Settings = { nodes, edges: edgeCount, bet: backing };
    const r: Round = { s, stake: bet.value, edges: [], degrees: new Array<number>(nodes).fill(0), k: 0, cash: RTP, outcome: null };
    setRound(r);
    draw(r);
  }

  function cashOutNow() {
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
      cashOut: cashOutNow,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const chosen: Settings = { nodes, edges: edgeCount, bet: backing };
  const s = round?.s ?? chosen;
  const n = s.nodes;
  const k = round?.k ?? 0;
  const drawn = round?.edges.length ?? 0;
  const left = s.edges - drawn;
  const p = winChance(n, s.bet, k, left);
  const chances = states(n).map((x) => winChance(n, s.bet, x, left));
  const next = left > 0 && phase !== 'over' ? states(n).map((x) => winChance(n, s.bet, x, left - 1)) : null;
  const full = prize(s);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const b = betOf(s.bet);
  const chosenChance = winChance(nodes, backing, 0, edgeCount);
  const lost = phase === 'over' && round?.cash === 0;

  let status = `Ready · ${s.edges} edges on ${n} nodes`;
  if (phase === 'drawing') status = `Drawing edge ${drawn + 1} of ${s.edges}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${k} odd · ${left} edge${left === 1 ? '' : 's'} left`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${k} odd after ${drawn} edges`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Euler"
      accent="#fcbf49"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={volatilityOf(chosen)} />}>Back the odd count</Label>
          <Chips
            label="Back the odd count"
            options={BETS.map((x) => ({ value: x.id, label: x.label, title: x.name }))}
            value={backing}
            disabled={live}
            onChange={(v) => change(() => setBacking(v))}
          />

          <Label hint="more nodes, more ways to be odd">Nodes</Label>
          <Chips
            label="Nodes"
            options={NODES.map((v) => ({ value: v, label: v }))}
            value={nodes}
            disabled={live}
            onChange={(v) => change(() => setNodes(v))}
          />

          <Label hint="random pairs, repeats allowed">Edges</Label>
          <Chips
            label="Edges"
            options={EDGES.map((v) => ({ value: v, label: v }))}
            value={edgeCount}
            disabled={live}
            onChange={(v) => change(() => setEdgeCount(v))}
          />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(chosenChance)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prize(chosen))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOutNow}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && draw(round)}>
                Draw edge · {left} left
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
          { label: 'Win chance', value: fmtChance(p), sub: live || phase === 'over' ? `${k} odd now` : `${b.label} after ${s.edges} edges`, tone: 'chance' },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: formatAmount(stake * cash, 2), tone: 'cash' },
          { label: 'Prize', value: fmtMult(full), sub: `if it ends ${b.label}`, tone: 'prize' },
        ]}
      />

      <Board>
        <div className="eu-board">
          <Graph n={n} edges={round?.edges ?? []} degrees={round?.degrees ?? new Array<number>(n).fill(0)} pending={pending} drawMs={drawMs} lost={lost} />
          <Chain n={n} bet={s.bet} k={k} left={left} chances={chances} next={next} />
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
            placement="bottom"
          />
        )}
      </Board>

      {live ? (
        <ChanceBar p={p} label={`Ends with ${b.label}`} note="Glowing nodes have odd degree. An edge flips both its ends." />
      ) : (
        <Caption>
          Each edge joins a random pair and flips the parity of both ends. Back {b.rule} after {s.edges} edges on {n} nodes: {fmtChance(winChance(n, s.bet, 0, s.edges))}. RTP{' '}
          {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Euler" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Random edges join pairs of nodes, repeats allowed. When the edges run out, count the nodes of odd degree. Win if the count lands in the zone you
              backed: 0 odd (every degree even), at most 2 odd, or 4 or more odd.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick what to back, the number of nodes and the number of edges, then bet. The first edge is drawn straight away.</li>
              <li>After each edge you can cash out, or draw the next edge (Space).</li>
              <li>The round ends when the edges run out, or earlier once the result is certain either way.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Glowing nodes have odd degree; the number inside is the degree. On the right, each slot is an odd count k, and its bar is the exact chance of
              winning from that count with the edges left. Your slot is gold. Green slots are the win zone.
            </p>
            <p>
              The <b>next edge</b> bar splits every possible pair by what it does to k: two odd ends take k down by 2, one odd end leaves it, two even ends add 2.
              Green parts raise your cash-out, red parts lower it.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Handshake lemma: degrees add up to twice the edges, so the odd count k is always even. An edge flips both ends, so k is a Markov chain: with
              C(n,2) pairs, it falls by 2 with chance C(k,2)/C(n,2), stays with chance k(n−k)/C(n,2), and rises by 2 with chance C(n−k,2)/C(n,2).
            </p>
            <p>
              Closed form (Fourier on the cube): P(all even after T edges) = 2<sup>−n</sup> Σ<sub>j</sub> C(n,j)·λ<sub>j</sub>
              <sup>T</sup> with λ<sub>j</sub> = 1 − 2j(n−j)/C(n,2), which tends to 1/2<sup>n−1</sup>. Euler's theorem is why the zones matter: a connected
              graph has an Euler circuit exactly when no degree is odd, and an Euler trail when at most two are.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays the prize, {(RTP * 100).toFixed(0)}% divided by the starting chance. Cashing out pays the prize times the current chance. That value
              is the average of what the next edge can lead to, so every edge is a fair bet and the round is worth {(RTP * 100).toFixed(0)}% of your stake
              however and whenever you cash out.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
