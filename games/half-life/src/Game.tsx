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
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Chamber, { type DecayMark, type Outcome, type Phase } from './Board';
import { COMPACT, VIEW_H, WIDE } from './layout';
import {
  COUNTS,
  HALF_LIFE_BASE,
  MAX_MULTIPLIER,
  RTP,
  afterDecay,
  atomsIn,
  fullMask,
  halfLifeLabel,
  has,
  headline,
  lastChance,
  nextChance,
  prizeFor,
  sampleDecay,
  switchPrize,
  totalRate,
  volatilityOf,
  type Count,
} from './math';

const ACCENT = '#caffbf';

interface Round {
  k: Count;
  backed: number;
  stake: number;
  /** Locked at the bet (RTP / P(last)); re-priced on a switch so the cash-out is kept. */
  prize: number;
  mask: number;
  decays: DecayMark[];
  /** Lab minute of the latest decay. */
  t: number;
  cash: number;
  outcome: Outcome | null;
}

const OUTCOME_TITLE: Record<Outcome, string> = {
  decayed: 'Your atom decayed',
  last: 'Last one standing',
  cashed: 'Cashed out',
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Drives the lab clock smoothly between two decays. */
function useClock() {
  const [clock, setClock] = useState(0);
  const raf = useRef<number | null>(null);
  const stop = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  };
  useEffect(() => stop, []);
  const run = (t0: number, t1: number, ms: number) => {
    stop();
    const begin = performance.now();
    const tick = (at: number) => {
      const f = Math.min(1, (at - begin) / Math.max(1, ms));
      setClock(t0 + (t1 - t0) * f);
      raf.current = f < 1 ? requestAnimationFrame(tick) : null;
    };
    raf.current = requestAnimationFrame(tick);
  };
  const set = (t: number) => {
    stop();
    setClock(t);
  };
  return { clock, run, set };
}

/** Narrow boards switch to the compact layout (measured on the board area, so it can't oscillate). */
function useCompact(threshold: number) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const area = el?.parentElement;
    if (!area) return;
    const ro = new ResizeObserver(([e]) => setCompact(e.contentRect.width < threshold));
    ro.observe(area);
    return () => ro.disconnect();
  }, [el, threshold]);
  return [compact, setEl] as const;
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const clock = useClock();
  const [history, pushHistory] = useHistory();
  const [compact, frameRef] = useCompact(520);

  const [k, setK] = useState<Count>(5);
  const [atom, setAtom] = useState(2);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const busy = useRef(false);

  // The next decay is decided the moment the clock starts, so leaving
  // mid-animation settles at its real result, never at the pre-decay value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'running' ? resolved.current : (round?.cash ?? 0)));

  const speed = turbo.turbo ? 0.25 : 1;
  const burstMs = Math.round(560 * speed);
  const live = phase === 'running' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    busy.current = false;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  /** Run the clock to the next decay, then checkpoint or settle. */
  function step(r: Round) {
    if (busy.current) return;
    busy.current = true;
    const d = sampleDecay(r.mask, rng);
    const res = afterDecay(r.prize, r.mask, r.backed, d.atom);
    resolved.current = res.cash;
    const t1 = r.t + d.dt;
    // Waits are Exp(1) in units of the mean wait; long waits fast-forward.
    const w = (d.dt * totalRate(r.mask) * Math.LN2) / HALF_LIFE_BASE;
    const waitMs = Math.round((380 + 430 * Math.min(w, 3)) * speed);
    setPhase('running');
    clock.run(r.t, t1, waitMs);
    timers.after(waitMs, () => {
      clock.set(t1);
      const next: Round = {
        ...r,
        mask: res.mask,
        decays: [...r.decays, { atom: d.atom, t: t1 }],
        t: t1,
        cash: res.cash,
      };
      setRound(next);
      timers.after(burstMs, () => {
        if (res.outcome) return finish(next, res.outcome, res.cash);
        busy.current = false;
        setPhase('checkpoint');
        track({
          type: 'checkpoint',
          multiplier: res.cash,
          winChance: lastChance(res.mask, r.backed),
        });
      });
    });
  }

  async function start() {
    if (live || bet.blocked || busy.current) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = {
      k,
      backed: atom,
      stake: bet.value,
      prize: prizeFor(k, atom),
      mask: fullMask(k),
      decays: [],
      t: 0,
      cash: RTP,
      outcome: null,
    };
    clock.set(0);
    setRound(r);
    step(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round || busy.current) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    busy.current = false;
    clock.set(0);
    setRound(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (live) return;
    apply();
    if (phase === 'over') clear();
  };

  /** Idle: back this atom. Checkpoint: switch to it, keeping the cash-out. */
  function pick(a: number) {
    if (phase === 'checkpoint' && round && !busy.current) {
      if (!has(round.mask, a) || a === round.backed) return;
      setRound({
        ...round,
        backed: a,
        prize: switchPrize(round.cash, round.mask, a),
      });
      setAtom(a);
      return;
    }
    change(() => setAtom(a));
  }

  const pickCount = (n: Count) =>
    change(() => {
      setK(n);
      setAtom((a) => Math.min(a, n));
    });

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? step(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const shownK = round?.k ?? k;
  const backed = round?.backed ?? atom;
  const mask = round?.mask ?? fullMask(k);
  const alive = atomsIn(mask);
  const p = round ? lastChance(mask, backed) : headline(k, atom);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const prize = round?.prize ?? prizeFor(k, atom);
  const q = nextChance(mask, backed);
  const vol = volatilityOf(k, atom);
  const yours = `${halfLifeLabel(backed)}-min`;
  const now = round ? clock.clock : 0;

  let status = `Ready · ${shownK} atoms · back the ${yours} atom`;
  if (phase === 'running') status = `Clock running · ${plural(alive.length, 'atom')} left`;
  if (phase === 'checkpoint') status = `Checkpoint · ${round?.decays.length} decayed · ${alive.length} left`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${round.t.toFixed(1)} min`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const rivals = alive.filter((a) => a !== backed).length;
  const chanceSub =
    phase === 'over'
      ? round?.outcome === 'last'
        ? 'yours was last'
        : round?.outcome === 'decayed'
          ? 'yours decayed'
          : `when you cashed out`
      : live
        ? `outlast ${plural(rivals, 'rival')}`
        : `outlast ${plural(shownK - 1, 'rival')}`;
  const shownChance = phase === 'over' && round?.outcome === 'last' ? 1 : phase === 'over' && round?.outcome === 'decayed' ? 0 : p;

  return (
    <GameLayout
      name="Half-Life"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Atoms in the chamber</Label>
          <Chips label="Atoms in the chamber" options={COUNTS.map((v) => ({ value: v, label: v }))} value={k} disabled={live} onChange={pickCount} />

          <Label hint={phase === 'checkpoint' ? 'switch keeps your cash-out' : 'half-life, minutes'}>Your atom</Label>
          <Chips
            label="Your atom"
            options={Array.from({ length: shownK }, (_, i) => ({
              value: i + 1,
              label: halfLifeLabel(i + 1),
              title: `${halfLifeLabel(i + 1)}-minute half-life`,
              disabled: phase === 'checkpoint' && !has(mask, i + 1),
            }))}
            value={backed}
            disabled={phase === 'running'}
            onChange={pick}
          />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(live ? p : headline(k, atom))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(live ? prize : prizeFor(k, atom))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && step(round)}>
                Next decay · {fmtChance(1 - q)} safe
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'running' ? 'Clock running…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            value: fmtChance(shownChance),
            sub: chanceSub,
            tone: 'chance',
          },
          {
            label: 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : `starts at ${fmtMult(RTP)}`,
            tone: 'cash',
          },
          {
            label: 'Prize',
            value: fmtMult(prize),
            sub: `if the ${yours} atom is last`,
            tone: 'prize',
          },
        ]}
      />

      <Board className="hl-board">
        <div ref={frameRef} className="hl-frame" style={{ '--ar': (compact ? COMPACT : WIDE).viewW / VIEW_H } as CSSProperties}>
          <Chamber
            k={shownK}
            mask={mask}
            backed={backed}
            decays={round?.decays ?? []}
            now={now}
            phase={phase}
            outcome={round?.outcome ?? null}
            value={round ? cash : RTP}
            prize={prize}
            burstMs={burstMs}
            compact={compact}
            onPick={pick}
          />
          {phase === 'over' && round?.outcome && (
            <div className="hl-result">
              <RoundOver
                key={history[0]?.id}
                title={OUTCOME_TITLE[round.outcome]}
                multiplier={round.cash}
                stake={round.stake}
                nextBet={bet.value}
                blocked={bet.blocked}
                onBetAgain={() => void start()}
                onClear={clear}
                placement="inline"
              />
            </div>
          )}
        </div>
      </Board>

      {live ? (
        <ChanceBar
          p={p}
          label={`Your ${yours} atom decays last`}
          note="Memoryless: while the clock runs nothing changes. Only a decay moves the odds."
        />
      ) : (
        <Caption>
          {phase === 'over' ? 'Next round: back' : 'Back'} one of {k} atoms to be the last to decay. The {halfLifeLabel(atom)}-min atom outlasts the rest{' '}
          {fmtChance(headline(k, atom))} of the time, so it pays {fmtMult(prizeFor(k, atom))}. Tap a row to pick another. RTP {(RTP * 100).toFixed(0)}
          %.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Half-Life" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A chamber holds 3 to 7 unstable atoms, each with its own half-life: 60, 30, 20, 15, 12, 10 and 8.6 minutes. Back one atom. If every
              other atom decays before yours, you win the prize.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>
                Choose how many atoms and which one is yours (tap its row or its chip). Slow atoms are favourites and pay less; fast ones are long
                shots.
              </li>
              <li>Bet. The lab clock runs until the next atom decays.</li>
              <li>
                After each decay you can cash out, run the clock to the next decay (Space), or switch to another surviving atom. Switching keeps your
                cash-out exactly and re-prices the prize.
              </li>
              <li>If your atom decays, the round is lost. Once it is the only atom left, the prize pays automatically.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The <b style={{ color: 'var(--green)' }}>bars on the right</b> are each atom's chance to be the last one left; yours is green. Together
              they always make 100%.
            </p>
            <p>
              The bar at the bottom is the race for the <b>next</b> decay: each surviving atom owns a slice sized by its decay rate (1 / half-life).
              The <b style={{ color: 'var(--red)' }}>red slice</b> is the chance the next atom to go is yours.
            </p>
            <p>
              The shape trailing each atom is its survival curve: its height halves every half-life (the ticks). It slides along with the clock
              without changing shape. That is memorylessness: an atom that has waited an hour is exactly as good as new.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Exponential races. Atom i decays after an exponential time with rate λ<sub>i</sub> = ln 2 / T½<sub>i</sub>. Among the survivors A, the
              next to decay is atom i with chance λ<sub>i</sub> / λ<sub>A</sub>, however long you have already waited, and afterwards the survivors
              are as good as new. So your chance to be last only changes at a decay:
            </p>
            <p>
              P(j last | A) = Σ<sub>i ≠ j</sub> (λ<sub>i</sub> / λ<sub>A</sub>) · P(j last | A ∖ i), or in closed form P(j last) = Σ
              <sub>S ⊆ others</sub> (−1)
              <sup>|S|</sup> λ<sub>j</sub> / (λ<sub>j</sub> + λ<sub>S</sub>).
            </p>
            <p>With three atoms the 60-minute atom is last 7/12 of the time; with seven, the 8.6-minute atom is last only 1.65% of the time.</p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is fixed when you bet: {(RTP * 100).toFixed(0)}% ÷ P(your atom is last). At every checkpoint the cash-out is prize × your
              current chance. Each decay is a fair bet, so the cash-out is a martingale, and every way of playing (when you stop, whether and when you
              switch) returns exactly {(RTP * 100).toFixed(0)}%. A switch keeps the cash-out and re-locks the prize at cash-out ÷ P(new atom is last).
              The largest possible payout is {fmtMult(MAX_MULTIPLIER)}: the 8.6-minute atom outlasting six others.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
