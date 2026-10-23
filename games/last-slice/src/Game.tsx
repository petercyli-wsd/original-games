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
import Wheel, { type Outcome } from './Board';
import {
  LETTERS,
  MAX_WIN,
  RTP,
  SHAPE,
  SHAPES,
  SLICE_COUNTS,
  bySize,
  countAlive,
  fullMask,
  has,
  landing,
  lastChances,
  nextEvents,
  relock,
  startPrize,
  totalWeight,
  volatilityOf,
  wheel,
  winChance,
  type NextEvent,
  type Shape,
  type SliceCount,
} from './math';

type Phase = 'idle' | 'spinning' | 'checkpoint' | 'over';

interface Round {
  k: SliceCount;
  shape: Shape;
  mine: number;
  stake: number;
  prize: number;
  /** Slices still on the wheel (bit i = slice i). */
  mask: number;
  out: number[];
  spins: number;
  outcome: Outcome | null;
  paid: number;
}

interface View {
  /** Slice sizes as drawn (0 once out). */
  sizes: number[];
  rot: number;
  hit: number | null;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const RULE = 'Each spin removes the slice it lands on; back the slice left standing.';
const AUTO_TARGETS = [0, 1.5, 2, 3, 5, 10];
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** The next spin's landings: each slice's chance to be hit and the odds it would leave you. */
function NextSpin({ events, now, mine }: { events: readonly NextEvent[]; now: number; mine: number }) {
  return (
    <div className="ls-next" aria-label="Next spin outcomes">
      {events.map((e) => {
        const isMine = e.slice === mine;
        return (
          <div key={e.slice} className={'ls-ev' + (isMine ? ' mine' : e.win > now + 1e-12 ? ' up' : '')}>
            <span className="ls-ev-what">
              <i className={`sw c${e.slice}` + (isMine ? ' mine' : '')} />
              {LETTERS[e.slice]} · hit {fmtChance(e.prob)}
            </span>
            <b>{isMine ? 'you lose' : `→ ${fmtChance(e.win)}`}</b>
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

  const [k, setK] = useState<SliceCount>(6);
  const [shape, setShape] = useState<Shape>('mixed');
  const [mine, setMine] = useState(4);
  const [target, setTarget] = useState(3);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  // A spin is decided the moment it starts, so leaving mid-spin settles at its
  // real result, never at the pre-spin value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'spinning' || autoBusy ? resolved.current : phase === 'checkpoint' && round ? cashOf(round) : 0));

  const isAutoRef = useRef(false);
  const fast = turbo.turbo;
  const spinMs = () => (isAutoRef.current ? (fast ? 260 : 900) : fast ? 380 : 1500);
  const shrinkMs = () => (isAutoRef.current ? (fast ? 90 : 260) : fast ? 120 : 420);
  const live = phase === 'spinning' || phase === 'checkpoint';

  function cashOf(r: Round) {
    return r.prize * winChance(wheel(r.k, r.shape), r.mask, r.mine);
  }

  /** Runs f(t) for t from 0 to 1 over ms, once per frame. Resolves false if cancelled (cleared or unmounted). */
  async function tween(ms: number, fn: (t: number) => void): Promise<boolean> {
    const t0 = performance.now();
    let alive = true;
    let raf = 0;
    const loop = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      fn(t);
      if (t < 1 && alive) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const ok = await timers.wait(ms + 20);
    alive = false;
    cancelAnimationFrame(raf);
    if (ok) fn(1);
    return ok;
  }

  /**
   * Animates one spin: the wheel turns until the landing point is under the
   * pointer, then the slice it hit shrinks away (unless it is yours) while the
   * neighbours close in under the pointer.
   */
  async function animateSpin(r: Round, slice: number, within: number, turns: number): Promise<boolean> {
    const w = wheel(r.k, r.shape);
    const v0 = viewRef.current ?? { sizes: w.map((x, i) => (has(r.mask, i) ? x : 0)), rot: 0, hit: null };
    const sizes = w.map((x, i) => (has(r.mask, i) ? x : 0));
    const W = totalWeight(w, r.mask);
    let cumBefore = 0;
    for (let i = 0; i < slice; i++) cumBefore += sizes[i];
    const frac = (cumBefore + within * w[slice]) / W;
    const rot0 = v0.rot;
    const rot1 = rot0 + 360 * turns + (((-frac * 360 - rot0) % 360) + 360) % 360;
    setView({ sizes, rot: rot0, hit: null });
    if (!(await tween(spinMs(), (t) => setView({ sizes, rot: rot0 + (rot1 - rot0) * easeOut(t), hit: null })))) return false;
    setView({ sizes, rot: rot1, hit: slice });
    if (slice === r.mine) return true;
    const m = rot1 + frac * 360;
    return tween(shrinkMs(), (t) => {
      const s = 1 - easeInOut(t);
      const ws = w[slice] * s;
      const pt = (cumBefore + within * ws) / (W - w[slice] + ws);
      const next = sizes.map((x, i) => (i === slice ? ws : x));
      setView({ sizes: next, rot: m - pt * 360, hit: s > 0.02 ? slice : null });
    });
  }

  // ---------- Manual round ----------

  function finish(r: Round, outcome: Outcome, paid: number) {
    ticket.settle(paid);
    pushHistory(paid);
    setNote(null);
    setRound({ ...r, outcome, paid });
    setPhase('over');
  }

  async function spin(r: Round) {
    const w = wheel(r.k, r.shape);
    const { slice, within } = landing(w, r.mask, rng.next());
    const mask = slice === r.mine ? r.mask : r.mask & ~(1 << slice);
    const next: Round = slice === r.mine ? { ...r, spins: r.spins + 1 } : { ...r, mask, out: [...r.out, slice], spins: r.spins + 1 };
    const done = slice === r.mine || countAlive(mask) === 1;
    const paid = slice === r.mine ? 0 : countAlive(mask) === 1 ? r.prize : cashOf(next);
    resolved.current = paid;
    setNote(null);
    setPhase('spinning');
    if (!(await animateSpin(r, slice, within, 2))) return;
    setRound(next);
    if (done) {
      if (slice !== r.mine) setView((v) => (v ? { ...v, hit: null } : v));
      return finish(next, slice === r.mine ? 'lost' : 'won', paid);
    }
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: paid, winChance: winChance(w, mask, r.mine) });
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setLast(null);
    setNote(null);
    const w = wheel(k, shape);
    const r: Round = { k, shape, mine, stake: bet.value, prize: startPrize(w, mine), mask: fullMask(k), out: [], spins: 0, outcome: null, paid: 0 };
    setRound(r);
    viewRef.current = { sizes: [...w], rot: 0, hit: null };
    setView(viewRef.current);
    void spin(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', cashOf(round));
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setView(null);
    setLast(null);
    setNote(null);
    setPhase('idle');
  }

  /** At a checkpoint: back another slice still on the wheel, keeping the cash-out and relocking the prize. */
  function switchTo(i: number) {
    if (phase !== 'checkpoint' || !round || i === round.mine) return;
    if (!has(round.mask, i)) {
      setNote(`Slice ${LETTERS[i]} is already out.`);
      return;
    }
    const cash = cashOf(round);
    const prize = relock(cash, wheel(round.k, round.shape), round.mask, i);
    if (prize === null) {
      setNote(`Backing ${LETTERS[i]} now would pay over ${MAX_WIN.toLocaleString('en-US')}× (the max win), so it is not allowed.`);
      return;
    }
    setNote(`Switched to ${LETTERS[i]}: cash-out stays ${fmtMult(cash)}, prize relocked at ${fmtMult(prize)}.`);
    setRound({ ...round, mine: i, prize });
    setMine(i);
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const cfg = { k, shape, mine };
    const tgt = target;
    if (!(await ticket.place(stake))) return null;
    const w = wheel(cfg.k, cfg.shape);
    setAutoBusy(true);
    setLast(null);
    let r: Round = { ...cfg, stake, prize: startPrize(w, cfg.mine), mask: fullMask(cfg.k), out: [], spins: 0, outcome: null, paid: 0 };
    setRound(r);
    viewRef.current = { sizes: [...w], rot: viewRef.current?.rot ?? 0, hit: null };
    viewRef.current.rot = ((viewRef.current.rot % 360) + 360) % 360;
    setView(viewRef.current);
    setPhase('spinning');
    let paid = 0;
    let outcome: Outcome = 'lost';
    for (;;) {
      const { slice, within } = landing(w, r.mask, rng.next());
      const hitMine = slice === r.mine;
      const mask = hitMine ? r.mask : r.mask & ~(1 << slice);
      const next: Round = hitMine ? { ...r, spins: r.spins + 1 } : { ...r, mask, out: [...r.out, slice], spins: r.spins + 1 };
      const cash = hitMine ? 0 : countAlive(mask) === 1 ? r.prize : cashOf(next);
      resolved.current = cash;
      if (!(await animateSpin(r, slice, within, 1))) return null;
      r = next;
      setRound(r);
      if (hitMine) {
        outcome = 'lost';
        paid = 0;
        if (!(await timers.wait(fast ? 120 : 380))) return null;
        break;
      }
      if (countAlive(mask) === 1) {
        outcome = 'won';
        paid = cash;
        setView((v) => (v ? { ...v, hit: null } : v));
        break;
      }
      if (tgt > 0 && cash >= tgt - 1e-12) {
        outcome = 'cashed';
        paid = cash;
        break;
      }
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
  isAutoRef.current = isAuto;
  const busy = live || autoBusy || auto.running;

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    timers.clearAll();
    setRound(null);
    setView(null);
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

  /** Keeps the backed slice the same size rank (smallest stays smallest) when the wheel changes. */
  function remap(nk: SliceCount, ns: Shape) {
    const old = bySize(wheel(k, shape));
    const rank = old.indexOf(mine) / Math.max(1, k - 1);
    const nw = bySize(wheel(nk, ns));
    setMine(nw[Math.round(rank * (nk - 1))]);
  }

  function onSlice(i: number) {
    if (phase === 'checkpoint' && round && !isAuto) return switchTo(i);
    if (busy) return;
    setNote(null);
    change(() => setMine(i));
  }

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'checkpoint' && round) void spin(round);
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut: () => (!isAuto ? cashOut() : undefined),
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const r: Round = round ?? { k, shape, mine, stake: bet.value, prize: startPrize(wheel(k, shape), mine), mask: fullMask(k), out: [], spins: 0, outcome: null, paid: 0 };
  const w = wheel(r.k, r.shape);
  const v: View = view ?? { sizes: [...w], rot: 0, hit: null };
  const lastP = lastChances(w, r.mask);
  const outcome = phase === 'over' ? r.outcome : null;
  const winNow = outcome === 'won' ? 1 : outcome === 'lost' ? 0 : lastP[r.mine];
  const cash = r.prize * winNow;
  const events = phase === 'checkpoint' && !isAuto ? nextEvents(w, r.mask, r.mine) : null;
  const left = countAlive(r.mask);
  const stake = r.stake;

  const w0 = wheel(k, shape);
  const p0 = winChance(w0, fullMask(k), mine);
  const prize0 = RTP / p0;
  const vol = volatilityOf(p0);
  const hitShare = w[r.mine] / totalWeight(w, r.mask);

  let status = `Ready · back slice ${LETTERS[mine]} to be last`;
  let tone: StatusTone = 'idle';
  if (phase === 'spinning') {
    status = isAuto ? `Autobet · spin ${r.spins + 1}` : `Spin ${r.spins + 1}…`;
    tone = 'live';
  } else if (phase === 'checkpoint') {
    status = `${left} slices left · spin again or cash out`;
    tone = 'live';
  } else if (phase === 'over' && outcome) {
    status =
      outcome === 'cashed'
        ? `Cashed out with ${left} slices left`
        : outcome === 'won'
          ? `${LETTERS[r.mine]} is the last slice`
          : `The spin hit ${LETTERS[r.mine]}`;
    tone = r.paid > 0 ? 'won' : 'lost';
  } else if (isAuto && auto.running) {
    status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ''}`;
    tone = 'live';
  }

  const showCash = live || phase === 'over';
  const readouts: ReadoutItem[] = [
    { label: 'Win chance', value: fmtChance(round ? winNow : p0), sub: `${LETTERS[r.mine]} is the last slice`, tone: 'chance' },
    {
      label: phase === 'over' ? 'Paid' : isAuto && !round ? 'Auto cashes at' : 'Cash out now',
      value: phase === 'over' ? fmtMult(r.paid) : showCash ? fmtMult(cash) : isAuto ? (target > 0 ? fmtMult(target) : 'the end') : '—',
      sub: phase === 'over' ? formatAmount(stake * r.paid, 2) : showCash ? formatAmount(stake * cash, 2) : 'after the first spin',
      tone: 'cash',
    },
    { label: 'Prize', value: fmtMult(r.prize), sub: `pays ${formatAmount(stake * r.prize, 2)}`, tone: 'prize' },
  ];

  const editable = (!isAuto && phase === 'checkpoint') || !busy;
  const sliceChips = Array.from({ length: k }, (_, i) => ({
    value: i,
    label: LETTERS[i],
    title: `${fmtChance(lastChances(w0, fullMask(k))[i])} to be last`,
    disabled: phase === 'checkpoint' && round ? !has(round.mask, i) : false,
  }));

  return (
    <GameLayout
      name="Last Slice"
      accent="#ff006e"
      className="ls-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={vol} />}>Slices</Label>
          <Chips
            label="Slices"
            options={SLICE_COUNTS.map((v) => ({ value: v, label: v }))}
            value={k}
            disabled={busy}
            onChange={(v) =>
              change(() => {
                remap(v, shape);
                setK(v);
              })
            }
          />

          <Label hint="biggest ÷ smallest">Sizes</Label>
          <Chips
            label="Slice sizes"
            options={SHAPES.map((s) => ({
              value: s,
              label: (
                <span className="ls-chip2">
                  {SHAPE[s].label}
                  <small>{SHAPE[s].ratio}:1</small>
                </span>
              ),
            }))}
            value={shape}
            disabled={busy}
            onChange={(v) =>
              change(() => {
                remap(k, v);
                setShape(v);
              })
            }
          />

          <Label hint={phase === 'checkpoint' && !isAuto ? 'switch: value kept' : 'tap the wheel · small = safe'}>Your slice</Label>
          <Chips
            label="Your slice"
            options={sliceChips}
            value={phase === 'checkpoint' && round ? round.mine : mine}
            disabled={phase === 'checkpoint' && !isAuto ? false : busy}
            onChange={onSlice}
          />
          {note && <p className="ls-note">{note}</p>}

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
                  <ActionButton kind="secondary" onClick={() => void spin(round)}>
                    Spin · {fmtChance(hitShare)} it hits {LETTERS[round.mine]}
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
                options={AUTO_TARGETS.map((t) => ({ value: t, label: t === 0 ? 'End' : `${t}×` }))}
                value={target}
                disabled={busy}
                onChange={(t) => {
                  setTarget(t);
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
          {bet.blocked && <p className="ls-note">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className="ls-board">
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Wheel
          sizes={v.sizes}
          rot={v.rot}
          mine={r.mine}
          last={lastP}
          events={events}
          win={winNow}
          hit={v.hit}
          outcome={outcome}
          out={r.out}
          spins={r.spins}
          live={live}
          editable={editable}
          onSlice={onSlice}
        />
      </Board>

      {!isAuto && phase === 'over' && round?.outcome ? (
        <RoundOver
          key={history[0]?.id}
          title={round.outcome === 'cashed' ? 'Cashed out' : round.outcome === 'won' ? `${LETTERS[round.mine]} is the last slice` : `The spin hit ${LETTERS[round.mine]}`}
          multiplier={round.paid}
          stake={round.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={clear}
          placement="inline"
        />
      ) : !isAuto && phase === 'checkpoint' && events ? (
        <ChanceBar p={winNow} label={`Win chance: ${LETTERS[r.mine]} is the last slice`} note={<NextSpin events={events} now={winNow} mine={r.mine} />} />
      ) : !isAuto && phase === 'spinning' ? (
        <ChanceBar p={winNow} label={`Win chance: ${LETTERS[r.mine]} is the last slice`} note="Spinning…" />
      ) : (
        <Caption>
          <b className="ls-rule">{RULE}</b>
          <br />
          {isAuto
            ? `Each bet plays a whole round${target > 0 ? ` and cashes out once it is worth ${fmtMult(target)}` : ' to the last slice'}. Big slices get hit first, so small ones tend to survive. RTP ${(RTP * 100).toFixed(0)}%.`
            : `A slice's size is its chance to be hit by each spin, so big slices go early and small ones tend to survive. Tap a slice to back it. RTP ${(RTP * 100).toFixed(0)}%.`}
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Last Slice" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{RULE} The wheel has 5 to 8 slices of different sizes. You win if your slice is the only one left.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the number of slices and how uneven their sizes are, tap a slice to back it, then Bet.</li>
              <li>The wheel spins. The pointer lands on a slice with chance equal to that slice's share of the wheel. That slice is removed and the rest close up to fill the wheel.</li>
              <li>If the pointer lands on your slice, you lose. When only your slice is left, you win the prize.</li>
              <li>After every spin that misses you, cash out (C) or spin again (Space). You can also switch to another slice that is still in: your cash-out stays the same and the prize is relocked to match.</li>
              <li>Auto plays whole rounds and cashes out once the round is worth your target (or plays to the last slice with End).</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Each slice's angle is its exact chance to be hit by the next spin; the percentage inside it says so. The <b style={{ color: 'var(--red)' }}>red rim</b>{' '}
              marks your slice: that is your chance to be knocked out this spin. The green arc in the hub is your chance to be the last slice.
            </p>
            <p>
              Before you bet, the number outside each slice is its chance to be last. During a round it shows your odds if that slice is hit next. Losing a rival
              always helps you, most of all when a small slice goes. Weighted by the slice angles, these odds average back to your odds now.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              This is Plackett–Luce elimination, the same law as an exponential race. Give every slice j an independent clock T<sub>j</sub> ~ Exp(w<sub>j</sub>),
              where w<sub>j</sub> is its size; the slices leave in the order their clocks ring. So slice i is last when its clock rings after all the others:
              P(i last) = Σ<sub>A ⊆ rivals</sub> (−1)<sup>|A|</sup> w<sub>i</sub> / (w<sub>i</sub> + w(A)). It is computed exactly, spin by spin, over every set of
              slices left. No simulation is used.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Prize = {(RTP * 100).toFixed(0)}% ÷ your chance at the start. Cash-out = prize × your chance now. Your chance is a martingale: each spin moves it, but on
              average it stays the same, so any cash-out rule returns {(RTP * 100).toFixed(0)}% in the long run. Switching keeps the cash-out and relocks the prize at
              cash-out ÷ new chance, so it changes risk, never value. No prize may exceed {MAX_WIN.toLocaleString('en-US')}× (switches that would are refused).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
