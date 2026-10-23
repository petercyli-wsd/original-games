import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  Caption,
  ChanceBar,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  InstantResult,
  Label,
  ModeTabs,
  PanelFoot,
  Readouts,
  RoundOver,
  StageTop,
  VolBadge,
  fmtChance,
  fmtMult,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
  type ReadoutItem,
  type StatusTone,
} from '@originals/game-sdk/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import MapBoard, { type Outcome } from './Board';
import {
  LINES,
  LINE_LABEL,
  MAPS,
  MAP_KEYS,
  MAX_WIN,
  RTP,
  SIDES,
  SIDE_LABEL,
  callRegion,
  decided,
  emptyCalls,
  finalDist,
  nextOdds,
  relock,
  startChance,
  tally,
  volatilityOf,
  winChance,
  type Bet,
  type Call,
  type Line,
  type MapKey,
  type NextOdds,
  type Side,
} from './math';

type Phase = 'idle' | 'calling' | 'checkpoint' | 'over';

interface Round {
  map: MapKey;
  bet: Bet;
  stake: number;
  prize: number;
  calls: Call[];
  /** The random call order, fixed at the bet; order[k] is called next. */
  order: number[];
  k: number;
  /** The region animating right now. */
  calling: number | null;
  outcome: Outcome | null;
  paid: number;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const RULE = 'Regions are called one by one; does your side reach its line?';
const AUTO_TARGETS = [0, 1.5, 2, 3, 5, 10];
const betWord = (b: Bet) => `${SIDE_LABEL[b.side]} ${b.line}+`;
const betLong = (b: Bet) => `${SIDE_LABEL[b.side]} ${b.line === 51 ? 'majority (51+ seats)' : 'landslide (65+ seats)'}`;

/** The next call's two outcomes, each with its chance and the odds it would leave you. */
function NextCall({ odds, id, w, now }: { odds: NextOdds; id: string; w: number; now: number }) {
  const card = (blue: boolean) => {
    const v = blue ? odds.ifBlue : odds.ifRed;
    const tone = v > now + 1e-12 ? 'up' : v < now - 1e-12 ? 'down' : 'flat';
    return (
      <div className={`mj-ev ${tone} ${blue ? 'b' : 'r'}`}>
        <span className="mj-ev-what">
          <i />
          {id} goes {blue ? 'Blue' : 'Red'} · {fmtChance(blue ? odds.pBlue : 1 - odds.pBlue)}
        </span>
        <b>{v >= 1 ? 'you win' : v <= 0 ? 'you lose' : fmtChance(v)}</b>
      </div>
    );
  };
  return (
    <div className="mj-next" aria-label="Next call outcomes">
      <div className="mj-next-head">
        Next up: region <b>{id}</b> · {w} seats
      </div>
      <div className="mj-next-row">
        {card(true)}
        {card(false)}
      </div>
    </div>
  );
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [mapKey, setMapKey] = useState<MapKey>('tossup');
  const [side, setSide] = useState<Side>('blue');
  const [line, setLine] = useState<Line>(51);
  const [target, setTarget] = useState(2);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // A call is decided the moment it starts, so leaving mid-call settles at its
  // real result, never at the pre-call value.
  const resolved = useRef(0);
  const ticket = useTicket(() =>
    phase === 'calling' || autoBusy ? resolved.current : phase === 'checkpoint' && round ? cashOf(round) : 0,
  );

  const callMs = turbo.turbo ? 160 : 620;
  const autoCallMs = turbo.turbo ? 45 : 150;
  const live = phase === 'calling' || phase === 'checkpoint';

  function cashOf(r: Round) {
    return r.prize * winChance(MAPS[r.map], r.calls, r.bet);
  }

  function newRound(stake: number): Round {
    const m = MAPS[mapKey];
    const b = { side, line };
    return {
      map: mapKey,
      bet: b,
      stake,
      prize: RTP / startChance(mapKey, b),
      calls: emptyCalls(m),
      order: rng.shuffle(m.regions.map((_, i) => i)),
      k: 0,
      calling: null,
      outcome: null,
      paid: 0,
    };
  }

  /** Calls the next region in the order. Returns the moved round and its verdict. */
  function advance(r: Round) {
    const m = MAPS[r.map];
    const j = r.order[r.k];
    const calls = r.calls.slice();
    calls[j] = callRegion(rng.next(), m.regions[j].p);
    const moved: Round = { ...r, calls, k: r.k + 1, calling: j };
    const dec = decided(m, calls, r.bet);
    return { moved, dec };
  }

  // ---------- Manual round ----------

  function finish(r: Round, outcome: Outcome, paid: number) {
    ticket.settle(paid);
    pushHistory(paid);
    setNote(null);
    setRound({ ...r, calling: null, outcome, paid });
    setPhase('over');
  }

  function call(r: Round) {
    const { moved, dec } = advance(r);
    const paid = dec ? (dec === 'win' ? r.prize : 0) : cashOf(moved);
    resolved.current = paid;
    setNote(null);
    setRound(moved);
    setPhase('calling');
    timers.after(callMs, () => {
      if (dec) {
        finish(moved, dec === 'win' ? 'won' : 'lost', paid);
        return;
      }
      setRound({ ...moved, calling: null });
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: paid, winChance: winChance(MAPS[moved.map], moved.calls, moved.bet) });
    });
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setLast(null);
    setNote(null);
    const r = newRound(bet.value);
    setRound(r);
    call(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', cashOf(round));
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setLast(null);
    setNote(null);
    setPhase('idle');
  }

  /** At a checkpoint: change side or line, keeping the cash-out and relocking the prize. */
  function switchTo(nb: Bet) {
    if (phase !== 'checkpoint' || !round) return;
    if (nb.side === round.bet.side && nb.line === round.bet.line) return;
    const m = MAPS[round.map];
    const cash = cashOf(round);
    const prize = relock(cash, m, round.calls, nb);
    if (prize === null) {
      const dec = decided(m, round.calls, nb);
      setNote(
        dec
          ? `${betWord(nb)} is already ${dec === 'win' ? 'won' : 'lost'}, so you can't switch to it.`
          : `That switch would pay over ${MAX_WIN.toLocaleString('en-US')}× (the max win), so it is not allowed.`,
      );
      return;
    }
    setNote(`Switched to ${betWord(nb)}: cash-out stays ${fmtMult(cash)}, prize relocked at ${fmtMult(prize)}.`);
    setRound({ ...round, bet: nb, prize });
    setSide(nb.side);
    setLine(nb.line);
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const tgt = target;
    if (!(await ticket.place(stake))) return null;
    setAutoBusy(true);
    setLast(null);
    let r = newRound(stake);
    resolved.current = cashOf(r);
    setRound(r);
    setPhase('calling');
    let paid = 0;
    let outcome: Outcome = 'lost';
    for (;;) {
      const { moved, dec } = advance(r);
      r = moved;
      const cash = dec ? (dec === 'win' ? r.prize : 0) : cashOf(r);
      resolved.current = cash;
      setRound(r);
      if (!(await timers.wait(autoCallMs))) return null;
      if (dec) {
        paid = cash;
        outcome = dec === 'win' ? 'won' : 'lost';
        if (!(await timers.wait(Math.round(autoCallMs * 1.5)))) return null;
        break;
      }
      if (tgt > 0 && cash >= tgt - 1e-12) {
        paid = cash;
        outcome = 'cashed';
        break;
      }
    }
    ticket.settle(paid);
    pushHistory(paid);
    setRound({ ...r, calling: null, outcome, paid });
    setPhase('over');
    setLast({ id: ++seq.current, multiplier: paid, stake });
    setAutoBusy(false);
    return paid;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  const busy = live || autoBusy || auto.running;

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    timers.clearAll();
    setRound(null);
    setLast(null);
    setNote(null);
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (busy) return;
    apply();
    if (phase === 'over') clear();
  };

  const atCheckpoint = phase === 'checkpoint' && !!round && !isAuto;

  function onSide(v: Side) {
    if (atCheckpoint) return switchTo({ side: v, line: round!.bet.line });
    change(() => setSide(v));
  }
  function onLine(v: Line) {
    if (atCheckpoint) return switchTo({ side: round!.bet.side, line: v });
    change(() => setLine(v));
  }

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'checkpoint' && round) call(round);
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut: () => (!isAuto ? cashOut() : undefined),
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const viewMap = MAPS[round?.map ?? mapKey];
  const viewBet: Bet = round?.bet ?? { side, line };
  const calls = round?.calls ?? emptyCalls(viewMap);
  const dist = useMemo(() => finalDist(viewMap, calls), [viewMap, calls]);
  const winNow = winChance(viewMap, calls, viewBet);
  const prize = round?.prize ?? RTP / startChance(mapKey, viewBet);
  const cash = prize * winNow;
  const stake = round?.stake ?? bet.value;
  const nextIdx = phase === 'checkpoint' && round && round.k < round.order.length ? round.order[round.k] : null;
  const odds = nextIdx !== null && !isAuto ? nextOdds(viewMap, calls, nextIdx, viewBet) : null;
  const t = tally(viewMap, calls);

  const p0 = startChance(mapKey, { side, line });
  const prize0 = RTP / p0;
  const vol = volatilityOf(p0);
  const toCall = viewMap.regions.length - t.called;

  let status = `Ready · ${betLong({ side, line })}`;
  let tone: StatusTone = 'idle';
  if (phase === 'calling') {
    const j = round?.calling;
    status = j !== null && j !== undefined ? `Calling region ${viewMap.regions[j].id}…` : 'Calling…';
    if (isAuto) status = `Autobet · ${t.called} of ${viewMap.regions.length} called`;
    tone = 'live';
  } else if (phase === 'checkpoint') {
    status = `${t.called} of ${viewMap.regions.length} called · call next or cash out`;
    tone = 'live';
  } else if (phase === 'over' && round?.outcome) {
    status =
      round.outcome === 'cashed'
        ? `Cashed out with ${toCall} region${toCall === 1 ? '' : 's'} left`
        : `${toCall > 0 ? `Race called with ${toCall} left` : 'All called'} · ${round.outcome === 'won' ? 'you win' : 'you lose'}`;
    tone = round.paid > 0 ? 'won' : 'lost';
  } else if (isAuto && auto.running) {
    status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ''}`;
    tone = 'live';
  }

  const showCash = live || phase === 'over';
  const readouts: ReadoutItem[] = [
    { label: 'Win chance', value: fmtChance(round ? winNow : p0), sub: betLong(viewBet), tone: 'chance' },
    {
      label: phase === 'over' ? 'Paid' : isAuto && !round ? 'Auto cashes at' : 'Cash out now',
      value: phase === 'over' && round ? fmtMult(round.paid) : showCash ? fmtMult(cash) : isAuto && !round ? (target > 0 ? fmtMult(target) : 'the end') : '—',
      sub: phase === 'over' && round ? formatAmount(stake * round.paid, 2) : showCash ? formatAmount(stake * cash, 2) : 'after the first call',
      tone: 'cash',
    },
    { label: 'Prize', value: fmtMult(prize), sub: `pays ${formatAmount(stake * prize, 2)}`, tone: 'prize' },
  ];

  const overTitle =
    round?.outcome === 'cashed'
      ? 'Cashed out'
      : round?.outcome === 'won'
        ? `${betWord(round.bet)} reached`
        : round
          ? `${betWord(round.bet)} missed`
          : '';

  const sideOptions = SIDES.map((v) => ({ value: v, label: <span className={`mj-side ${v}`}><i />{SIDE_LABEL[v]}</span> }));
  const lineOptions = LINES.map((v) => ({ value: v, label: <span className="mj-chip2">{LINE_LABEL[v]}<small>{v}+ seats</small></span> }));

  return (
    <GameLayout
      name="Majority"
      accent="#3a86ff"
      className="mj-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={vol} />}>Map</Label>
          <Chips
            label="Map"
            options={MAP_KEYS.map((k) => ({ value: k, label: MAPS[k].label, title: MAPS[k].blurb }))}
            value={mapKey}
            disabled={busy}
            onChange={(v) => change(() => setMapKey(v))}
          />
          <p className="mj-blurb">{MAPS[mapKey].blurb}</p>

          <Label hint={atCheckpoint ? 'switch: value kept' : undefined}>Back</Label>
          <Chips label="Side" options={sideOptions} value={viewBet.side} disabled={atCheckpoint ? false : busy} onChange={onSide} />

          <Label hint={atCheckpoint ? 'switch: value kept' : 'the line your side must reach'}>Line</Label>
          <Chips label="Line" options={lineOptions} value={viewBet.line} disabled={atCheckpoint ? false : busy} onChange={onLine} />
          {note && <p className="mj-note">{note}</p>}

          {!isAuto ? (
            <>
              {phase !== 'checkpoint' && (
                <dl className="og-stats">
                  <dt>Chance to win</dt>
                  <dd>{fmtChance(p0)}</dd>
                  <dt>Prize</dt>
                  <dd>{fmtMult(prize0)}</dd>
                </dl>
              )}
              {phase === 'checkpoint' && round ? (
                <>
                  <ActionButton kind="cash" onClick={cashOut}>
                    Cash out <span>{formatAmount(stake * cash, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" onClick={() => call(round)}>
                    Call region {nextIdx !== null ? viewMap.regions[nextIdx].id : ''} · {nextIdx !== null ? Math.round(viewMap.regions[nextIdx].p * 100) : 0}% Blue
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                  {phase === 'calling' ? 'Calling…' : phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={target > 0 && target >= prize0 ? 'above the prize: plays to the end' : undefined}>Cash out at</Label>
              <Chips
                label="Auto cash-out"
                options={AUTO_TARGETS.map((v) => ({ value: v, label: v === 0 ? 'End' : `${v}×` }))}
                value={target}
                disabled={busy}
                onChange={(v) => {
                  setTarget(v);
                  if (phase === 'over' && !busy) clear();
                }}
              />
              <dl className="og-stats">
                <dt>Chance to win</dt>
                <dd>{fmtChance(p0)}</dd>
                <dt>Full prize</dt>
                <dd>{fmtMult(prize0)}</dd>
              </dl>
            </AutoBetControls>
          )}
          {bet.blocked && <p className="mj-note">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className="mj-board">
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <MapBoard
          map={viewMap}
          calls={calls}
          bet={viewBet}
          dist={dist}
          win={winNow}
          next={nextIdx}
          calling={round?.calling ?? null}
          callMs={isAuto ? autoCallMs : callMs}
          outcome={phase === 'over' ? (round?.outcome ?? null) : null}
        />
      </Board>

      {!isAuto && phase === 'over' && round?.outcome ? (
        <RoundOver
          key={history[0]?.id}
          title={overTitle}
          multiplier={round.paid}
          stake={round.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={clear}
          placement="inline"
        />
      ) : !isAuto && phase === 'checkpoint' && odds && nextIdx !== null ? (
        <ChanceBar
          p={winNow}
          label="Win chance: the green share of the paths to victory"
          note={<NextCall odds={odds} id={viewMap.regions[nextIdx].id} w={viewMap.regions[nextIdx].w} now={winNow} />}
        />
      ) : !isAuto && phase === 'calling' ? (
        <ChanceBar p={winNow} label="Win chance: the green share of the paths to victory" note="Calling the region…" />
      ) : (
        <Caption>
          <b className="mj-rule">{RULE}</b>
          <br />
          {isAuto
            ? `Each bet plays a whole round${target > 0 ? ` and cashes out once it is worth ${fmtMult(target)}` : ' until the race is called'}. Backing ${betLong({ side, line })}. RTP ${(RTP * 100).toFixed(0)}%.`
            : `Each hex shows its seats and its chance to go Blue. You back ${betLong({ side, line })}: the green bars below are every way that happens. RTP ${(RTP * 100).toFixed(0)}%.`}
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Majority" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              {RULE} The map has 100 seats split over 12–18 regions. Back Blue or Red, and a line: a majority (51+ seats) or a landslide (65+). A 50–50 map is
              hung: neither majority wins.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a map, a side and a line, then Bet. The first region is called straight away.</li>
              <li>Regions are called in a random order. Each one goes Blue with the chance printed on it, independently of the others.</li>
              <li>After each call the next region is lit up. Cash out (C) or call it (Space).</li>
              <li>At a checkpoint you may switch side or line. Your cash-out stays the same and the prize is relocked to match.</li>
              <li>The race is called as soon as no remaining region can change your result, so rounds often end early.</li>
              <li>Auto plays whole rounds and cashes out once the round is worth your target (or plays until the race is called with End).</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Each uncalled hex is split blue and red in proportion to its chance; the big number is its seats. The bar below the map fills with Blue's seats from
              the left and Red's from the right; the marker is your line.
            </p>
            <p>
              The strip at the bottom shows every possible final Blue total and its exact chance. Green bars are the totals where you win, so their combined height
              share is your odds. As regions are called the strip narrows and slides. Under the board, the two outcomes of the next call are shown with the odds
              each would leave you; weighted by their chances they average back to your odds now.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Blue's final total is S = Σ wᵢXᵢ with independent Xᵢ ~ Bernoulli(pᵢ). Its distribution is computed exactly by subset-sum convolution over the uncalled
              regions: D<sub>k</sub>(t) = (1 − p<sub>k</sub>)·D<sub>k−1</sub>(t) + p<sub>k</sub>·D<sub>k−1</sub>(t − w<sub>k</sub>). The order of calls doesn't
              affect S, so your chance P = P(S on your side of the line | calls so far) is a martingale: before each call, P = p·P(Blue) + (1 − p)·P(Red).
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Prize = {(RTP * 100).toFixed(0)}% ÷ your chance at the start. Cash-out = prize × your chance now. Because the chance never drifts, every call is a
              fair bet and any cash-out rule returns {(RTP * 100).toFixed(0)}% in the long run. Switching keeps the cash-out and relocks the prize at cash-out ÷ new
              chance, so it changes risk, never value. No prize may exceed {MAX_WIN.toLocaleString('en-US')}× (switches that would are refused).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
