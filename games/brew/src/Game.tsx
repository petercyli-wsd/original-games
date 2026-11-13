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
  type StatusTone,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import Field from './Board';
import {
  CASH_AT,
  CHIPS,
  LIMIT,
  RTP,
  TARGETS,
  autoRound,
  prizeFor,
  slotFor,
  start,
  take,
  volatilityOf,
  winChance,
  winner,
  type CashAt,
  type State,
} from './math';

type Phase = 'idle' | 'drawing' | 'checkpoint' | 'over';
type Outcome = 'win' | 'lose' | 'cashed';

interface Round {
  prize: number;
  stake: number;
  s: State;
  cash: number;
  outcome: Outcome | null;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const RULE = 'Fill the potion with green chips before the heat passes 7; white chips add their number to the heat.';

/** One short plain line saying what the last chip changed (always under 9 tokens). */
function chipLine(s: State, slot: number, before: number): string {
  const v = CHIPS[slot];
  const d = winChance(s) - before;
  const way = Math.abs(d) < 1e-12 ? 'same' : d > 0 ? 'up' : 'down';
  if (v === 0) return `Green: ${s.filled} of ${s.k}, chance ${way}`;
  if (s.heat > LIMIT) return `White ${v}: heat ${s.heat}, boiled over`;
  return `White ${v}: heat ${s.heat} of ${LIMIT}, chance ${way}`;
}

function overTitle(r: Round): string {
  if (r.outcome === 'cashed') return 'Cashed out';
  return r.outcome === 'win' ? 'Potion full, you win' : 'It boiled over';
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [k, setK] = useState<number>(4);
  const [cashAt, setCashAt] = useState<CashAt>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [scan, setScan] = useState<number | null>(null);
  const [line, setLine] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);

  const [autoS, setAutoS] = useState<State | null>(null);
  const [autoK, setAutoK] = useState<number | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [result, setResult] = useState<Last | null>(null);
  const seq = useRef(0);

  // The ticket reads only this ref, set synchronously at every transition (a
  // chip is decided the moment it is drawn), never rendered state.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  // Manual: a chip is drawn in about 700 ms; Turbo about 175 ms (docs/STYLE.md).
  const drawMs = eventMs(turbo.turbo, 700);
  const autoMs = turbo.turbo ? 70 : 260;
  const live = phase === 'drawing' || phase === 'checkpoint';

  // ---------- Manual ----------

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  function draw(r: Round) {
    const slot = slotFor(r.s, rng.next());
    const s = take(r.s, slot);
    const w = winner(s);
    const cash = w ? (w === 'you' ? r.prize : 0) : r.prize * winChance(s);
    resolved.current = cash;
    setPhase('drawing');
    // A marker hops across the chips left in the bag and stops on the one drawn.
    const left = r.s.bag.flatMap((b, i) => (b ? [i] : []));
    const j = left.indexOf(slot);
    const hops = 7;
    for (let h = 0; h <= hops; h++) {
      const at = left[(((j - (hops - h)) % left.length) + left.length * 8) % left.length];
      timers.after((drawMs * h) / (hops + 1), () => setScan(at));
    }
    // The bag, heat and potion change only when the marker stops.
    timers.after(drawMs, () => {
      setScan(null);
      setLast(slot);
      const next = { ...r, s, cash };
      setRound(next);
      if (w) {
        setLine('');
        return finish(next, w === 'you' ? 'win' : 'lose', cash);
      }
      setLine(chipLine(s, slot, winChance(r.s)));
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: winChance(s) });
    });
  }

  async function startRound() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    resolved.current = RTP;
    timers.clearAll();
    setAutoS(null);
    setAutoK(null);
    setResult(null);
    setLast(null);
    const r: Round = { prize: prizeFor(k), stake: bet.value, s: start(k), cash: RTP, outcome: null };
    setRound(r);
    draw(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setLast(null);
    setScan(null);
    setAutoS(null);
    setAutoK(null);
    setResult(null);
    setLine('');
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  function change(apply: () => void) {
    apply();
    if (phase === 'over' || autoS || result) clear();
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const target = k;
    if (!(await ticket.place(stake))) return null;
    const res = autoRound(target, cashAt, () => rng.next());
    resolved.current = res.multiplier;
    setAutoBusy(true);
    setRound(null);
    setPhase('idle');
    setResult(null);
    setLast(null);
    setAutoK(target);
    setAutoS(start(target));
    for (const step of res.steps) {
      if (!(await timers.wait(autoMs))) break;
      setAutoS(step.s);
      setLast(step.slot);
      if (!(await timers.wait(autoMs * 0.5))) break;
    }
    ticket.settle(res.multiplier);
    pushHistory(res.multiplier);
    setResult({ id: ++seq.current, multiplier: res.multiplier, stake });
    setAutoBusy(false);
    return res.multiplier;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  const locked = live || autoBusy || auto.running;

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    timers.clearAll();
    setRound(null);
    setAutoS(null);
    setAutoK(null);
    setLast(null);
    setScan(null);
    setResult(null);
    setLine('');
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'checkpoint' && round) draw(round);
        else if (phase === 'idle' || phase === 'over') void startRound();
      },
      cashOut,
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const shownK = isAuto ? (autoK ?? k) : (round?.s.k ?? k);
  const s = isAuto ? (autoS ?? start(shownK)) : (round?.s ?? start(shownK));
  const chance = winChance(s);
  const prize = round?.prize ?? prizeFor(k);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const over = isAuto ? !!result && !autoBusy : phase === 'over';
  const decided = winner(s) !== null;
  const vol = volatilityOf(k);

  let status = `Fill ${k} green chips`;
  let tone: StatusTone = 'idle';
  if (isAuto) {
    if (autoBusy || auto.running) {
      status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ''}`;
      tone = 'live';
    } else if (result) {
      status = `${result.multiplier > 0 ? 'Won' : 'Lost'} ${fmtMult(result.multiplier)}`;
      tone = result.multiplier > 0 ? 'won' : 'lost';
    }
  } else if (phase === 'drawing') {
    status = 'Drawing a chip…';
    tone = 'live';
  } else if (phase === 'checkpoint') {
    status = line;
    tone = 'live';
  } else if (phase === 'over' && round) {
    status =
      round.outcome === 'cashed'
        ? `Cashed out at ${s.filled} of ${s.k}`
        : round.outcome === 'win'
          ? `Potion full: ${s.k} of ${s.k}`
          : `Heat ${s.heat}: boiled over`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  return (
    <GameLayout
      name="Brew"
      accent={ACCENTS.sky}
      className="bw-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={vol} />}>Green chips to fill</Label>
          <Chips
            label="Potion size"
            options={TARGETS.map((v) => ({ value: v, label: String(v), title: `Fill ${v} slots with green chips` }))}
            value={k}
            disabled={locked}
            onChange={(v) => change(() => setK(v))}
          />

          {!isAuto ? (
            phase === 'checkpoint' ? (
              <>
                <ActionButton kind="cash" onClick={cashOut}>
                  Cash out <span>{formatAmount(stake * cash, 2)}</span>
                </ActionButton>
                <ActionButton kind="secondary" onClick={() => round && draw(round)}>
                  Next chip
                </ActionButton>
              </>
            ) : (
              <ActionButton disabled={live || !!bet.blocked} onClick={() => void startRound()}>
                {phase === 'drawing' ? 'Drawing…' : phase === 'over' ? 'Bet again' : 'Bet'}
              </ActionButton>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={cashAt === null ? 'until the round is decided' : `if it gets to ${fmtMult(cashAt)}`}>Cash out at</Label>
              <Chips
                label="Auto cash-out"
                options={CASH_AT.map((v) => ({ value: v ?? 0, label: v === null ? 'End' : `${v}×` }))}
                value={cashAt ?? 0}
                disabled={autoBusy || auto.running}
                onChange={(v) => change(() => setCashAt(v === 0 ? null : (v as CashAt)))}
              />
            </AutoBetControls>
          )}
          {bet.blocked && <p className="bw-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Fill the potion', value: fmtChance(chance), tone: 'chance' },
          { label: 'Prize', value: fmtMult(isAuto ? prizeFor(shownK) : prize), tone: 'prize' },
        ]}
      />

      <Board className="bw-board">
        {isAuto && <InstantResult multiplier={result && !autoBusy ? result.multiplier : null} stake={result?.stake ?? 0} id={result?.id ?? 0} />}
        <Field s={s} last={!isAuto && phase === 'idle' ? null : last} scan={scan} chance={chance} done={decided && over} />
        {!isAuto && phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={overTitle(round)}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void startRound()}
            onClear={clear}
            placement="center"
          />
        )}
      </Board>

      <Caption>{RULE}</Caption>

      {infoOpen && (
        <InfoModal title="Brew" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Fill the potion with green chips before the heat passes {LIMIT}. The bag holds 18 chips: 10 green and 8 white, worth 1, 1, 1, 1, 2, 2, 3 and
              3. Every green chip fills a slot; every white chip adds its number to the heat.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many green chips to fill, then press Bet. The first chip is drawn straight away.</li>
              <li>After every chip you can cash out (C) or draw the next chip (Space).</li>
              <li>A white chip is drawn red when the heat plus its number would pass {LIMIT}: drawing it boils the potion over and you lose.</li>
              <li>Auto plays whole rounds with the bet and stop rules you set.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The next chip boils the potion over with chance (red chips in the bag) ÷ (chips in the bag). The bar at the bottom is your chance to fill
              the whole potion: it rises with every green chip, and falls with every white chip because the heat climbs and the red chips multiply.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Chips are drawn without replacement, so the chance is computed exactly from the chips left, the heat and the slots still empty. From the
              start you fill the potion with {fmtChance(winChance(start(k)))} at the target now selected.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays {(RTP * 100).toFixed(0)}% ÷ P(win). The cash-out is the prize × your chance now, a martingale, so cashing out at any point or
              playing to the end both return exactly {(RTP * 100).toFixed(0)}% in the long run.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
