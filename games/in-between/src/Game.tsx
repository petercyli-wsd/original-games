import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
  ActionButton,
  AutoBetControls,
  BetField,
  Board as KitBoard,
  Caption,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  InstantResult,
  Label,
  Readouts,
  ModeTabs,
  PanelFoot,
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
  type StatusTone,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import Board from './Board';
import { RULE } from './manifest';
import {
  LINE,
  MAX_WIN,
  RTP,
  SLOTS,
  VOL_OF,
  afterSafe,
  chooseSlot,
  dealPosts,
  drawNumber,
  emptyRow,
  fitCount,
  isFull,
  legalSlots,
  place,
  rowChance,
  startChance,
  stepStop,
  type Row,
  type Slots,
} from './math';

type Phase = 'idle' | 'dealing' | 'ready' | 'turning' | 'pick' | 'settling' | 'over';
type Outcome = 'won' | 'lost' | 'cashed';

interface Round {
  stake: number;
  m: Slots;
  row: Row;
  cash: number;
  steps: number;
  drawn: number | null;
  bust: number | null;
  legal: number[];
  outcome: Outcome | null;
  paid: number;
  /** What filling the whole row pays from the deal, capped at MAX_WIN. */
  top: number;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const AUTO_TARGETS = [0, 2, 5, 10, 100];
const TITLE: Record<Outcome, string> = { won: 'Row complete', lost: 'Fits nowhere', cashed: 'Cashed out' };

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [m, setM] = useState<Slots>(2);
  const [target, setTarget] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [status, setStatus] = useState<{ text: string; tone: StatusTone } | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const busyRef = useRef(false);

  // The open ticket's value right now, set synchronously: RTP when the stake is
  // placed, the post-draw value when a number is drawn (0 if it fits nowhere,
  // cash x n/s if it fits). The ticket reads only this ref, never rendered state.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  const isAutoRef = useRef(false);
  const kk = turbo.turbo ? 0.25 : 1;
  // Manual: a number turns for 600 ms and the line recolours over 450 ms. Turbo about a quarter. Auto is a little quicker.
  const turnMs = () => (isAutoRef.current ? Math.round(420 * kk) : eventMs(turbo.turbo, 600));
  const settleMs = () => (isAutoRef.current ? Math.round(300 * kk) : eventMs(turbo.turbo, 450));

  const live = phase !== 'idle' && phase !== 'over';

  function finish(r: Round, outcome: Outcome, paid: number, text: string) {
    busyRef.current = false;
    ticket.settle(paid);
    pushHistory(paid);
    setStatus({ text, tone: paid > 0 ? 'won' : 'lost' });
    setRound({ ...r, drawn: outcome === 'lost' ? r.drawn : null, legal: [], outcome, paid });
    setPhase('over');
  }

  /** After a placement (or the deal): the round ends if the row is full, nothing can fit, or the cap is near. Otherwise it waits at a checkpoint. */
  function endCheck(r: Round): { outcome: Outcome; text: string } | null {
    if (isFull(r.row)) return { outcome: 'won', text: 'Row complete: paid' };
    const stop = stepStop(r.row, r.cash);
    if (stop === 'cap') return { outcome: 'cashed', text: 'Max win reached: paid' };
    if (stop === 'stuck') return { outcome: 'cashed', text: 'Nothing can fit: paid' };
    return null;
  }

  async function deal(stake: number): Promise<Round | null> {
    const { a, b, redeals } = dealPosts(rng, m);
    if (redeals > 0) {
      setStatus({ text: 'Posts too close: redeal', tone: 'live' });
      if (!(await timers.wait(settleMs()))) return null;
    }
    const r: Round = { stake, m, row: emptyRow(a, b, m), cash: RTP, steps: 0, drawn: null, bust: null, legal: [], outcome: null, paid: 0, top: Math.min(MAX_WIN, RTP / rowChance(emptyRow(a, b, m))) };
    setRound(r);
    setStatus({ text: `Posts ${a} and ${b}`, tone: 'live' });
    return r;
  }

  async function start() {
    if (live || autoBusy || bet.blocked || busyRef.current) return;
    busyRef.current = true;
    if (!(await ticket.place(bet.value))) {
      busyRef.current = false;
      return;
    }
    resolved.current = RTP;
    timers.clearAll();
    setLast(null);
    setPhase('dealing');
    setRound(null);
    const r = await deal(bet.value);
    if (!r) return;
    busyRef.current = false;
    setPhase('ready');
  }

  /** Draw the next number. Its fate is decided now; the card turns, then the player taps. */
  async function draw() {
    if (!round || phase !== 'ready' || busyRef.current) return;
    busyRef.current = true;
    const r = round;
    const x = drawNumber(rng, r.row);
    const legal = legalSlots(r.row, x);
    resolved.current = legal.length > 0 ? afterSafe(r.cash, r.row) : 0;
    setRound({ ...r, drawn: x, legal: [] });
    setStatus({ text: 'Drawing a number', tone: 'live' });
    setPhase('turning');
    if (!(await timers.wait(turnMs()))) return;
    if (legal.length === 0) {
      finish({ ...r, drawn: x, bust: x, steps: r.steps + 1 }, 'lost', 0, `${x} fits nowhere: lost`);
      return;
    }
    setRound({ ...r, drawn: x, legal });
    setStatus({ text: `Tap a slot for ${x}`, tone: 'live' });
    setPhase('pick');
    busyRef.current = false;
    // Turbo places a number that has only one legal slot; in Manual the player still taps.
    if (turbo.turbo && legal.length === 1) void tap(legal[0]!, { ...r, drawn: x, legal }, 'pick');
  }

  async function tap(slot: number, snap: Round | null = round, ph: Phase = phase) {
    if (!snap || ph !== 'pick' || busyRef.current || snap.drawn === null || !snap.legal.includes(slot)) return;
    busyRef.current = true;
    const round = snap;
    const x = round.drawn!;
    const cash = afterSafe(round.cash, round.row);
    const next: Round = { ...round, row: place(round.row, slot, x), cash, steps: round.steps + 1, drawn: null, legal: [] };
    resolved.current = cash;
    setRound(next);
    setStatus({ text: `Placed ${x}: next draw`, tone: 'live' });
    setPhase('settling');
    if (!(await timers.wait(settleMs()))) return;
    const end = endCheck(next);
    if (end) {
      finish(next, end.outcome, cash, end.text);
      return;
    }
    busyRef.current = false;
    setPhase('ready');
    track({ type: 'checkpoint', multiplier: cash, winChance: stepChance(next.row) });
  }

  function cashOut() {
    if (!round || phase !== 'ready' || round.steps === 0 || busyRef.current) return;
    finish(round, 'cashed', round.cash, 'Cashed out: paid');
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    busyRef.current = false;
    setRound(null);
    setStatus(null);
    setLast(null);
    setPhase('idle');
  }

  // ---------- Auto: best slot every time, cash out at the chosen multiplier ----------

  async function playAuto(stake: number): Promise<number | null> {
    if (!(await ticket.place(stake))) return null;
    setAutoBusy(true);
    setLast(null);
    resolved.current = RTP;
    setPhase('dealing');
    let r = await deal(stake);
    if (!r) return null;
    let outcome: Outcome = 'cashed';
    let paid = 0;
    let text = 'Cashed out: paid';
    for (;;) {
      const x = drawNumber(rng, r.row);
      const slot = chooseSlot(r.row, x, 'best');
      resolved.current = slot >= 0 ? afterSafe(r.cash, r.row) : 0;
      setRound({ ...r, drawn: x, legal: [] });
      setStatus({ text: 'Drawing a number', tone: 'live' });
      setPhase('turning');
      if (!(await timers.wait(turnMs()))) return null;
      if (slot < 0) {
        r = { ...r, drawn: x, bust: x, steps: r.steps + 1 };
        outcome = 'lost';
        paid = 0;
        text = `${x} fits nowhere: lost`;
        break;
      }
      const cash = afterSafe(r.cash, r.row);
      r = { ...r, row: place(r.row, slot, x), cash, steps: r.steps + 1, drawn: null, legal: [] };
      resolved.current = cash;
      setRound(r);
      setStatus({ text: `Placed ${x}: next draw`, tone: 'live' });
      setPhase('settling');
      if (!(await timers.wait(settleMs()))) return null;
      const end = endCheck(r);
      if (end) {
        outcome = end.outcome;
        paid = cash;
        text = end.text;
        break;
      }
      if (target > 0 && cash >= target - 1e-12) {
        paid = cash;
        break;
      }
    }
    ticket.settle(paid);
    pushHistory(paid);
    setStatus({ text, tone: paid > 0 ? 'won' : 'lost' });
    setRound({ ...r, outcome, paid, legal: [] });
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
    busyRef.current = false;
    setRound(null);
    setStatus(null);
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
        if (phase === 'ready') void draw();
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut: () => (!isAuto ? cashOut() : undefined),
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const showM = round?.m ?? m;
  const f = round ? fitCount(round.row) : null;
  const canCash = !isAuto && phase === 'ready' && !!round && round.steps > 0;

  let idleText = 'Fill the row in order';
  if (isAuto && auto.running && !round) idleText = `Autobet${auto.remaining !== null ? `, ${auto.remaining} left` : ''}`;
  const shown = status ?? { text: idleText, tone: 'idle' as StatusTone };

  return (
    <GameLayout
      name="In Between"
      accent={ACCENTS.sky}
      className="ib-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={VOL_OF[m]} />}>Inner slots</Label>
          <Chips
            label="Inner slots"
            options={SLOTS.map((v) => ({ value: v, label: `${v}`, title: `${v} slot${v > 1 ? 's' : ''} to fill` }))}
            value={m}
            disabled={busy}
            onChange={(v) => change(() => setM(v))}
          />

          {!isAuto ? (
            phase === 'idle' || phase === 'over' || phase === 'dealing' ? (
              <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                {phase === 'dealing' ? 'Dealing…' : phase === 'over' ? 'Bet again' : 'Bet'}
              </ActionButton>
            ) : (
              <>
                <ActionButton kind="secondary" disabled={phase !== 'ready'} onClick={() => void draw()}>
                  {phase === 'pick' ? 'Tap a slot' : 'Draw'}
                </ActionButton>
                <ActionButton kind="cash" disabled={!canCash} onClick={cashOut}>
                  Cash out{round && round.steps > 0 && <span> {formatAmount(round.stake * round.cash, 2)}</span>}
                </ActionButton>
              </>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={target > 0 ? 'else plays to the end' : 'best slot every time'}>Cash out at</Label>
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
            </AutoBetControls>
          )}
          {bet.blocked && <p className="ib-note">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={shown.text} tone={shown.tone} history={history} />

      {f && !isFull(round!.row) && (
        <div className="og-chance" role="meter" aria-valuemin={0} aria-valuemax={f.n} aria-valuenow={f.s} aria-label="Next number fits">
          <div className="og-chance-head">
            <span>{`Next number fits: ${f.s} of ${f.n}`}</span>
          </div>
          <div className="og-chance-track">
            <i style={{ width: `${(f.s / f.n) * 100}%` }} />
          </div>
        </div>
      )}

      <Readouts items={[{ label: 'Full row pays', value: fmtMult(round ? round.top : Math.min(MAX_WIN, RTP / startChance(m))), tone: 'prize' }]} />

      <KitBoard className="ib-board">
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <div className={'ib-wrap' + (isAuto ? ' auto' : '')}>
          <Board
            m={showM}
            row={round?.row ?? null}
            drawn={round?.drawn ?? null}
            turning={phase === 'turning'}
            bust={round?.bust ?? null}
            legal={round?.legal ?? []}
            onSlot={(s) => void tap(s)}
            turnMs={turnMs()}
            recolourMs={settleMs()}
          />
          <p className="ib-key">{round ? 'Numbers in red have no slot.' : ''}</p>
        </div>
      </KitBoard>

      {!isAuto && phase === 'over' && round?.outcome && (
        <RoundOver
          key={history[0]?.id}
          title={TITLE[round.outcome]}
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
        <InfoModal title="In Between" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{RULE} Fill every slot and the round pays. A number that fits no slot loses it.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many slots to fill (1 to 5), then press Bet. Two posts land on a line of 1 to {LINE}, the lower one on the left.</li>
              <li>Press Draw. A number turns over. It may go in any empty slot between its two nearest placed numbers, and those slots get a dashed outline. Tap one.</li>
              <li>Your number leaves a smaller gap on each side. A gap with no empty slot turns red on the line: any number that falls there has no slot.</li>
              <li>Cash out (C) any time after your first number. Space draws. Auto always takes the best slot and cashes out at your target.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The line shows every number still to come. Green numbers have a slot, red numbers do not, grey ones are used. The readout counts them: the next draw is safe
              exactly when it is green, so "46 of 98" means 46 of the 98 numbers left. Your tap moves the red: it decides how big each remaining gap is.
            </p>
            <p>
              Chance of filling every slot with the best taps, from the start:{' '}
              {SLOTS.map((v) => `${v}: ${fmtChance(startChance(v))}`).join(', ')}.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Each safe draw multiplies the cash-out by n ÷ s (n numbers left, s of them with a slot), so the cash-out is a martingale. A gap of w numbers with j slots is
              filled with chance F(w, j) = (1/w) Σ<sub>x</sub> max<sub>k</sub> C(x−1,k−1) C(w−x,j−k) / C(w−1,j−1) · F(x−1,k−1) F(w−x,j−k), the best slot k for each first draw x.
              Slots are filled by independent gaps, which is how Auto picks its slot.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The cash-out starts at {(RTP * 100).toFixed(0)}% of the stake and is multiplied by n ÷ s at each safe step, so any slot choice and any stopping rule returns {(RTP * 100).toFixed(0)}% in the long run.
              Slots change the spread, not the average. The posts are not a priced step. If two posts leave too little room, they are redealt at once. A step that would pass {MAX_WIN.toLocaleString('en-US')}× pays out instead, and a step where nothing can fit pays out too.
              The best chance of filling every slot is a longer shot than it looks because two rounds in three end on the first number: those numbers land outside the posts.
            </p>
            <p>The biggest payout possible is {fmtMult(MAX_WIN)}.</p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}

function stepChance(row: Row): number {
  const f = fitCount(row);
  return f.n === 0 ? 0 : f.s / f.n;
}
