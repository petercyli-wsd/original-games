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
import Field, { type Moving } from './Board';
import {
  DECKS,
  DEFAULT_BET,
  MAX_MULTIPLIER,
  RTP,
  cashValue,
  clampK,
  decided,
  ended,
  finalCounts,
  forecast,
  ghosts,
  kOptions,
  landing,
  newDeal,
  newPileCards,
  risingRun,
  place,
  prizeFor,
  startChance,
  topsOf,
  volatilityOf,
  winChance,
  type Bet,
  type Deal,
  type Deck,
  type Mode,
} from './math';

const ACCENT = '#90be6d';

type Phase = 'idle' | 'dealing' | 'checkpoint' | 'over';
type Outcome = 'bust' | 'fit' | 'reached' | 'short' | 'cashed';

interface Round {
  bet: Bet;
  stake: number;
  deal: Deal;
  cash: number;
  outcome: Outcome | null;
  /** The result became certain: the rest is dealt for show. */
  sealed: 'won' | 'lost' | null;
  last: number | null;
}

function outcomeTitle(o: Outcome, bet: Bet): string {
  switch (o) {
    case 'bust':
      return `Pile ${bet.k + 1} opened`;
    case 'fit':
      return `Fits in ${bet.k} piles`;
    case 'reached':
      return `Pile ${bet.k} opened`;
    case 'short':
      return `Stopped short of ${bet.k}`;
    case 'cashed':
      return 'Cashed out';
  }
}

const outcomeOf = (bet: Bet, d: Deal): Outcome =>
  bet.mode === 'fit' ? (d.piles.length > bet.k ? 'bust' : 'fit') : d.piles.length >= bet.k ? 'reached' : 'short';

/** Why a settled round can no longer change, shown while the rest is dealt. */
function sealNote(b: Bet, d: Deal, sealed: 'won' | 'lost'): string {
  const lit = newPileCards(d);
  const top = lit[lit.length - 1];
  if (b.mode === 'fit') {
    if (sealed === 'won') return `No order of the cards left can open pile ${b.k + 1}: the win is locked in. Dealing out the rest.`;
    return lit.length && d.piles.length >= b.k
      ? `Card ${top} is above the top shelf and the shelf can only drop, so pile ${b.k + 1} must open. Dealing out the rest.`
      : `No order of the cards left fits in ${b.k} piles. Dealing out the rest.`;
  }
  if (sealed === 'lost') return `No order of the cards left can open pile ${b.k}. Dealing out the rest.`;
  return lit.length && d.piles.length >= b.k - 1
    ? `Card ${top} is above the top shelf and the shelf can only drop, so pile ${b.k} must open: the win is locked in.`
    : `Pile ${b.k} opens whatever the order: the win is locked in.`;
}

/** Exact mean pile count for a fresh deck of n cards. */
function meanPiles(n: number): number {
  const counts = finalCounts(newDeal(n));
  const total = counts.reduce((a, c) => a + c, 0);
  return counts.reduce((a, c, f) => a + f * c, 0) / total;
}

const betText = (b: Bet) => `${b.mode === 'fit' ? 'at most' : 'at least'} ${b.k} piles`;
const plural = (x: number, w: string) => `${x} ${w}${x === 1 ? '' : 's'}`;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [n, setN] = useState<Deck>(DEFAULT_BET.n);
  const [mode, setMode] = useState<Mode>(DEFAULT_BET.mode);
  const [k, setK] = useState(DEFAULT_BET.k);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [moving, setMoving] = useState<Moving | null>(null);
  const [auto, setAuto] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const moveKey = useRef(0);

  // A card's result is decided the moment it is drawn, so leaving mid-slide
  // settles at its real result, never at the pre-card value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'dealing' ? resolved.current : (round?.cash ?? 0)));

  const live = phase === 'dealing' || phase === 'checkpoint';
  const dealMs = turbo.turbo ? 150 : 560;
  const fastMs = turbo.turbo ? 80 : 260;
  const gapMs = turbo.turbo ? 30 : 110;
  const sealMs = turbo.turbo ? 160 : 520;

  const settings: Bet = { n, mode, k };

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setMoving(null);
    setAuto(false);
    setPhase('over');
  }

  /** Draws the next card, slides it to its pile, then pauses or carries on. */
  function deal(r: Round, all: boolean) {
    const d = r.deal;
    const card = d.remaining[rng.int(d.remaining.length)];
    const pile = landing(topsOf(d), card);
    const next = place(d, card);
    const sealed = r.sealed ?? decided(r.bet, next);
    const cash = sealed === 'won' ? prizeFor(r.bet) : sealed === 'lost' ? 0 : cashValue(r.bet, next);
    resolved.current = cash;
    const ms = all || r.sealed ? fastMs : dealMs;
    setPhase('dealing');
    setMoving({ card, pile, ms, key: ++moveKey.current });
    timers.after(ms, () => {
      const cur: Round = { ...r, deal: next, cash, sealed, last: card };
      setMoving(null);
      if (ended(r.bet, next)) return finish(cur, outcomeOf(r.bet, next), cash);
      setRound(cur);
      if (sealed || all) return timers.after(sealed && !r.sealed ? sealMs : gapMs, () => deal(cur, all));
      setPhase('checkpoint');
      track({
        type: 'checkpoint',
        multiplier: cash,
        winChance: winChance(r.bet, next),
      });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = {
      bet: settings,
      stake: bet.value,
      deal: newDeal(n),
      cash: RTP,
      outcome: null,
      sealed: null,
      last: null,
    };
    setRound(r);
    setAuto(false);
    deal(r, false);
  }

  function next(all: boolean) {
    if (phase !== 'checkpoint' || !round) return;
    setAuto(all);
    deal(round, all);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setMoving(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };
  const pickDeck = (v: Deck) => change(() => (setN(v), setK(clampK(v, mode, k))));
  const pickMode = (m: Mode) => change(() => (setMode(m), setK(clampK(n, m, k))));

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' ? next(false) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const b = round?.bet ?? settings;
  const preview = useMemo(() => newDeal(n), [n]);
  const d = round?.deal ?? preview;
  const p = winChance(b, d);
  const p0 = startChance(b);
  const prize = prizeFor(b);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const showOdds = phase === 'idle' || phase === 'checkpoint';
  const rings = useMemo(() => (showOdds ? ghosts(b, d) : null), [showOdds, b.n, b.mode, b.k, d]);
  const bars = forecast(b, d);
  const lit = newPileCards(d).length;
  const left = d.remaining.length;
  const dealt = b.n - left;
  const vol = volatilityOf(settings);
  const chance0 = startChance(settings);
  const busy = phase === 'dealing';

  let status = `Ready · ${n} cards · ${betText(settings)}`;
  if (phase === 'dealing')
    status = round?.sealed
      ? round.sealed === 'won'
        ? 'Win locked in · dealing out'
        : 'No way back · dealing out'
      : auto
        ? `Dealing all · card ${dealt + 1} of ${b.n}`
        : `Dealing card ${dealt + 1} of ${b.n}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${plural(d.piles.length, 'pile')} · ${plural(left, 'card')} left`;
  if (phase === 'over' && round?.outcome) status = `${outcomeTitle(round.outcome, b)} · ${plural(d.piles.length, 'pile')}`;
  const sealed = live ? (round?.sealed ?? null) : null;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : sealed ? (sealed === 'won' ? 'won' : 'lost') : live ? 'live' : 'idle';

  const finalCard =
    phase === 'over' && round?.last && (round.outcome === 'bust' || round.outcome === 'reached')
      ? {
          card: round.last,
          tone: round.outcome === 'bust' ? ('lose' as const) : ('win' as const),
        }
      : null;

  const prizeSub = b.mode === 'fit' ? `if it ends in ≤ ${b.k} piles` : `when pile ${b.k} opens`;
  const nextNote =
    b.mode === 'fit'
      ? `${lit} of ${left} cards left would open a new pile (they sit above the dashed top shelf). Pile ${b.k + 1} loses.`
      : `${lit} of ${left} cards left would open a new pile (they sit above the dashed top shelf). Pile ${b.k} wins.`;
  const note = sealed ? sealNote(b, d, sealed) : nextNote;

  return (
    <GameLayout
      name="Patience"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint="more cards, longer rounds">Cards in the deck</Label>
          <Chips label="Cards in the deck" options={DECKS.map((v) => ({ value: v, label: v }))} value={n} disabled={live} onChange={pickDeck} />

          <Label hint={<VolBadge level={vol} />}>Finish with</Label>
          <Chips
            label="At most or at least"
            options={[
              {
                value: 'fit',
                label: 'At most',
                title: 'Win if the deal ends with at most this many piles',
              },
              {
                value: 'reach',
                label: 'At least',
                title: 'Win as soon as this many piles are open',
              },
            ]}
            value={mode}
            disabled={live}
            onChange={(m) => pickMode(m as Mode)}
          />
          <Chips
            label="Number of piles"
            options={kOptions(n, mode).map((v) => ({
              value: v,
              label: v,
              title: `${mode === 'fit' ? 'At most' : 'At least'} ${v} piles · ${fmtChance(startChance({ n, mode, k: v }))}`,
            }))}
            value={k}
            disabled={live}
            onChange={(v) => change(() => setK(v))}
          />
          <dl className="og-stats">
            <dt>Piles</dt>
            <dd>{mode === 'fit' ? `≤ ${k}` : `≥ ${k}`}</dd>
            <dt>Chance to win</dt>
            <dd>{fmtChance(chance0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(RTP / chance0)}</dd>
          </dl>

          {live ? (
            <>
              <ActionButton kind="cash" disabled={busy} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                }}
              >
                <ActionButton kind="secondary" disabled={busy} onClick={() => next(false)} title="Deal the next card (Space)">
                  Deal next
                </ActionButton>
                <ActionButton kind="secondary" disabled={busy} onClick={() => next(true)} title="Deal every card left without stopping">
                  Deal all
                </ActionButton>
              </div>
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
            value: fmtChance(phase === 'idle' ? p0 : p),
            sub: live
              ? `next card: ${lit}/${left} open a pile`
              : phase === 'idle'
                ? `${n} shuffled cards`
                : round?.outcome === 'cashed'
                  ? `when cashed, ${plural(left, 'card')} left`
                  : `${plural(d.piles.length, 'pile')} at the end`,
            tone: 'chance',
          },
          {
            label: 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'after the first card',
            tone: 'cash',
          },
          {
            label: 'Full prize',
            value: fmtMult(prize),
            sub: prizeSub,
            tone: 'prize',
          },
        ]}
      />

      <Board className="pat-board">
        <Field
          bet={b}
          deal={d}
          ghosts={rings}
          bars={phase === 'over' ? null : bars}
          run={phase === 'over' ? risingRun(d) : null}
          showZone={showOdds || !!sealed}
          moving={moving}
          last={round?.last ?? null}
          finalCard={finalCard}
          winP={phase === 'idle' ? p0 : p}
        />
        {phase === 'over' && round?.outcome && (
          // Inline under the grid, so the final piles and the rising run stay in view.
          <RoundOver
            key={history[0]?.id}
            title={outcomeTitle(round.outcome, b)}
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

      {phase === 'over' ? null : live ? (
        <ChanceBar p={p} label="Win chance" note={note} />
      ) : (
        <Caption>
          Each card goes on the leftmost pile whose top is higher, else it opens a new pile, so the piles count the longest rising run in the shuffle.{' '}
          {n} cards end with {betText(settings)} {fmtChance(chance0)} of the time. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Patience" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Cards 1 to {n} are shuffled and dealt one at a time into piles by <b>patience sorting</b>. Bet on how many piles there are at the end:{' '}
              <b>at most</b> k, or <b>at least</b> k.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the deck size, at most or at least, and the number of piles, then bet. The first card is dealt at once.</li>
              <li>
                Each card goes on the <b>leftmost pile whose top card is higher</b>. If no top is higher, it opens a new pile on the right. Piles
                never close, and the tops always rise from left to right.
              </li>
              <li>After each card, cash out (C) or deal the next one (Space). Deal all plays the rest without stopping.</li>
              <li>
                <b>At most k:</b> the round is lost the moment pile k+1 opens, and pays the full prize when every card fits. <b>At least k:</b> the
                round pays the moment pile k opens, and is lost if the deck runs out first. Once no order of the cards left can change the result, the
                round settles and the rest is dealt quickly for show.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Rows are card values, highest at the top, and the strip on the left is the deck: lit slots are cards still to come. Each card slides
              along its own row to the pile it lands on.
            </p>
            <p>
              The dashed <b>top shelf</b> is the top card of the rightmost pile. A card above it opens a new pile. Those cards are outlined in the
              deck and counted beside it, and their count over the cards left is the chance the next card opens a pile. If even one card left is above
              the shelf, another pile is certain: the shelf can only drop until that card arrives.
            </p>
            <p>
              Every card left is drawn as a ring where it would land. Its <b style={{ color: 'var(--green)' }}>green slice</b> is your win chance if
              it comes next. The next card is equally likely to be any of them, so the rings average out to your chance now. The bars under the piles
              are the chance the deal ends on each pile; the green bars add up to your win chance.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Patience sorting makes exactly as many piles as the <b>longest increasing subsequence</b> of the shuffle (Hammersley; Aldous and
              Diaconis). By the Robinson–Schensted correspondence, the number of shuffles of n cards whose longest increasing run is ℓ is Σ f
              <sub>λ</sub>² over shapes λ with first row ℓ, where f<sub>λ</sub> comes from the hook length formula. At most 2 piles happens
              Catalan(n)/n! of the time. {n} cards make {meanPiles(n).toFixed(2)} piles on average; for long decks the mean grows like 2√n
              (Vershik–Kerov, Logan–Shepp) and the spread around it follows the Tracy–Widom law (Baik–Deift–Johansson).
            </p>
            <p>
              Live odds are exact: the future depends only on how the pile tops and the cards left interleave by value, and a memoised count over
              those patterns gives, for every final pile count, how many of the orders of the cards left produce it. No simulation is used.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The full prize is {(RTP * 100).toFixed(0)}% ÷ (chance to win at the start). The cash-out at any moment is prize × (chance to win now).
              The chance now is the average of the chances after the next card, so every card is a fair bet and the round is worth{' '}
              {(RTP * 100).toFixed(0)}% of your stake however and whenever you cash out. The largest prize on offer is {fmtMult(MAX_MULTIPLIER)} (12
              cards, at most 2 piles).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
