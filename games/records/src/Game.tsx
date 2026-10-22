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
  ITEMS,
  MAX_MULTIPLIER,
  RTP,
  TARGETS,
  advance,
  clampTarget,
  countRecords,
  harmonic,
  headline,
  outOfReach,
  prizeFor,
  runWindow,
  volatilityOf,
  winChance,
  type Items,
  type Pace,
} from './math';

const ACCENT = '#ff8fab';

interface Round {
  id: number;
  n: Items;
  k: number;
  stake: number;
  /** Locked at bet time: RTP / P(win). */
  prize: number;
  /** Every item revealed so far, including a move still animating. */
  ranks: number[];
  /** The resolved cash-out after the latest move (prize × P, or the settled value). */
  cash: number;
  outcome: Outcome | null;
  pace: Pace;
}

const plural = (x: number, w: string) => `${x} ${w}${x === 1 ? '' : 's'}`;

function outcomeTitle(r: Round) {
  if (r.outcome === 'target') return `${r.k} records!`;
  if (r.outcome === 'cashed') return 'Cashed out';
  return r.ranks.length >= r.n ? 'Queue ran out' : 'Out of reach';
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

  const [items, setItems] = useState<Items>(20);
  const [target, setTarget] = useState(5);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [shown, setShown] = useState(0);
  const [itemMs, setItemMs] = useState(400);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const busy = useRef(false);

  // A move is decided the moment it starts, so leaving mid-animation settles
  // at its real result, never at the pre-move value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'running' ? resolved.current : round?.cash ?? 0));

  const speed = turbo.turbo ? 0.25 : 1;
  const live = phase === 'running' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    busy.current = false;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setShown(r.ranks.length);
    setPhase('over');
  }

  /** Reveal one item, or run to the next record; then checkpoint or end the round. */
  function move(r: Round, pace: Pace) {
    // One move at a time, even if two clicks land before the buttons disable.
    if (busy.current) return;
    busy.current = true;
    const seen = r.ranks.length;
    const drawn = advance(r.n, r.k, seen, countRecords(r.ranks), pace, rng);
    const ranks = [...r.ranks, ...drawn];
    const records = countRecords(ranks);
    const cash = r.prize * winChance(r.n, r.k, ranks.length, records);
    resolved.current = cash;
    const next: Round = { ...r, ranks, cash, pace };

    // One item drops slowly; a run fast-forwards, faster the longer it is.
    const per = Math.round((drawn.length === 1 ? 420 : Math.min(150, Math.max(18, 1700 / drawn.length))) * speed);
    const hold = Math.round((drawn.length === 1 ? 140 : 320) * speed);
    setItemMs(drawn.length === 1 ? per : Math.max(per, Math.round(160 * speed)));
    setRound(next);
    setPhase('running');
    setShown(seen);
    drawn.forEach((_, i) => timers.after(per * i, () => setShown(seen + i + 1)));

    timers.after(per * drawn.length + hold, () => {
      if (records >= r.k) return finish(next, 'target', r.prize);
      if (outOfReach(r.n, r.k, ranks.length, records)) return finish(next, 'short', 0);
      busy.current = false;
      setShown(ranks.length);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: cash / r.prize });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = {
      id: ++seq.current,
      n: items,
      k: target,
      stake: bet.value,
      prize: prizeFor(items, target),
      ranks: [],
      cash: RTP,
      outcome: null,
      pace: 'item',
    };
    move(r, 'item');
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
    setShown(0);
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
      space: () => (phase === 'checkpoint' && round ? move(round, 'run') : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const n = round?.n ?? items;
  const k = round?.k ?? target;
  const ranks = round ? round.ranks.slice(0, phase === 'running' ? shown : round.ranks.length) : [];
  const j = ranks.length;
  const r = countRecords(ranks);
  const prize = round?.prize ?? prizeFor(items, target);
  const stake = round?.stake ?? bet.value;
  const pNow = round?.outcome === 'target' ? 1 : round?.outcome === 'short' ? 0 : winChance(n, k, j, r);
  const cash = phase === 'over' && round ? round.cash : round ? prize * pNow : RTP;
  const win = live ? runWindow(n, k, j, r) : null;
  const need = Math.max(0, k - r);
  const p0 = headline(items, target);
  const ks = TARGETS[items];

  let status = `Ready · ${k}+ records in ${n} items`;
  if (phase === 'running') status = round?.pace === 'run' ? `Running · item ${j} of ${n}` : `Item ${j} of ${n}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${r} of ${k} records`;
  if (phase === 'over' && round) status = `${outcomeTitle(round)} · ${Math.min(r, k)} of ${k}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  let chanceSub = `${k}+ records in ${n} items`;
  if (live) chanceSub = need > 0 ? `need ${need} more · ${plural(n - j, 'item')} left` : 'target reached';
  if (phase === 'over') chanceSub = round?.outcome === 'cashed' ? `when you cashed out` : `${plural(r, 'record')} in ${j} items`;

  return (
    <GameLayout
      name="Records"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint="more items, more records">Items in the queue</Label>
          <Chips
            label="Items in the queue"
            options={ITEMS.map((v) => ({ value: v, label: v }))}
            value={items}
            disabled={live}
            onChange={(v) =>
              change(() => {
                setItems(v);
                setTarget((t) => clampTarget(v, t));
              })
            }
          />

          <Label hint={<VolBadge level={volatilityOf(items, target)} />}>
            Records needed: <b style={{ color: 'var(--text)' }}>{target} or more</b>
          </Label>
          <Slider
            label="Records needed"
            min={ks[0]}
            max={ks[ks.length - 1]}
            value={target}
            disabled={live}
            onChange={(v) => change(() => setTarget(clampTarget(items, v)))}
          />
          <div className="rec-hint">
            <span>{ks[0]} · safer</span>
            <span>bigger prize · {ks[ks.length - 1]}</span>
          </div>

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(p0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(items, target))}</dd>
            <dt>Average records</dt>
            <dd>{harmonic(items).toFixed(2)}</dd>
          </dl>

          {live && round ? (
            <>
              <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton
                kind="secondary"
                disabled={phase !== 'checkpoint' || !win}
                title={win ? `The next record lands by item ${win.until} with chance 1 − ${win.seen}/${win.until}` : undefined}
                onClick={() => move(round, 'run')}
              >
                {need === 1 ? 'Run for the win' : 'Run to next record'}
                {win ? ` · ${fmtChance(win.chance)}` : ''}
              </ActionButton>
              <ActionButton kind="secondary" disabled={phase !== 'checkpoint' || j >= n} onClick={() => move(round, 'item')}>
                Next item · 1 in {Math.min(j + 1, n)} is a record
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
          { label: 'Win chance', value: fmtChance(pNow), sub: chanceSub, tone: 'chance' },
          {
            label: 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'at every checkpoint',
            tone: 'cash',
          },
          { label: `Prize at ${k} records`, value: fmtMult(prize), sub: formatAmount(stake * prize, 2), tone: 'prize' },
        ]}
      />

      <Board className={'rec-board' + (narrow ? ' narrow' : '')}>
        <Field svgRef={svgRef} narrow={narrow} n={n} k={k} ranks={ranks} roundId={round?.id ?? 0} phase={phase} outcome={round?.outcome ?? null} itemMs={itemMs} />
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

      {live ? (
        <ChanceBar
          p={pNow}
          label={`Chance to reach ${k} records`}
          note="It is the green share of the strip under the board. Each pink cap is one future item's record chance: 1 in its place in the queue."
        />
      ) : (
        <Caption>
          Item t beats everything before it with chance 1/t, independently of the others (Rényi). {n} items give {harmonic(n).toFixed(2)} records on
          average, and {k} or more happen {fmtChance(headline(n, k))} of the time. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Records" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A queue of items arrives one at a time in random order. An item is a <b style={{ color: ACCENT }}>record</b> if it beats every item before it.
              Finish with at least as many records as you chose.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the queue length and how many records you need, then bet. The first item is always a record.</li>
              <li>
                At every checkpoint you can cash out (C), <b>run to the next record</b> (Space), or reveal just the <b>next item</b>. Running is fast, item by
                item is slow; both are worth the same.
              </li>
              <li>
                The moment you have enough records, the prize pays out. If too few items are left to get there, the round is lost.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              <b>The ladder</b> on the right shows the t slots item t can drop into, one per possible rank among the items so far. Every slot is equally
              likely and only the <b style={{ color: ACCENT }}>pink top slot</b> is a record, so the record chance is 1 in t. Each bar in the skyline is the
              slot its item took; records reach the dashed record line.
            </p>
            <p>
              <b>The pink caps</b> on future columns are their record chances: half a column for item 2, a tenth for item 10. They shrink fast, which is why
              records get rare. <b>The bracket</b> under the board is the run: the next record must arrive by the marked item, and the chance it does is the{' '}
              <b style={{ color: 'var(--green)' }}>green share</b> of the bracket, 1 − seen/until. <b>The strip</b> splits every way the round can end by its
              final record count; the <b style={{ color: 'var(--green)' }}>green share</b> is your win chance.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Rényi's record theorem: in a random order, the events "item t is a record" are independent, with chance 1/t. So the number of records is a sum
              of independent coin flips with chances 1, ½, ⅓, …, 1/n. Its average is the harmonic number H<sub>n</sub> = 1 + ½ + … + 1/n, which grows like
              ln n: a hundred items average only 5.19 records.
            </p>
            <p>
              Exactly m records happen with chance c(n, m)/n!, the Stirling numbers of the first kind. These also count permutations with m cycles: Foata's
              bijection turns the records of an ordering into the cycles of a permutation. The run uses a telescoping product: no record among items j+1 to T
              has chance (j/(j+1))·((j+1)/(j+2))···((T−1)/T) = <b>j/T</b>.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is locked when you bet at {(RTP * 100).toFixed(0)}% ÷ (chance for your settings). Cashing out pays prize × your win chance now,
              computed exactly from the independent record chances of the items still to come. Your win chance is a martingale whether you reveal one item
              or run to the next record, so every move is a fair bet and, by optional stopping, the round is worth {(RTP * 100).toFixed(0)}% of your stake
              whatever you do. The largest prize on offer is {fmtMult(MAX_MULTIPLIER)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
