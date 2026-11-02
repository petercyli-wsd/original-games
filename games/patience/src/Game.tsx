import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  BetField,
  Board,
  Caption,
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
  DEFAULT_K,
  K_OPTIONS,
  MAX_MULTIPLIER,
  N,
  RTP,
  cashValue,
  decided,
  ended,
  finalCounts,
  landing,
  newDeal,
  newPileCards,
  place,
  prizeFor,
  startChance,
  topsOf,
  volatilityOf,
  winChance,
  type Deal,
} from './math';

const ACCENT = '#90be6d';

type Phase = 'idle' | 'dealing' | 'checkpoint' | 'over';
type Outcome = 'bust' | 'fit' | 'cashed';

interface Round {
  k: number;
  stake: number;
  deal: Deal;
  cash: number;
  outcome: Outcome | null;
  /** The result became certain: the rest is dealt for show. */
  sealed: 'won' | 'lost' | null;
  last: number | null;
}

const plural = (x: number, w: string) => `${x} ${w}${x === 1 ? '' : 's'}`;

function outcomeTitle(r: Round): string {
  switch (r.outcome) {
    case 'bust':
      return `Card ${r.last} opened pile ${r.k + 1}`;
    case 'fit':
      return `All ${N} cards fit in ${plural(r.deal.piles.length, 'pile')}`;
    default:
      return 'Cashed out';
  }
}

/**
 * What the last card did: opened a pile, or dropped onto one. A card that
 * covers the last pile's top lowers it, so the red new-pile band grows down to
 * the card: the deck cards it swallows are why a safe card can cut the chance.
 */
function lastMove(d: Deal, card: number | null): string {
  if (card == null) return '';
  const j = d.piles.findIndex((p) => p[p.length - 1] === card);
  if (j < 0) return '';
  const pile = d.piles[j];
  if (pile.length === 1) return `Card ${card} opened pile ${j + 1}`;
  const was = pile[pile.length - 2];
  const grew = j === d.piles.length - 1 ? d.remaining.filter((c) => c > card && c < was).length : 0;
  return `Card ${card} → pile ${j + 1}` + (grew ? ` · ${plural(grew, 'more card')} turn red` : '');
}

/** Why a settled round can no longer change, shown while the rest is dealt. */
function sealNote(k: number, d: Deal, sealed: 'won' | 'lost'): string {
  if (sealed === 'won') return `No order of the cards left can open pile ${k + 1}: the win is locked in. Dealing out the rest.`;
  const lit = newPileCards(d);
  return lit.length && d.piles.length >= k
    ? `Card ${lit[lit.length - 1]} is higher than every pile top, and the tops only drop, so pile ${k + 1} must open. Dealing out the rest.`
    : `No order of the cards left fits in ${k} piles. Dealing out the rest.`;
}

/** Exact mean pile count for a fresh deck. */
function meanPiles(): number {
  const counts = finalCounts(newDeal());
  const total = counts.reduce((a, c) => a + c, 0);
  return counts.reduce((a, c, f) => a + f * c, 0) / total;
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [k, setK] = useState<number>(DEFAULT_K);
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
    const sealed = r.sealed ?? decided(r.k, next);
    const cash = sealed === 'won' ? prizeFor(r.k) : sealed === 'lost' ? 0 : cashValue(r.k, next);
    resolved.current = cash;
    const ms = all || r.sealed ? fastMs : dealMs;
    setPhase('dealing');
    setMoving({ card, pile, ms, key: ++moveKey.current });
    timers.after(ms, () => {
      const cur: Round = { ...r, deal: next, cash, sealed, last: card };
      setMoving(null);
      if (ended(r.k, next)) return finish(cur, next.piles.length > r.k ? 'bust' : 'fit', cash);
      setRound(cur);
      if (sealed || all) return timers.after(sealed && !r.sealed ? sealMs : gapMs, () => deal(cur, all));
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: winChance(r.k, next) });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { k, stake: bet.value, deal: newDeal(), cash: RTP, outcome: null, sealed: null, last: null };
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

  // Changing the setting after a round clears the finished board to a preview.
  const pickK = (v: number) => {
    setK(v);
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' ? next(false) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the setting.
  const bk = round?.k ?? k;
  const preview = useMemo(() => newDeal(), []);
  const d = round?.deal ?? preview;
  const p = winChance(bk, d);
  const p0 = startChance(bk);
  const prize = prizeFor(bk);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const lit = newPileCards(d).length;
  const left = d.remaining.length;
  // One headline chance: the live chance, the setting's chance in idle, and the result once over.
  const shownP = phase === 'idle' ? p0 : phase === 'over' ? (round?.outcome === 'cashed' ? null : round && round.cash > 0 ? 1 : 0) : p;
  const dealt = N - left;
  const piles = d.piles.length;
  const chance0 = startChance(k);
  const busy = phase === 'dealing';
  const sealed = live ? (round?.sealed ?? null) : null;

  let status = `Ready · at most ${k} piles`;
  if (phase === 'dealing')
    status = sealed
      ? sealed === 'won'
        ? 'Win locked in · dealing out'
        : 'Bust is certain · dealing out'
      : `${auto ? 'Dealing all' : 'Dealing'} · card ${dealt + 1} of ${N}`;
  if (phase === 'checkpoint') status = `${lastMove(d, round?.last ?? null)} · ${left} left`;
  if (phase === 'over' && round?.outcome) status = outcomeTitle(round);
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : sealed ? (sealed === 'won' ? 'won' : 'lost') : live ? 'live' : 'idle';

  const room = bk - piles;
  const liveNote =
    room === 0
      ? `All ${bk} piles are open, so a red card now busts. Each card that drops onto pile ${bk} lowers its top and turns more deck cards red.`
      : `${lit} of ${left} cards left are red: they are above every top and would open pile ${piles + 1}. ${plural(room, 'more pile')} allowed.`;
  const note = sealed && round ? sealNote(bk, d, sealed) : liveNote;

  return (
    <GameLayout
      name="Patience"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={volatilityOf(k)} />}>Piles allowed</Label>
          <Chips
            label="Piles allowed"
            options={K_OPTIONS.map((v) => ({
              value: v,
              label: v,
              title: `Win if all ${N} cards fit in ${v} piles · ${fmtChance(startChance(v))}`,
            }))}
            value={k}
            disabled={live}
            onChange={pickK}
          />
          <dl className="og-stats">
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
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
            value: shownP == null ? '—' : fmtChance(shownP),
            sub:
              shownP == null ? (
                'cashed out'
              ) : (
                <span className="pat-meter" title="The green length is the chance to win">
                  <i style={{ width: `${shownP * 100}%` }} />
                </span>
              ),
            tone: 'chance',
          },
          {
            label: 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'after the first card',
            tone: 'cash',
          },
          { label: 'Full prize', value: fmtMult(prize), sub: `if all ${N} fit in ${bk} piles`, tone: 'prize' },
        ]}
      />

      <Board className="pat-board">
        <Field
          k={bk}
          deal={d}
          showZone={live}
          moving={moving}
          last={round?.last ?? null}
          bustCard={phase === 'over' && round?.outcome === 'bust' ? round.last : null}
        />
        <ul className="pat-rule" aria-label="Rule">
          <li>
            <i className="sw band" aria-hidden="true" />
            <b>Each card</b> drops onto the first pile it fits under
          </li>
          <li>
            <i className="sw zone" aria-hidden="true" />
            <b>Higher than every pile</b> → opens a new pile
          </li>
          <li>
            <b className="win">Win</b> if no more than {bk} piles open
          </li>
        </ul>
        {phase === 'over' && round?.outcome && (
          // Inline under the grid, so the final piles stay in view.
          <RoundOver
            key={history[0]?.id}
            title={outcomeTitle(round)}
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
        <Caption>{note}</Caption>
      ) : (
        <Caption>
          {N} shuffled cards fit in {k} piles {fmtChance(chance0)} of the time, for a prize of {fmtMult(RTP / chance0)}. RTP{' '}
          {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Patience" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Cards 1 to {N} are shuffled and dealt one at a time onto piles. Win if all {N} fit in at most <b>{k} piles</b>. The round is lost the
              moment pile {k + 1} opens.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many piles are allowed, then bet. The first card is dealt at once.</li>
              <li>
                Each card <b>drops onto the first pile it fits under</b> (the first pile whose top card is higher). A card higher than every pile{' '}
                <b>opens a new pile</b> on the right. Piles never close.
              </li>
              <li>After each card, cash out (C) or deal the next one (Space). Deal all plays the rest without stopping.</li>
              <li>
                If pile {k + 1} (the red column) opens, you lose. If every card fits, you win the full prize. Once no order of the cards left can
                change the result, the round settles and the rest is dealt quickly for show.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Rows are card values, highest at the top, and the strip on the left is the deck: filled slots are cards still to come. Each card
              slides along its own row to its pile.
            </p>
            <p>
              Under each pile's top hangs a <b style={{ color: 'var(--accent)' }}>green band</b>: the values that pile catches (lower than its top,
              higher than the pile before). Above the last top is the <b style={{ color: 'var(--red)' }}>red band</b> in the next column: cards
              there open a new pile. The bands cover every row once, so each card drops into the band on its own row.
            </p>
            <p>
              Deck cards in the red band are <b style={{ color: 'var(--red)' }}>red</b> and counted beside the deck; that count over the cards left
              is the chance the next card opens a pile. A card that drops onto the last pile lowers its top, so the red band grows down to it and
              more deck cards turn red. That is why a card that lands safely can still cut your chance.
            </p>
            <p>
              The red band only grows until a new pile opens, so if even one red card is left, another pile is certain. With all {k} piles open, a
              red card means the bust is certain. The headline and its bar are your exact chance to win from here.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Patience sorting makes exactly as many piles as the <b>longest increasing subsequence</b> of the shuffle (Hammersley; Aldous and
              Diaconis). By the Robinson–Schensted correspondence, the number of shuffles of n cards whose longest increasing subsequence is ℓ is Σ f
              <sub>λ</sub>² over shapes λ with first row ℓ, where f<sub>λ</sub> comes from the hook length formula. At most 2 piles happens
              Catalan(n)/n! of the time. {N} cards make {meanPiles().toFixed(2)} piles on average.
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
              {(RTP * 100).toFixed(0)}% of your stake however and whenever you cash out. The largest prize on offer is {fmtMult(MAX_MULTIPLIER)} (at
              most 2 piles).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
