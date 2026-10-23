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
import { useEffect, useRef, useState } from 'react';
import Ring, { type Outcome } from './Board';
import {
  FUSE,
  FUSES,
  MAX_PICKS,
  MAX_WIN,
  PRESETS,
  PRESET_LABEL,
  RTP,
  SEAT_COUNTS,
  SIDE_LABEL,
  heat,
  mod,
  nextEvents,
  presetPicks,
  relock,
  samePicks,
  startPrize,
  tick,
  togglePick,
  volatilityOf,
  winChance,
  winsAt,
  type Fuse,
  type NextEvent,
  type Preset,
  type SeatCount,
  type Side,
} from './math';

type Phase = 'idle' | 'hopping' | 'checkpoint' | 'over';

interface Round {
  n: SeatCount;
  fuse: Fuse;
  side: Side;
  picks: number[];
  stake: number;
  prize: number;
  /** Unwrapped bomb position; the seat is x mod n. */
  x: number;
  hops: number;
  outcome: Outcome | null;
  blewAt: number | null;
  /** The settled multiplier once over. */
  paid: number;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const RULE = 'A bomb hops round the ring until it blows; back the seat where it goes off.';
const AUTO_TARGETS = [0, 1.5, 2, 3, 5, 10];
const seatsWord = (p: readonly number[]) => (p.length === 1 ? `seat ${p[0]}` : `seats ${p.join(', ')}`);

/** The next hop's four outcomes, each with its chance and the odds it would leave you. */
function NextHop({ events, now }: { events: readonly NextEvent[]; now: number }) {
  return (
    <div className="hp-next" aria-label="Next hop outcomes">
      {events.map((e, i) => {
        const tone = e.win > now + 1e-12 ? 'up' : e.win < now - 1e-12 ? 'down' : 'flat';
        return (
          <div key={i} className={`hp-ev ${tone}` + (e.blows ? ' blows' : '')}>
            <span className="hp-ev-what">
              {e.dir < 0 ? '◂ ' : ''}
              {e.blows ? `Blows on ${e.seat}` : `Passes to ${e.seat}`}
              {e.dir > 0 ? ' ▸' : ''}
            </span>
            <b>{e.blows ? (e.win ? 'you win' : 'you lose') : fmtChance(e.win)}</b>
            <small>chance {fmtChance(e.prob)}</small>
          </div>
        );
      })}
    </div>
  );
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [n, setN] = useState<SeatCount>(10);
  const [fuse, setFuse] = useState<Fuse>('medium');
  const [side, setSide] = useState<Side>('on');
  const [picks, setPicks] = useState<number[]>(presetPicks('pair', 10));
  const [target, setTarget] = useState(2);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // A hop is decided the moment it starts, so leaving mid-hop settles at its
  // real result, never at the pre-hop value.
  const resolved = useRef(0);
  const ticket = useTicket(() =>
    phase === 'hopping' || autoBusy ? resolved.current : phase === 'checkpoint' && round ? cashOf(round) : 0,
  );

  const hopMs = turbo.turbo ? 120 : 380;
  const blastMs = turbo.turbo ? 220 : 650;
  const autoHopMs = turbo.turbo ? 55 : 190;
  const live = phase === 'hopping' || phase === 'checkpoint';

  function cashOf(r: Round) {
    return r.prize * winChance(r.n, r.fuse, mod(r.x, r.n), r.picks, r.side);
  }

  // ---------- Manual round ----------

  function finish(r: Round, outcome: Outcome, paid: number, blewAt: number | null) {
    ticket.settle(paid);
    pushHistory(paid);
    setNote(null);
    setRound({ ...r, outcome, paid, blewAt });
    setPhase('over');
  }

  function hop(r: Round) {
    const { dir, blows } = tick(rng.next, r.fuse);
    const x = r.x + dir;
    const s = mod(x, r.n);
    const moved: Round = { ...r, x, hops: r.hops + 1 };
    const paid = blows ? (winsAt(s, r.picks, r.side) ? r.prize : 0) : cashOf(moved);
    resolved.current = paid;
    setNote(null);
    setRound(moved);
    setPhase('hopping');
    timers.after(hopMs, () => {
      if (blows) {
        setRound({ ...moved, blewAt: s });
        timers.after(blastMs, () => finish(moved, paid > 0 ? 'won' : 'lost', paid, s));
        return;
      }
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: paid, winChance: winChance(r.n, r.fuse, s, r.picks, r.side) });
    });
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setLast(null);
    setNote(null);
    const r: Round = { n, fuse, side, picks, stake: bet.value, prize: startPrize(n, fuse, picks, side), x: 0, hops: 0, outcome: null, blewAt: null, paid: 0 };
    setRound(r);
    hop(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', cashOf(round), null);
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setLast(null);
    setNote(null);
    setPhase('idle');
  }

  /** At a checkpoint: change seats or side, keeping the cash-out and relocking the prize. */
  function switchTo(nextPicks: number[], nextSide: Side) {
    if (phase !== 'checkpoint' || !round) return;
    const cash = cashOf(round);
    const prize = relock(cash, round.n, round.fuse, mod(round.x, round.n), nextPicks, nextSide);
    if (prize === null) {
      setNote(`That switch would pay over ${MAX_WIN.toLocaleString('en-US')}× (the max win), so it is not allowed.`);
      return;
    }
    setNote(`Switched: cash-out stays ${fmtMult(cash)}, prize relocked at ${fmtMult(prize)}.`);
    setRound({ ...round, picks: nextPicks, side: nextSide, prize });
    setPicks(nextPicks);
    setSide(nextSide);
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const cfg = { n, fuse, side, picks };
    const tgt = target;
    if (!(await ticket.place(stake))) return null;
    setAutoBusy(true);
    setLast(null);
    let r: Round = { ...cfg, stake, prize: startPrize(cfg.n, cfg.fuse, cfg.picks, cfg.side), x: 0, hops: 0, outcome: null, blewAt: null, paid: 0 };
    setRound(r);
    setPhase('hopping');
    let paid = 0;
    let outcome: Outcome = 'lost';
    let blewAt: number | null = null;
    for (;;) {
      const { dir, blows } = tick(rng.next, r.fuse);
      r = { ...r, x: r.x + dir, hops: r.hops + 1 };
      const s = mod(r.x, r.n);
      const cash = cashOf(r);
      const stop = blows || (tgt > 0 && cash >= tgt - 1e-12);
      resolved.current = blows ? (winsAt(s, r.picks, r.side) ? r.prize : 0) : cash;
      setRound(r);
      if (!(await timers.wait(autoHopMs))) return null;
      if (blows) {
        paid = resolved.current;
        outcome = paid > 0 ? 'won' : 'lost';
        blewAt = s;
        setRound({ ...r, blewAt: s });
        if (!(await timers.wait(Math.round(blastMs * 0.6)))) return null;
        break;
      }
      if (stop) {
        paid = cash;
        outcome = 'cashed';
        break;
      }
    }
    ticket.settle(paid);
    pushHistory(paid);
    setRound({ ...r, outcome, paid, blewAt });
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

  function changeN(v: SeatCount) {
    change(() => {
      setN(v);
      const kept = picks.filter((s) => s < v);
      setPicks(kept.length ? kept : presetPicks('pair', v));
    });
  }

  function onSeat(s: number) {
    if (phase === 'checkpoint' && round && !isAuto) {
      const np = togglePick(round.picks, s);
      if (np) switchTo(np, round.side);
      else setNote(round.picks.includes(s) ? 'Keep at least one seat.' : `Back at most ${MAX_PICKS} seats: tap one of yours to drop it first.`);
      return;
    }
    if (busy) return;
    const np = togglePick(picks, s);
    if (!np) {
      setNote(picks.includes(s) ? 'Keep at least one seat.' : `Back at most ${MAX_PICKS} seats: tap one of yours to drop it first.`);
      return;
    }
    setNote(null);
    change(() => setPicks(np));
  }

  function onSide(v: Side) {
    if (phase === 'checkpoint' && round && !isAuto) {
      if (v !== round.side) switchTo(round.picks, v);
      return;
    }
    change(() => setSide(v));
  }

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'checkpoint' && round) hop(round);
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut: () => (!isAuto ? cashOut() : undefined),
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const view: Round = round ?? { n, fuse, side, picks, stake: bet.value, prize: startPrize(n, fuse, picks, side), x: 0, hops: 0, outcome: null, blewAt: null, paid: 0 };
  const seat = mod(view.x, view.n);
  const blown = view.blewAt !== null;
  const ringHeat = blown ? Array.from({ length: view.n }, (_, s) => (s === view.blewAt ? 1 : 0)) : heat(view.n, view.fuse, seat);
  const winNow = blown ? (winsAt(view.blewAt!, view.picks, view.side) ? 1 : 0) : winChance(view.n, view.fuse, seat, view.picks, view.side);
  const cash = view.prize * winNow;
  const events = phase === 'checkpoint' && !isAuto ? nextEvents(view.n, view.fuse, seat, view.picks, view.side) : null;
  const stake = view.stake;

  const p0 = winChance(n, fuse, 0, picks, side);
  const prize0 = RTP / p0;
  const vol = volatilityOf(p0);
  const sideWord = (sd: Side) => (sd === 'on' ? 'on' : 'not on');

  let status = `Ready · back ${seatsWord(picks)}`;
  let tone: StatusTone = 'idle';
  if (phase === 'hopping') {
    status = blown ? `Boom on seat ${view.blewAt}` : isAuto ? `Autobet · hop ${view.hops}` : `Hop ${view.hops}…`;
    tone = blown ? (winNow ? 'won' : 'lost') : 'live';
  } else if (phase === 'checkpoint') {
    status = `Hop ${view.hops} · bomb on seat ${seat} · pass or cash out`;
    tone = 'live';
  } else if (phase === 'over' && view.outcome) {
    status =
      view.outcome === 'cashed'
        ? `Cashed out after ${view.hops} hop${view.hops === 1 ? '' : 's'}`
        : `Boom on seat ${view.blewAt} · ${view.outcome === 'won' ? 'you win' : 'you lose'}`;
    tone = view.paid > 0 ? 'won' : 'lost';
  } else if (isAuto && auto.running) {
    status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ''}`;
    tone = 'live';
  }

  const showCash = live || phase === 'over';
  // Settled as soon as it blows (the blast beat), not only once the round is over.
  const settled = phase === 'over' || blown;
  const paidNow = phase === 'over' ? view.paid : winNow ? view.prize : 0;
  const readouts: ReadoutItem[] = [
    {
      label: 'Win chance',
      value: fmtChance(round ? winNow : p0),
      sub: `blows ${sideWord(view.side)} ${seatsWord(view.picks)}`,
      tone: 'chance',
    },
    {
      label: settled ? 'Paid' : isAuto && !round ? 'Auto cashes at' : 'Cash out now',
      value: settled ? fmtMult(paidNow) : showCash ? fmtMult(cash) : isAuto && !round ? (target > 0 ? fmtMult(target) : 'the end') : '—',
      sub: settled ? formatAmount(stake * paidNow, 2) : showCash ? formatAmount(stake * cash, 2) : 'after the first hop',
      tone: 'cash',
    },
    {
      label: 'Prize',
      value: fmtMult(view.prize),
      sub: `pays ${formatAmount(stake * view.prize, 2)}`,
      tone: 'prize',
    },
  ];

  const editable = (!isAuto && phase === 'checkpoint') || !busy;

  return (
    <GameLayout
      name="Hot Potato"
      accent="#ff6b35"
      className="hp-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={vol} />}>Seats on the ring</Label>
          <Chips label="Seats on the ring" options={SEAT_COUNTS.map((v) => ({ value: v, label: v }))} value={n} disabled={busy} onChange={changeN} />

          <Label hint="chance it blows each hop">Fuse</Label>
          <Chips
            label="Fuse"
            options={FUSES.map((v) => ({ value: v, label: (<span className="hp-chip2">{FUSE[v].label}<small>{Math.round(FUSE[v].h * 100)}% a hop</small></span>) }))}
            value={fuse}
            disabled={busy}
            onChange={(v) => change(() => setFuse(v))}
          />

          <Label hint={phase === 'checkpoint' && !isAuto ? 'switch: value kept' : undefined}>Bet</Label>
          <Chips
            label="Bet side"
            options={(['on', 'off'] as const).map((v) => ({ value: v, label: SIDE_LABEL[v] }))}
            value={view.side}
            disabled={phase === 'checkpoint' && !isAuto ? false : busy}
            onChange={onSide}
          />

          <Label hint={phase === 'checkpoint' && !isAuto ? 'tap the ring to switch' : `tap the ring · 1–${MAX_PICKS}`}>Your seats</Label>
          <Chips
            label="Quick picks"
            options={PRESETS.map((p) => ({ value: p, label: PRESET_LABEL[p] }))}
            value={PRESETS.find((p) => samePicks(presetPicks(p, view.n), view.picks)) ?? ('none' as unknown as Preset)}
            disabled={busy}
            onChange={(p) => change(() => setPicks(presetPicks(p, n)))}
          />
          {note && <p className="hp-note">{note}</p>}

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
                  <ActionButton kind="secondary" onClick={() => hop(round)}>
                    Pass it on · {Math.round(FUSE[round.fuse].h * 100)}% it blows
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                  {phase === 'hopping' ? 'Hopping…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
          {bet.blocked && <p className="hp-note">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className="hp-board">
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Ring
          n={view.n}
          picks={view.picks}
          side={view.side}
          bombX={view.x}
          hops={view.hops}
          heat={ringHeat}
          win={winNow}
          events={events}
          fusePct={Math.round(FUSE[view.fuse].h * 100)}
          outcome={phase === 'over' ? view.outcome : null}
          blewAt={view.blewAt}
          hopMs={isAuto ? autoHopMs : hopMs}
          live={live}
          editable={editable}
          onSeat={onSeat}
        />
      </Board>

      {!isAuto && phase === 'over' && round?.outcome ? (
        <RoundOver
          key={history[0]?.id}
          title={round.outcome === 'cashed' ? 'Cashed out' : round.outcome === 'won' ? `Boom on seat ${round.blewAt}: yours` : `Boom on seat ${round.blewAt}`}
          multiplier={round.paid}
          stake={round.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={clear}
          placement="inline"
        />
      ) : !isAuto && phase === 'checkpoint' && events ? (
        <ChanceBar p={winNow} label="Win chance: your share of the heat ring" note={<NextHop events={events} now={winNow} />} />
      ) : !isAuto && phase === 'hopping' ? (
        <ChanceBar p={winNow} label="Win chance: your share of the heat ring" note="The bomb is hopping…" />
      ) : (
        <Caption>
          <b className="hp-rule">{RULE}</b>
          <br />
          {isAuto
            ? `Each bet plays a whole round${target > 0 ? ` and cashes out once it is worth ${fmtMult(target)}` : ' to the blast'}. Fuse ${Math.round(FUSE[fuse].h * 100)}% a hop. RTP ${(RTP * 100).toFixed(0)}%.`
            : `Tap seats to back them. The ring shows each seat's chance to be where it blows: green wins for you. Fuse ${Math.round(FUSE[fuse].h * 100)}% a hop. RTP ${(RTP * 100).toFixed(0)}%.`}
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Hot Potato" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{RULE} Back 1 to {MAX_PICKS} seats and bet that it blows on one of them (Blows on mine), or that it blows anywhere else (Not on mine).</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the number of seats and the fuse, tap 1–{MAX_PICKS} seats on the ring (or use a quick pick), choose your side, then Bet.</li>
              <li>The bomb starts on seat 0. Each hop it moves to a neighbour, left or right at random, then its fuse blows with the chance you chose.</li>
              <li>After every hop that doesn't blow, cash out (C) or pass it on (Space).</li>
              <li>At a checkpoint you may also switch seats (tap the ring) or side. Your cash-out stays the same and the prize is relocked to match.</li>
              <li>Auto plays whole rounds and cashes out once the round is worth your target (or plays to the blast with End).</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The outer ring is the heat: each seat's exact chance to be where the bomb finally blows. The numbers add up to 100%, and the whole pattern turns
              with the bomb. Green seats win for you, red seats lose. Your win chance is your share of the heat, drawn as the green arc of the dial in the middle.
            </p>
            <p>
              At a checkpoint the four outcomes of the next hop are listed: blow or pass on either neighbour, with the chance of each and the odds it would leave
              you. Weighted by their chances they average back to your odds now. The small numbers inside the ring are the odds if the bomb passes to that seat.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The bomb is a killed random walk. With hop matrix P and kill (blow) chance h per hop, the chance it blows on seat s starting from seat x is the
              resolvent entry G = h·P·(I − (1 − h)P)<sup>−1</sup>, i.e. Σ<sub>k≥1</sub> h(1 − h)<sup>k−1</sup>(P<sup>k</sup>)<sub>xs</sub>. The ring is symmetric, so
              this depends only on the distance from the bomb. It is solved exactly as a small linear system; no simulation is used.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Prize = {(RTP * 100).toFixed(0)}% ÷ your chance at the start. Cash-out = prize × your chance now. Your chance is a martingale (it moves up or
              down each hop but never drifts), so every hop is a fair bet and any cash-out rule returns {(RTP * 100).toFixed(0)}% in the long run. Switching keeps the
              cash-out and relocks the prize at cash-out ÷ new chance, so it changes risk, never value. No prize may exceed {MAX_WIN.toLocaleString('en-US')}×
              (switches that would are refused).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
