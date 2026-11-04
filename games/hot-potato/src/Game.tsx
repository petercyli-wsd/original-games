import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  Caption,
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
  eventMs,
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
import { H, MAX_MULTIPLIER, N, RTP, SEAT_OPTIONS, backedSeats, mod, needleAngle, spin, startPrize, volatilityOf, winChance, winsAt, type SeatsBacked } from './math';

type Phase = 'idle' | 'spinning' | 'checkpoint' | 'over';

interface Round {
  picks: number[];
  stake: number;
  prize: number;
  /** Unwrapped bomb position; the seat is x mod N. */
  x: number;
  hops: number;
  spins: number;
  /** Cumulative needle angle (degrees from the bomb's side); null before the first spin. */
  needle: number | null;
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

const FUSE_PCT = Math.round(H * 100);
const PASS_PCT = Math.round(((1 - H) / 2) * 100);
const RULE = 'Win if the dot blows on one of your seats.';
const AUTO_TARGETS = [0, 1.5, 2, 3, 5, 10];
const seatsWord = (p: readonly number[]) => (p.length === 1 ? `seat ${p[0]}` : `seats ${p[0]}–${p[p.length - 1]}`);

/** The next needle angle: at least two full turns past the current one, landing on u's slice. */
function nextNeedle(prev: number | null, u: number) {
  const from = prev ?? 0;
  let to = from - mod(from, 360) + 720 + needleAngle(u);
  if (to - from < 600) to += 360;
  return to;
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [k, setK] = useState<SeatsBacked>(5);
  const [target, setTarget] = useState(2);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const picks = backedSeats(k);

  // A spin is decided the moment it starts, so leaving mid-spin settles at its
  // real result, never at the pre-spin value.
  const resolved = useRef(0);
  const ticket = useTicket(() =>
    phase === 'spinning' || autoBusy ? resolved.current : phase === 'checkpoint' && round ? cashOf(round) : 0,
  );

  const spinMs = eventMs(turbo.turbo);
  const hopMs = eventMs(turbo.turbo);
  const blastMs = eventMs(turbo.turbo, 300);
  const autoSpinMs = turbo.turbo ? 80 : 320;
  const autoHopMs = turbo.turbo ? 50 : 170;
  const live = phase === 'spinning' || phase === 'checkpoint';

  function cashOf(r: Round) {
    return r.prize * winChance(mod(r.x, N), r.picks);
  }

  const fresh = (stake: number): Round => ({ picks, stake, prize: startPrize(picks), x: 0, hops: 0, spins: 0, needle: null, outcome: null, blewAt: null, paid: 0 });

  // ---------- Manual round ----------

  function finish(r: Round, outcome: Outcome, paid: number) {
    ticket.settle(paid);
    pushHistory(paid);
    setRound({ ...r, outcome, paid });
    setPhase('over');
  }

  function spinOnce(r: Round) {
    const { u, blows, dir } = spin(rng.next);
    const s = mod(r.x, N);
    const spun: Round = { ...r, spins: r.spins + 1, needle: nextNeedle(r.needle, u) };
    const moved: Round = { ...spun, x: r.x + dir, hops: r.hops + 1 };
    const paid = blows ? (winsAt(s, r.picks) ? r.prize : 0) : cashOf(moved);
    resolved.current = paid;
    setRound(spun);
    setPhase('spinning');
    timers.after(spinMs, () => {
      if (blows) {
        const blew = { ...spun, blewAt: s };
        setRound(blew);
        timers.after(blastMs, () => finish(blew, paid > 0 ? 'won' : 'lost', paid));
        return;
      }
      setRound(moved);
      timers.after(hopMs, () => {
        setPhase('checkpoint');
        track({ type: 'checkpoint', multiplier: paid, winChance: winChance(mod(moved.x, N), moved.picks) });
      });
    });
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setLast(null);
    const r = fresh(bet.value);
    setRound(r);
    // The first checkpoint comes before any spin: nothing is decided until you spin.
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: cashOf(r), winChance: winChance(0, r.picks) });
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
    setPhase('idle');
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const tgt = target;
    if (!(await ticket.place(stake))) return null;
    setAutoBusy(true);
    setLast(null);
    let r = fresh(stake);
    resolved.current = cashOf(r);
    setRound(r);
    setPhase('spinning');
    let paid = 0;
    let outcome: Outcome = 'lost';
    for (;;) {
      const cash = cashOf(r);
      if (tgt > 0 && cash >= tgt - 1e-12) {
        paid = cash;
        outcome = 'cashed';
        break;
      }
      const { u, blows, dir } = spin(rng.next);
      const s = mod(r.x, N);
      r = { ...r, spins: r.spins + 1, needle: nextNeedle(r.needle, u) };
      const moved = { ...r, x: r.x + dir, hops: r.hops + 1 };
      resolved.current = blows ? (winsAt(s, r.picks) ? r.prize : 0) : cashOf(moved);
      setRound(r);
      if (!(await timers.wait(autoSpinMs))) return null;
      if (blows) {
        paid = resolved.current;
        outcome = paid > 0 ? 'won' : 'lost';
        r = { ...r, blewAt: s };
        setRound(r);
        if (!(await timers.wait(Math.round(blastMs * 0.6)))) return null;
        break;
      }
      r = moved;
      setRound(r);
      if (!(await timers.wait(autoHopMs))) return null;
    }
    ticket.settle(paid);
    pushHistory(paid);
    setRound({ ...r, outcome, paid });
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
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (busy) return;
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'checkpoint' && round) spinOnce(round);
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut: () => (!isAuto ? cashOut() : undefined),
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const view: Round = round ?? fresh(bet.value);
  const seat = mod(view.x, N);
  const blown = view.blewAt !== null;
  const winNow = blown ? (winsAt(view.blewAt!, view.picks) ? 1 : 0) : winChance(seat, view.picks);
  const cash = view.prize * winNow;
  const stake = view.stake;

  const p0 = winChance(0, picks);
  const prize0 = RTP / p0;
  const vol = volatilityOf(p0);

  let status = `Ready · back ${seatsWord(picks)}`;
  let tone: StatusTone = 'idle';
  if (phase === 'spinning') {
    status = blown ? `Boom on seat ${view.blewAt}` : isAuto ? `Autobet · spin ${view.spins}` : `Spin ${view.spins}…`;
    tone = blown ? (winNow ? 'won' : 'lost') : 'live';
  } else if (phase === 'checkpoint') {
    status = `Bomb on seat ${seat} · spin or cash out`;
    tone = 'live';
  } else if (phase === 'over' && view.outcome) {
    status =
      view.outcome === 'cashed'
        ? `Cashed out after ${view.spins} spin${view.spins === 1 ? '' : 's'}`
        : `Boom on seat ${view.blewAt} · ${view.outcome === 'won' ? 'you win' : 'you lose'}`;
    tone = view.paid > 0 ? 'won' : 'lost';
  } else if (isAuto && auto.running) {
    status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ''}`;
    tone = 'live';
  }

  // One chance and one prize (docs/STYLE.md §6); the cash-out value lives on its button.
  const readouts: ReadoutItem[] = [
    { label: 'Win chance', value: fmtChance(round ? winNow : p0), tone: 'chance' },
    { label: 'Prize', value: fmtMult(view.prize), tone: 'prize' },
  ];

  return (
    <GameLayout
      name="Hot Potato"
      accent={ACCENTS.sky}
      className="hp-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={vol} />}>Seats you back</Label>
          <Chips label="Seats you back" options={SEAT_OPTIONS.map((v) => ({ value: v, label: v }))} value={k} disabled={busy} onChange={(v) => change(() => setK(v))} />

          {!isAuto ? (
            <>
              {phase === 'checkpoint' && round ? (
                <>
                  <ActionButton kind="cash" onClick={cashOut}>
                    Cash out <span>{formatAmount(stake * cash, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" onClick={() => spinOnce(round)}>
                    Spin the fuse
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                  {phase === 'spinning' ? 'Spinning…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
          n={N}
          picks={view.picks}
          bombX={view.x}
          needle={view.needle}
          blewAt={view.blewAt}
          spinMs={isAuto ? autoSpinMs : spinMs}
          hopMs={isAuto ? autoHopMs : hopMs}
        />
      </Board>

      {!isAuto && phase === 'over' && round?.outcome && (
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
      )}
      <Caption>{RULE}</Caption>

      {infoOpen && (
        <InfoModal title="Hot Potato" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A bomb sits on a ring of {N} seats. You back 1, 3, 5, 7 or 9 seats facing it across the ring. Win the prize if the bomb blows on one of your seats.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many seats you back, then Bet. The bomb starts on seat 0 and nothing has happened yet: you can spin or cash out.</li>
              <li>
                Spin the fuse (Space). The needle lands on the dial in the middle. The wide slice marked blows ({FUSE_PCT}%): the dot blows on the seat it sits on.
                The grey slices ({PASS_PCT}% each side): it hops to that neighbour and doesn't blow.
              </li>
              <li>Landing on your seat is not a win by itself: the bomb has to blow there. Sitting on your seat, the next spin has a {FUSE_PCT}% chance to win.</li>
              <li>After every hop, cash out (C) for prize × your chance now, or spin again.</li>
              <li>Auto plays whole rounds and cashes out once the round is worth your target (or plays to the blast with End).</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The dial is the draw: each slice is as wide as its chance, the blows slice always faces the dot (green if that seat is yours, red if not) and the
              grey slices face the seats it can hop to.
            </p>
            <p>
              Your seats are the coloured ones on the ring. Your win chance is the chance the dot finally blows on one of them, shown above the board. The seat where it
              blows turns green or red and stays that way until the next round.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The bomb is a killed random walk. With hop matrix P and blow chance h = 1/5 per spin, the chance it blows on seat s from seat x is the resolvent entry
              G = h·(I − (1 − h)P)<sup>−1</sup> = Σ<sub>k≥0</sub> h(1 − h)<sup>k</sup>(P<sup>k</sup>)<sub>xs</sub>. On the ring it depends only on the distance d:
              g(d) = h·A·(r<sup>d</sup> + r<sup>{N}−d</sup>), with r = ½ exactly for h = 1/5 and A fixed by the seat under the bomb. No simulation is used.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Prize = {(RTP * 100).toFixed(0)}% ÷ your chance at the start. Cash-out = prize × your chance now, so it is {fmtMult(RTP)} before the first spin. Your
              chance is a martingale: the three slices of the next spin average back to it, so every spin is a fair bet and any cash-out rule returns{' '}
              {(RTP * 100).toFixed(0)}% in the long run. The largest prize is {fmtMult(RTP / p0Min())} (one seat), under the {MAX_MULTIPLIER}× max win.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}

const p0Min = () => winChance(0, backedSeats(1));
