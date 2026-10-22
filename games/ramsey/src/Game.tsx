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
import Field, { PALETTE, type Spin } from './Board';
import {
  BOARDS,
  BOARD_IDS,
  MAX_WIN,
  RTP,
  afterSafePick,
  closers,
  edgeOdds,
  emptyColouring,
  ending,
  graph,
  isOffered,
  landingTurn,
  maxWin,
  randomEdgeSafe,
  type BoardId,
  type EdgeOdds,
  type Ending,
} from './math';

type Phase = 'idle' | 'picking' | 'checkpoint' | 'over';
type Outcome = 'bust' | 'cashed' | Ending;

interface Round {
  board: BoardId;
  stake: number;
  col: number[];
  cash: number;
  picks: number;
  outcome: Outcome | null;
  bust: [number, number, number][] | null;
  fresh: number | null;
}

const ACCENT = '#f15bb5';

function outcomeTitle(outcome: Outcome, id: BoardId) {
  if (outcome === 'bust') return 'One-colour triangle';
  if (outcome === 'cashed') return 'Cashed out';
  if (outcome === 'full') return 'Full board';
  if (outcome === 'cap') return 'Max win';
  return id === 'k6' ? 'Ramsey lock' : 'Board locked';
}

const colourList = (mask: number, colours: number) =>
  PALETTE.slice(0, colours)
    .filter((_, k) => (mask >> k) & 1)
    .map((p) => p.name)
    .join(' or ');

/** "50%" on two colours; "67% / 33%" on three (one or two colours meet across the edge). */
const riskyChance = (c: number) => (c === 2 ? '50%' : '67% / 33%');
const riskyPays = (c: number) => (c === 2 ? '×2' : '×1.5 / ×3');

function theoremLine(id: BoardId) {
  if (id === 'k4') return 'Only 18 of the 64 colourings of K4 avoid one.';
  if (id === 'k5') return 'K5 is the largest board two colours can fill: 12 of 1,024 colourings (pentagon + pentagram) avoid one.';
  if (id === 'k6') return 'Ramsey: R(3,3) = 6, so this board always locks before it fills.';
  return `With three colours R(3,3,3) = 17, so the ×${MAX_WIN.toLocaleString('en-US')} cap ends the round first.`;
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [boardId, setBoardId] = useState<BoardId>('k6');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [spin, setSpin] = useState<Spin | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const spinSeq = useRef(0);

  // The colour of the edge in flight is drawn the moment the pick starts, so
  // leaving mid-spin settles at its real result, never the pre-pick value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'picking' ? resolved.current : round?.cash ?? 0));

  const spinMs = turbo.turbo ? 200 : 780;
  const drawMs = turbo.turbo ? 70 : 260;
  const live = phase === 'picking' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setSpin(null);
    setHover(null);
    setPhase('over');
  }

  function pick(r: Round, edge: number) {
    const spec = BOARDS[r.board];
    const odds = edgeOdds(spec, r.col, r.cash)[edge];
    if (!isOffered(odds)) return;
    const colour = rng.int(spec.colours);
    const safe = !((odds.mask >> colour) & 1);
    const cash = safe ? afterSafePick(r.cash, odds.q) : 0;
    resolved.current = cash;
    setPhase('picking');
    setHover(null);
    setSpin({ id: ++spinSeq.current, edge, turn: 2 + landingTurn(spec.colours, colour, rng.next()) });
    timers.after(spinMs, () => {
      const col = r.col.slice();
      col[edge] = colour;
      const next: Round = { ...r, col, cash, picks: r.picks + 1, fresh: edge };
      if (!safe) {
        const g = graph(spec.n);
        const [u, v] = g.edges[edge];
        const bust = closers(g, r.col, edge, colour).map((w) => [u, v, w] as [number, number, number]);
        return finish({ ...next, bust }, 'bust', 0);
      }
      const end = ending(spec, col, cash);
      if (end) return finish(next, end, cash);
      setRound(next);
      setSpin(null);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: randomEdgeSafe(edgeOdds(spec, col, cash)) });
    });
  }

  function pickRandom(r: Round) {
    const offered = edgeOdds(BOARDS[r.board], r.col, r.cash).filter(isOffered);
    if (offered.length) pick(r, offered[rng.int(offered.length)].edge);
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { board: boardId, stake: bet.value, col: emptyColouring(BOARDS[boardId].n), cash: RTP, picks: 0, outcome: null, bust: null, fresh: null };
    setRound(r);
    // The first edge is always free (no triangle can close), so it is coloured for you.
    pickRandom(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setSpin(null);
    setHover(null);
    setPhase('idle');
  }

  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? pickRandom(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const id = round?.board ?? boardId;
  const spec = BOARDS[id];
  const g = graph(spec.n);
  const col = round?.col ?? emptyColouring(spec.n);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const odds: EdgeOdds[] = edgeOdds(spec, col, phase === 'over' ? Math.min(cash, MAX_WIN) : cash);
  const coloured = col.filter((x) => x >= 0).length;
  const total = g.edges.length;
  const focus = spin?.edge ?? (phase === 'checkpoint' ? hover : null);
  const focusOdds = focus !== null ? odds[focus] : null;
  const offered = odds.filter(isOffered);
  const randomSafe = randomEdgeSafe(odds);
  const riskiest = offered.reduce<EdgeOdds | null>((best, o) => (o.q > 0 && (!best || o.q > best.q) ? o : best), null);
  const counts = {
    free: odds.filter((o) => o.state === 'free').length,
    risky: odds.filter((o) => o.state === 'risky').length,
    locked: odds.filter((o) => o.state === 'locked' || o.state === 'capped').length,
  };
  const sel = BOARDS[boardId];

  let status = `Ready · K${spec.n} · ${total} edges · ${spec.colours} colours`;
  if (phase === 'picking') status = `Colouring edge ${coloured + 1} of ${total}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${coloured} of ${total} edges`;
  if (phase === 'over' && round?.outcome) status = `${outcomeTitle(round.outcome, id)} · ${coloured} edges`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  // Readouts: the inspected edge if there is one, else the Random edge button.
  let chance = { label: 'Risky edge safe', value: riskyChance(spec.colours), sub: spec.colours === 2 ? '1 of 2 colours closes it' : 'one or two of 3 colours close it' };
  let prize = { label: 'Max win', value: fmtMult(maxWin(spec)), sub: spec.maxRisky ? `${spec.maxRisky} risky edges, then it locks` : 'max-win cap' };
  if (live && focusOdds) {
    const o = focusOdds;
    chance = {
      label: 'This edge safe',
      value: fmtChance(1 - o.q),
      sub:
        o.state === 'locked'
          ? 'every colour closes a triangle'
          : o.q === 0
            ? 'free: no triangle can close'
            : `${colourList(o.mask, spec.colours)} closes a triangle`,
    };
    prize =
      o.state === 'locked'
        ? { label: 'If it lands safe', value: '—', sub: 'locked' }
        : { label: 'If it lands safe', value: fmtMult(cash * o.factor), sub: o.q === 0 ? 'free edge: ×1' : `×${+o.factor.toFixed(2)} on this edge` };
  } else if (live) {
    chance = { label: 'Random edge safe', value: fmtChance(randomSafe), sub: `${counts.free} free · ${counts.risky} risky · ${counts.locked} locked` };
    prize = riskiest
      ? { label: 'Riskiest edge pays', value: fmtMult(cash * riskiest.factor), sub: `${fmtChance(1 - riskiest.q)} safe` }
      : { label: 'Free edges only', value: fmtMult(cash), sub: 'colour one to build risk' };
  } else if (phase === 'over') {
    chance = { label: 'Edges coloured', value: `${coloured} / ${total}`, sub: round?.outcome === 'bust' ? 'a triangle closed' : `${counts.locked} locked` };
    prize = { label: 'Max win', value: fmtMult(maxWin(spec)), sub: `K${spec.n}, ${spec.colours} colours` };
  }

  // Keep the closed triangle visible: put the card over whichever half shows fewer of its dots.
  let low = 0;
  let high = 0;
  for (const i of new Set(round?.bust?.flat() ?? [])) {
    const down = -Math.cos((2 * Math.PI * i) / spec.n + (spec.n % 2 === 0 ? Math.PI / spec.n : 0));
    if (down > 0.3) low++;
    if (down < -0.3) high++;
  }
  const placeTop = low > high;

  return (
    <GameLayout
      name="Ramsey"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={sel.level} />}>Board</Label>
          <Chips
            label="Board"
            options={BOARD_IDS.map((b) => ({
              value: b,
              label: (
                <>
                  K<sub>{BOARDS[b].n}</sub>
                </>
              ),
              title: `${BOARDS[b].n} dots, ${BOARDS[b].colours} colours`,
            }))}
            value={boardId}
            disabled={live}
            onChange={(v) => change(() => setBoardId(v))}
          />
          <Label hint={`${(sel.n * (sel.n - 1)) / 2} edges`}>Colours</Label>
          <div className="ramsey-swatches" aria-label={`${sel.colours} colours`}>
            {PALETTE.slice(0, sel.colours).map((p) => (
              <span key={p.name}>
                <i style={{ background: p.hex }} />
                {p.name}
              </span>
            ))}
          </div>

          <dl className="og-stats">
            <dt>Chance per risky edge</dt>
            <dd>{riskyChance(sel.colours)}</dd>
            <dt>Prize per risky edge</dt>
            <dd>{riskyPays(sel.colours)}</dd>
            <dt>Max win</dt>
            <dd>{fmtMult(maxWin(sel))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && pickRandom(round)}>
                Random edge · {fmtChance(randomSafe)} safe
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'picking' ? 'Colouring…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { ...chance, tone: 'chance' },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : `starts at ${fmtMult(RTP)}`, tone: 'cash' },
          { ...prize, tone: 'prize' },
        ]}
      />

      <Board>
        <Field
          n={spec.n}
          colours={spec.colours}
          col={col}
          odds={odds}
          interactive={phase === 'checkpoint'}
          focus={focus}
          onHover={setHover}
          onPick={(edge) => phase === 'checkpoint' && round && pick(round, edge)}
          spin={spin}
          spinMs={spinMs}
          drawMs={drawMs}
          fresh={round?.fresh ?? null}
          bust={round?.bust ?? null}
          over={phase === 'over'}
        />
        {phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={outcomeTitle(round.outcome, id)}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement={placeTop ? 'top' : 'bottom'}
          />
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={focusOdds ? 1 - focusOdds.q : randomSafe}
          label={focusOdds ? (phase === 'picking' ? 'This pick lands safe' : 'This edge lands safe') : 'Random edge lands safe'}
          note="Each disc's red share is the exact chance that edge closes a one-colour triangle. Hover an edge to see which triangle."
        />
      ) : (
        <Caption>
          Colour the {total} edges of K{spec.n} at random from {spec.colours} colours; a one-colour triangle loses. {theoremLine(id)} RTP{' '}
          {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Ramsey" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Every pair of dots on the polygon is joined by an edge. Edges are painted one at a time in random colours. Don't let three edges of one colour form a
              triangle. Each risky edge you survive multiplies your cash-out; take it whenever you like.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a board (dots and colours) and bet. The first edge is painted for you: it is always free.</li>
              <li>Click any open edge, or press Random edge (Space). It is painted one of the colours, each equally likely.</li>
              <li>If that colour closes a one-colour triangle, the round is lost. Otherwise your cash-out grows by the edge's factor.</li>
              <li>Cash out (C) at any checkpoint. When every open edge would close a triangle the board locks and pays out automatically.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Every open edge carries a disc with one slice per colour. A slice turns <b style={{ color: 'var(--red)' }}>red</b> when two edges of that colour
              already meet across the edge, so painting it that colour would close their triangle. The red share of the disc is exactly the chance the edge loses:
              none (free), ½, or with three colours ⅓ and ⅔. An all-red disc is locked and can't be picked. Hover an edge to see the triangles it would close.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Ramsey's theorem, R(3,3) = 6: however you 2-colour the 15 edges of K6, a one-colour triangle appears. So the hexagon can never be filled: an
              exhaustive search shows at most 9 risky edges can be survived before it locks (×{fmtMult(maxWin(BOARDS.k6)).slice(0, -1)}). K5 is the largest
              board two colours can fill, and only as a pentagon plus a pentagram: 12 of the 2<sup>10</sup> colourings. With three colours R(3,3,3) = 17, so
              the octagon could be filled in principle; the ×{MAX_WIN.toLocaleString('en-US')} cap ends it first.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              An edge with risk q pays 1/(1 − q) if it lands safe: ×1 free, ×2 at ½, ×1.5 at ⅓, ×3 at ⅔. Each pick is a fair bet, (1 − q) × V/(1 − q) = V, so
              the cash-out is a martingale that starts at {(RTP * 100).toFixed(0)}%. Which edge you pick and when you stop only change the volatility: every
              strategy returns {(RTP * 100).toFixed(0)}% of the stake. On the octagon an edge whose win would pass ×{MAX_WIN.toLocaleString('en-US')} is
              disabled, and the round pays once no risky edge is left.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
