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
  Slider,
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
  type StatusTone,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import Field, { type Falling } from './Board';
import {
  BEAD_COUNTS,
  BET_KINDS,
  BET_NAME,
  CASH_AT,
  K_MIN,
  MAX_PRIZE,
  RTP,
  addBead,
  autoRound,
  beadFrom,
  betLabel,
  chanceAt,
  clampK,
  diffOf,
  forecast as forecastOf,
  kMax,
  leftToDrop,
  openChance,
  prizeFor,
  settled,
  volatilityOf,
  type Bead,
  type Beads,
  type Bet,
  type BetKind,
  type CashAt,
  type Pans,
} from './math';

type Phase = 'idle' | 'dropping' | 'checkpoint' | 'over';
type Outcome = 'win' | 'lose' | 'cashed';

interface Round {
  bet: Bet;
  prize: number;
  stake: number;
  s: Pans;
  cash: number;
  outcome: Outcome | null;
}

interface AutoView {
  bet: Bet;
  s: Pans;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const RULE = 'Beads drop onto a balance; bet which pan ends heavier.';

const describe = (D: number) => (D > 0 ? `Left by ${D}` : D < 0 ? `Right by ${-D}` : 'Dead level');

function overTitle(r: Round): string {
  if (r.outcome === 'cashed') return 'Cashed out';
  const D = diffOf(r.s);
  if (leftToDrop(r.s) === 0) return describe(D);
  return `${describe(D)} · ${r.outcome === 'win' ? "can't be caught" : 'out of reach'}`;
}

/** The strip's half-width: about three standard deviations of the final difference, wide enough for k and the lead. */
function rangeFor(n: number, bet: Bet, D: number): number {
  const sd = Math.sqrt((n * 91) / 6);
  return Math.min(6 * n, Math.max(Math.ceil(2.8 * sd), bet.kind === 'K' ? bet.k + 6 : 0, Math.abs(D) + 6));
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [n, setN] = useState<Beads>(12);
  const [kind, setKind] = useState<BetKind>('L');
  const [k, setK] = useState(20);
  const [cashAt, setCashAt] = useState<CashAt>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [falling, setFalling] = useState<Falling | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const [autoView, setAutoView] = useState<AutoView | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const seq = useRef(0);

  const chosen: Bet = { kind, k: clampK(n, k) };

  // A bead is decided the moment it is released, so leaving mid-fall settles
  // at its real result, never at the pre-drop value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'dropping' || autoBusy ? resolved.current : round && !round.outcome ? round.cash : 0));

  const fallMs = turbo.turbo ? 170 : 560;
  const tiltMs = turbo.turbo ? 110 : 380;
  const autoFallMs = turbo.turbo ? 60 : 190;
  const live = phase === 'dropping' || phase === 'checkpoint';

  // ---------- Manual ----------

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  function drop(r: Round) {
    const bead = beadFrom(rng.next());
    const s = addBead(r.s, bead);
    const res = settled(s, r.bet);
    const cash = res ? (res === 'win' ? r.prize : 0) : r.prize * chanceAt(s, r.bet);
    resolved.current = cash;
    setFalling({ id: ++seq.current, bead, ms: fallMs });
    setPhase('dropping');
    timers.after(fallMs, () => {
      const next = { ...r, s, cash };
      setRound(next);
      setFalling(null);
      if (res) return timers.after(tiltMs, () => finish(next, res, cash));
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: chanceAt(s, r.bet) });
    });
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setAutoView(null);
    setLast(null);
    const r: Round = { bet: chosen, prize: prizeFor(n, chosen), stake: bet.value, s: { n, beads: [] }, cash: RTP, outcome: null };
    setRound(r);
    drop(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setFalling(null);
    setAutoView(null);
    setLast(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  function change(apply: () => void) {
    apply();
    if (phase === 'over' || autoView || last) clear();
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const b = chosen;
    const count = n;
    if (!(await ticket.place(stake))) return null;
    const res = autoRound(count, b, cashAt, () => rng.next());
    resolved.current = res.multiplier;
    setAutoBusy(true);
    setRound(null);
    setPhase('idle');
    setLast(null);
    let beads: Bead[] = [];
    setAutoView({ bet: b, s: { n: count, beads } });
    for (const bead of res.beads) {
      setFalling({ id: ++seq.current, bead, ms: autoFallMs });
      if (!(await timers.wait(autoFallMs))) break;
      beads = [...beads, bead];
      setFalling(null);
      setAutoView({ bet: b, s: { n: count, beads } });
      if (!(await timers.wait(autoFallMs * 0.5))) break;
    }
    setFalling(null);
    ticket.settle(res.multiplier);
    pushHistory(res.multiplier);
    setLast({ id: ++seq.current, multiplier: res.multiplier, stake });
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
    setAutoView(null);
    setFalling(null);
    setLast(null);
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
        if (phase === 'checkpoint' && round) drop(round);
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const s: Pans = isAuto ? autoView?.s ?? { n, beads: [] } : round?.s ?? { n, beads: [] };
  const shownBet = isAuto ? autoView?.bet ?? chosen : round?.bet ?? chosen;
  const D = diffOf(s);
  const chance = chanceAt(s, shownBet);
  const prize = round?.prize ?? prizeFor(n, chosen);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const over = isAuto ? !!last && !autoBusy : phase === 'over';
  const done = over || settled(s, shownBet) !== null;
  const showForecast = !done && leftToDrop(s) > 0;
  const fc = showForecast ? forecastOf(s, shownBet) : null;
  const vol = volatilityOf(n, chosen);
  const range = rangeFor(s.n, shownBet, D);
  const dropped = s.beads.length;

  let status = `Ready · ${n} beads · ${betLabel(chosen)}`;
  let tone: StatusTone = 'idle';
  if (isAuto) {
    if (autoBusy || auto.running) {
      status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ''} · ${describe(D)}`;
      tone = 'live';
    } else if (last) {
      status = `${last.multiplier > 0 ? 'Won' : 'Lost'} ${fmtMult(last.multiplier)} · ${describe(D)}`;
      tone = last.multiplier > 0 ? 'won' : 'lost';
    } else status = `Auto · ${betLabel(chosen)}, ${cashAt === null ? 'play to the end' : `cash out at ${fmtMult(cashAt)}`}`;
  } else if (phase === 'dropping') {
    status = `Bead ${dropped + 1} of ${s.n} falling…`;
    tone = 'live';
  } else if (phase === 'checkpoint') {
    status = `Checkpoint · ${dropped} of ${s.n} · ${describe(D)}`;
    tone = 'live';
  } else if (phase === 'over' && round) {
    status = `${overTitle(round)} · ${round.outcome === 'lose' ? 'lost' : 'paid ' + fmtMult(round.cash)}`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  const kHi = kMax(n);
  const betButtons = (
    <div className="sc-bets" role="radiogroup" aria-label="What to back">
      {BET_KINDS.map((bk) => {
        const b: Bet = { kind: bk, k: clampK(n, k) };
        const p = openChance(n, b);
        const on = (live ? round?.bet.kind : kind) === bk;
        return (
          <button
            key={bk}
            type="button"
            role="radio"
            aria-checked={on}
            className={`sc-bet ${bk.toLowerCase()}` + (on ? ' on' : '')}
            disabled={locked}
            onClick={() => change(() => setKind(bk))}
          >
            <span className="n">{bk === 'K' ? `Left by ≥ ${b.k}` : BET_NAME[bk]}</span>
            <b>{fmtChance(p)}</b>
            <small>{fmtMult(RTP / p)}</small>
          </button>
        );
      })}
    </div>
  );

  return (
    <GameLayout
      name="Scales"
      accent="#e9c46a"
      className="sc-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={vol} />}>Beads</Label>
          <Chips
            label="Beads"
            options={BEAD_COUNTS.map((v) => ({ value: v, label: v }))}
            value={n}
            disabled={locked}
            onChange={(v) => change(() => setN(v))}
          />

          <Label hint="chance · prize">Bet on the final balance</Label>
          {betButtons}
          {kind === 'K' && (
            <>
              <Label hint={`${K_MIN} to ${kHi}`}>Margin k = {clampK(n, k)}</Label>
              <Slider label="Margin k" value={clampK(n, k)} min={K_MIN} max={kHi} disabled={locked} onChange={(v) => change(() => setK(v))} />
            </>
          )}

          {!isAuto ? (
            <>
              <dl className="og-stats">
                <dt>Chance to win</dt>
                <dd>{fmtChance(live ? chance : openChance(n, chosen))}</dd>
                <dt>Prize</dt>
                <dd>{fmtMult(live ? prize : prizeFor(n, chosen))}</dd>
              </dl>
              {phase === 'checkpoint' ? (
                <>
                  <ActionButton kind="cash" onClick={cashOut}>
                    Cash out <span>{formatAmount(stake * cash, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" onClick={() => round && drop(round)}>
                    Drop next · {dropped + 1} of {s.n}
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                  {phase === 'dropping' ? 'Dropping…' : phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={cashAt === null ? 'until your bet settles' : `once it reaches ${fmtMult(cashAt)}`}>Cash out at</Label>
              <Chips
                label="Auto cash-out"
                wrap
                options={CASH_AT.map((v) => ({ value: v ?? 0, label: v === null ? 'End' : `${v}×` }))}
                value={cashAt ?? 0}
                disabled={autoBusy || auto.running}
                onChange={(v) => change(() => setCashAt(v === 0 ? null : (v as CashAt)))}
              />
            </AutoBetControls>
          )}
          {bet.blocked && <p className="sc-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: betLabel(shownBet), value: fmtChance(chance), sub: live || autoBusy ? 'your chance now' : 'your chance', tone: 'chance' },
          isAuto
            ? {
                label: 'Value now',
                value: autoView ? fmtMult(prizeFor(s.n, shownBet) * chance) : '—',
                sub: autoView ? formatAmount(bet.value * prizeFor(s.n, shownBet) * chance, 2) : 'prize × your chance',
                tone: 'cash',
              }
            : {
                label: 'Cash out now',
                value: phase === 'checkpoint' || phase === 'over' ? fmtMult(cash) : '—',
                sub: phase === 'checkpoint' || phase === 'over' ? formatAmount(stake * cash, 2) : 'after the first bead',
                tone: 'cash',
              },
          {
            label: 'Prize',
            value: fmtMult(isAuto ? prizeFor(s.n, shownBet) : prize),
            sub: `pays ${formatAmount((isAuto ? bet.value : stake) * (isAuto ? prizeFor(s.n, shownBet) : prize), 2)}`,
            tone: 'prize',
          },
        ]}
      />

      <Board className="sc-board">
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Field n={s.n} beads={s.beads} bet={shownBet} falling={falling} forecast={fc} chance={chance} range={range} tiltMs={isAuto ? autoFallMs : tiltMs} />
        {!isAuto && phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={overTitle(round)}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement="center"
          />
        )}
      </Board>

      {!isAuto && live ? (
        <ChanceBar
          p={chance}
          label={`Your chance: ${betLabel(shownBet)}`}
          note="The green share of the strip is your chance. Space drops the next bead, C cashes out."
        />
      ) : (
        <Caption>
          <b className="sc-rule">{RULE}</b>{' '}
          {isAuto
            ? `Auto plays whole rounds${cashAt === null ? ' to the end' : `, cashing out at ${fmtMult(cashAt)}`}.`
            : `Each bead lands left or right and weighs 1 to 6, all 12 equally likely. The tilt is the lead; the green bars are your chance. RTP ${(RTP * 100).toFixed(0)}%.`}
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Scales" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              {RULE} When all the beads are in, the difference between the pans decides your bet: Left heavier, Right heavier, Balanced (within 1), or Left
              heavier by at least k.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose how many beads drop (8 to 20) and what to back, then press Bet. The first bead drops straight away.</li>
              <li>After every bead you can cash out (C) or drop the next one (Space).</li>
              <li>Your bet settles the moment the result can no longer change, so a runaway lead can end the round early.</li>
              <li>Auto plays whole rounds with the bet and stop rules you set, cashing out once the cash-out reaches your target (or playing to the end).</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The beam tilts with the lead. The strip at the bottom is every possible final difference with its exact chance; your winning region is shaded
              and its <b style={{ color: 'var(--green)' }}>green bars</b> add up to your chance. The ▲ marks where the difference stands now. The twelve cells
              show your chance after each possible next bead (left or right, weight 1 to 6). Each happens 1 time in 12, so they average to your chance now.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Each bead moves the difference by X, uniform on ±1…±6. With m beads to go the final difference is D + X<sub>1</sub> + … + X<sub>m</sub>, whose law
              is the m-fold convolution of X, computed exactly by dynamic programming. Your chance is the sum of that law over your region. By the law of total
              probability, P(win | D, m) = (1/12)·Σ<sub>x</sub> P(win | D + x, m − 1): a martingale.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A bet with chance P pays {(RTP * 100).toFixed(0)}% ÷ P. The cash-out is the prize × your chance now, a martingale, so cashing out at any point or
              playing to the end returns exactly {(RTP * 100).toFixed(0)}% in the long run. Margins are offered while the prize stays within {fmtMult(MAX_PRIZE)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
