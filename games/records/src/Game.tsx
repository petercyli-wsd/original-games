import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  BetField,
  Board,
  ACCENTS,
  Caption,
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
  eventMs,
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
import { MAX_MULTIPLIER, N, RTP, TARGETS, clampTarget, countRecords, drawRank, outOfReach, prizeFor, volatilityOf, winChance } from './math';

const ACCENT = ACCENTS.pink;

interface Round {
  id: number;
  k: number;
  stake: number;
  /** Locked at bet time: RTP / P(win). */
  prize: number;
  /** The slot every revealed item landed in, including one still falling. */
  ranks: number[];
  /** The resolved cash-out after the latest item (prize × P, or the settled value). */
  cash: number;
  outcome: Outcome | null;
}

function outcomeTitle(r: Round) {
  if (r.outcome === 'target') return `${r.k} records!`;
  if (r.outcome === 'cashed') return 'Cashed out';
  return r.ranks.length >= N ? 'Items ran out' : 'Too few items left';
}

/** Narrow boards get the result card inline, below the board, so it never covers it. */
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

  const [target, setTarget] = useState(5);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [dropping, setDropping] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const busy = useRef(false);

  // An item's slot is decided the moment it starts to fall, so leaving
  // mid-animation settles at its real result, never at the pre-move value.
  // `resolved` is the open ticket's value right now, set synchronously at every
  // transition (RTP when the stake is placed, the post-drop value the moment an
  // item's slot is drawn). The ticket reads only this ref: a value derived from
  // rendered state can be one render stale (e.g. the last round's prize just
  // after Bet again) if the game unmounts before the next render.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  const speed = turbo.turbo ? 0.25 : 1;
  const itemMs = eventMs(turbo.turbo);
  const live = phase === 'running' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    busy.current = false;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  /** Drop the next item into one of its t slots; then checkpoint or end the round. */
  function next(r: Round) {
    // One move at a time, even if two clicks land before the buttons disable.
    if (busy.current) return;
    busy.current = true;
    const t = r.ranks.length + 1;
    const ranks = [...r.ranks, drawRank(t, rng)];
    const records = countRecords(ranks);
    const cash = r.prize * winChance(r.k, t, records);
    resolved.current = cash;
    const nextRound: Round = { ...r, ranks, cash };

    setRound(nextRound);
    setPhase('running');
    setDropping(true);
    timers.after(itemMs, () => setDropping(false));
    timers.after(itemMs + Math.round(650 * speed), () => {
      if (records >= r.k) return finish(nextRound, 'target', r.prize);
      if (outOfReach(r.k, t, records)) return finish(nextRound, 'short', 0);
      busy.current = false;
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: cash / r.prize });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    resolved.current = RTP;
    timers.clearAll();
    const r: Round = {
      id: ++seq.current,
      k: target,
      stake: bet.value,
      prize: prizeFor(target),
      ranks: [],
      cash: RTP,
      outcome: null,
    };
    next(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round || busy.current) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    busy.current = false;
    setRound(null);
    setDropping(false);
    setPhase('idle');
  }

  // Changing the setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (live) return;
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? next(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the setting.
  const k = round?.k ?? target;
  const ranks = round?.ranks ?? [];
  // The readouts move when the ball lands, not when it starts to fall.
  const settled = dropping ? ranks.slice(0, -1) : ranks;
  const j = settled.length;
  const r = countRecords(settled);
  const prize = round?.prize ?? prizeFor(target);
  const stake = round?.stake ?? bet.value;
  const pNow = round?.outcome === 'target' ? 1 : round?.outcome === 'short' ? 0 : winChance(k, j, r);
  const cash = phase === 'over' && round ? round.cash : round ? prize * pNow : RTP;

  let status = `Ready · ${k}+ records in ${N} items`;
  if (phase === 'running') status = `Item ${ranks.length} of ${N}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${r} of ${k} records`;
  if (phase === 'over' && round) status = `${outcomeTitle(round)} · ${Math.min(r, k)} of ${k}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Records"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={volatilityOf(target)} />}>
            Records needed: <b style={{ color: 'var(--text)' }}>{target}+</b>
          </Label>
          <Slider
            label="Records needed"
            min={TARGETS[0]}
            max={TARGETS[TARGETS.length - 1]}
            value={target}
            disabled={live}
            onChange={(v) => change(() => setTarget(clampTarget(v)))}
          />
          <div className="rec-hint">
            <span>{TARGETS[0]} · safer</span>
            <span>bigger prize · {TARGETS[TARGETS.length - 1]}</span>
          </div>

          {live && round ? (
            <>
              <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={() => next(round)}>
                Next item
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
          { label: 'Win chance', value: fmtChance(pNow), tone: 'chance' },
          { label: `Prize at ${k} records`, value: fmtMult(prize), tone: 'prize' },
        ]}
      />

      <Board className={'rec-board' + (narrow ? ' narrow' : '')}>
        <Field
          svgRef={svgRef}
          narrow={narrow}
          k={k}
          ranks={ranks}
          roundId={round?.id ?? 0}
          phase={phase}
          outcome={round?.outcome ?? null}
          dropping={dropping}
          itemMs={itemMs}
        />
        {phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={outcomeTitle(round)}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement={narrow ? 'inline' : 'bottom'}
          />
        )}
      </Board>

      <Caption>Win by getting enough records: items that beat every item before them.</Caption>

      {infoOpen && (
        <InfoModal title="Records" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              {N} items arrive one at a time in random order. An item is a <b style={{ color: 'var(--win)' }}>record</b> if it beats every item before it.
              Get at least as many records as you chose before the {N} items run out.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose how many records you need, then bet. The first item is always a record.</li>
              <li>
                Item t drops into one of t equal slots: its place among the t items so far. Only the{' '}
                <b style={{ color: 'var(--win)' }}>green top slot</b> beats them all, so it is a new record. Every other slot is a miss.
              </li>
              <li>At every checkpoint, cash out (C) or drop the next item (Space).</li>
              <li>The moment you have enough records, the prize pays out. If too few items are left to get there, the round is lost.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              <b>The next item</b>: the green slot is 1 of t equal slots, so its width is the record chance, 1 in t: half the row for item 2, a twentieth for
              item 20. That is why records get rare late in the queue.
            </p>
            <p>
              <b>The whole bet</b>: the Win chance above the board is your chance to finish with enough records from here. It jumps up on a record and slips
              down a little on every miss. The row of items shows your records (green ticks), misses (grey dots) and the items still to come. Item 1 is always
              a record, and the average payout is {(RTP * 100).toFixed(0)}% of the stake.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Rényi's record theorem: in a random order, the events "item t is a record" are independent, with chance 1/t. So the number of records is a sum
              of independent coin flips with chances 1, ½, ⅓, …, 1/{N}. Where a miss lands among the grey slots changes nothing later. The average is the
              harmonic number H<sub>{N}</sub> = 1 + ½ + … + 1/{N} ≈ 3.60.
            </p>
            <p>
              Exactly m records happen with chance c({N}, m)/{N}!, the Stirling numbers of the first kind. These also count permutations with m cycles:
              Foata's bijection turns the records of an ordering into the cycles of a permutation.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is locked when you bet at {(RTP * 100).toFixed(0)}% ÷ (chance for your setting). Cashing out pays prize × your win chance now,
              computed exactly from the independent record chances of the items still to come. Your win chance is a martingale: each item is a fair bet, and
              by optional stopping the round is worth {(RTP * 100).toFixed(0)}% of your stake whenever you stop. The largest prize on offer is{' '}
              {fmtMult(MAX_MULTIPLIER)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
