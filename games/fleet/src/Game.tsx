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
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import Fleet from './Board';
import { KS, MAX_MULTIPLIER, ROCKETS, RTP, TOP, cashOut as cashValue, crashFrom, flyingAt, fmtX, prize, startChance, volatilityOf, winChance, type K } from './math';

const CLIMB_MS = 4500; // 1x to 2x in Manual, linear in height (the chance rises steadily)
const CLIMB_TURBO_MS = 1125;

type Phase = 'idle' | 'live' | 'over';
type Outcome = 'win' | 'lost' | 'cashed';

interface Flight {
  id: number;
  k: K;
  stake: number;
  auto: boolean;
  /** Crash point of each lane, drawn when the bet was placed. */
  crashes: number[];
  /** Lanes that crash before 2x, in order. */
  order: number[];
  idx: number;
  m: number;
  /** Rockets flying right now. */
  a: number;
  mode: 'climb' | 'pause' | 'over';
  lane: number;
  pauseLeft: number;
  pauseMs: number;
  climbMs: number;
  last: number;
  down: (number | null)[];
  drop: number[];
  outcome: Outcome | null;
  payout: number;
}

const MAX_DT = 100;

/** Moves the flight forward by dt ms: climb, pause at a crash, end. */
function advance(f: Flight, dt: number) {
  while (dt > 0 && f.mode !== 'over') {
    if (f.mode === 'pause') {
      const use = Math.min(dt, f.pauseLeft);
      f.pauseLeft -= use;
      dt -= use;
      f.drop[f.lane] = 1 - f.pauseLeft / f.pauseMs;
      if (f.pauseLeft <= 0) {
        f.drop[f.lane] = 1;
        if (f.a < f.k) {
          f.mode = 'over';
          f.outcome = 'lost';
          f.payout = 0;
        } else f.mode = 'climb';
      }
    } else {
      const next = f.idx < f.order.length ? f.crashes[f.order[f.idx]] : TOP;
      const need = (next - f.m) * f.climbMs;
      if (dt < need) {
        f.m += dt / f.climbMs;
        dt = 0;
      } else {
        dt -= need;
        f.m = next;
        if (f.idx < f.order.length) {
          f.lane = f.order[f.idx++];
          f.a--;
          f.down[f.lane] = next;
          f.mode = 'pause';
          f.pauseLeft = f.pauseMs;
        } else {
          f.mode = 'over';
          f.outcome = 'win';
          f.payout = prize(f.k);
        }
      }
    }
  }
}

/** The true value right now, without moving the flight (for leaving mid-round). */
function valueNow(f: Flight | null, now: number): number {
  if (!f) return 0;
  if (f.mode === 'over') return f.payout;
  if (f.mode === 'pause') return cashValue(f.a, f.m, f.k);
  const m = Math.min(TOP, f.m + Math.min(now - f.last, MAX_DT) / f.climbMs);
  if (m >= TOP) return flyingAt(f.crashes, TOP - 1e-12) >= f.k ? prize(f.k) : 0;
  return cashValue(flyingAt(f.crashes, m), m, f.k);
}

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const [history, pushHistory] = useHistory(14);

  const [k, setK] = useState<K>(3);
  const [phase, setPhase] = useState<Phase>('idle');
  const [, setFrame] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);

  const flight = useRef<Flight | null>(null);
  const raf = useRef(0);
  const done = useRef<((m: number) => void) | null>(null);
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
      cancelAnimationFrame(raf.current);
    },
    [],
  );

  // The crash points are drawn the moment the bet is placed, so leaving at any
  // instant settles at the exact value of the state the player has reached
  // (a crash that has passed is already counted). It reads the flight ref.
  const ticket = useTicket(() => valueNow(flight.current, performance.now()));

  function finish(f: Flight) {
    cancelAnimationFrame(raf.current);
    ticket.settle(f.payout);
    pushHistory(f.payout);
    setPhase('over');
    setFrame((x) => x + 1);
    const resolve = done.current;
    done.current = null;
    if (resolve) window.setTimeout(() => resolve(f.payout), f.auto ? eventMs(true) : 0);
  }

  function loop() {
    const f = flight.current;
    if (!f || !alive.current || f.mode === 'over') return;
    const now = performance.now();
    const dt = Math.min(now - f.last, MAX_DT);
    f.last = now;
    advance(f, dt);
    if ((f.mode as Flight['mode']) === 'over') return finish(f);
    setFrame((x) => x + 1);
    raf.current = requestAnimationFrame(loop);
  }

  async function launch(stake: number, isAuto: boolean): Promise<number | null> {
    const cur = flight.current;
    if (cur && cur.mode !== 'over') return null;
    if (!(await ticket.place(stake))) return null;
    const crashes = Array.from({ length: ROCKETS }, () => crashFrom(rng.next()));
    const order = crashes
      .map((c, i) => [c, i] as const)
      .filter(([c]) => c < TOP)
      .sort((x, y) => x[0] - y[0])
      .map(([, i]) => i);
    const fast = turbo.turbo || isAuto;
    const f: Flight = {
      id: ++seq.current,
      k,
      stake,
      auto: isAuto,
      crashes,
      order,
      idx: 0,
      m: 1,
      a: ROCKETS,
      mode: 'climb',
      lane: 0,
      pauseLeft: 0,
      pauseMs: eventMs(fast),
      climbMs: fast ? CLIMB_TURBO_MS : CLIMB_MS,
      last: performance.now(),
      down: Array(ROCKETS).fill(null),
      drop: Array(ROCKETS).fill(0),
      outcome: null,
      payout: 0,
    };
    flight.current = f;
    setPhase('live');
    cancelAnimationFrame(raf.current);
    const result = new Promise<number>((res) => (done.current = res));
    raf.current = requestAnimationFrame(loop);
    return result;
  }

  function cashOut() {
    const f = flight.current;
    if (!f || f.auto || f.mode !== 'climb') return;
    const now = performance.now();
    advance(f, Math.min(now - f.last, MAX_DT));
    f.last = now;
    if ((f.mode as Flight['mode']) !== 'climb') return; // a crash or the end got there first
    f.mode = 'over';
    f.outcome = 'cashed';
    f.payout = cashValue(f.a, f.m, f.k);
    finish(f);
  }

  const auto = useAutoBet({ bet, play: (stake) => launch(stake, true), turbo: turbo.turbo });

  const f = flight.current;
  const flying = phase === 'live';
  const lock = flying || auto.running;

  function clear() {
    if (flying) return;
    flight.current = null;
    setPhase('idle');
  }
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };
  const mode = auto.mode;
  const lastMode = useRef(mode);
  useEffect(() => {
    if (lastMode.current !== mode && phase === 'over') clear();
    lastMode.current = mode;
  });

  useHotkeys(
    {
      space: () => {
        if (mode === 'auto') {
          if (auto.running) auto.stop();
          else if (!bet.blocked && !flying) auto.start();
          return;
        }
        if (flying) cashOut();
        else if (!bet.blocked) void launch(bet.value, false);
      },
      cashOut: () => mode === 'manual' && cashOut(),
    },
    !infoOpen,
  );

  const shown = phase === 'idle' ? null : f;
  const kk = shown?.k ?? k;
  const m = shown?.m ?? 1;
  const a = shown?.a ?? ROCKETS;
  const stake = shown?.stake ?? bet.value;
  const p =
    shown?.mode === 'over' && shown.outcome === 'lost' ? 0 : shown?.mode === 'over' && shown.outcome === 'win' ? 1 : winChance(a, m, kk);
  const cashNow = cashValue(a, m, kk);
  const canCash = !!shown && shown.mode === 'climb' && !shown.auto;

  let status = `Need ${kk} of ${ROCKETS} at 2×`;
  let tone: 'idle' | 'live' | 'won' | 'lost' = 'idle';
  if (shown) {
    if (shown.mode === 'pause') {
      status = `Rocket ${shown.lane + 1} crashed at ${fmtX(shown.crashes[shown.lane])}`;
      tone = 'live';
    } else if (shown.mode === 'climb') {
      status = `${a} flying, need ${kk}`;
      tone = 'live';
    } else if (shown.outcome === 'win') {
      status = `${a} made it: win`;
      tone = 'won';
    } else if (shown.outcome === 'cashed') {
      status = `Cashed out at ${fmtX(m)}`;
      tone = 'won';
    } else {
      status = `${a} left, need ${kk}: lost`;
      tone = 'lost';
    }
  }
  const barTone = shown?.mode === 'over' ? (shown.payout > 0 ? 'won' : 'lost') : shown ? 'live' : 'idle';

  return (
    <GameLayout
      name="Fleet"
      accent={ACCENTS.sky}
      panel={
        <>
          <ModeTabs auto={auto} disabled={flying} />
          <BetField bet={bet} disabled={lock} />

          <Label hint={<VolBadge level={volatilityOf(k)} />}>Rockets needed</Label>
          <Chips
            label="Rockets needed"
            options={KS.map((v) => ({ value: v, label: v }))}
            value={k}
            disabled={lock}
            onChange={(v) => change(() => setK(v))}
          />

          {mode === 'manual' ? (
            flying ? (
              <ActionButton kind="cash" disabled={!canCash} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cashNow, 2)}</span>
              </ActionButton>
            ) : (
              <ActionButton disabled={!!bet.blocked} onClick={() => void launch(bet.value, false)}>
                {phase === 'over' ? 'Bet again' : 'Bet'}
              </ActionButton>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked} />
          )}
          {bet.blocked && !flying && <p className="fleet-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Win chance', value: fmtChance(p), tone: 'chance' },
          { label: 'Prize', value: fmtMult(prize(kk)), tone: 'prize' },
        ]}
      />
      <div className={`og-chance ${barTone}`} role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={p} aria-label="Win chance">
        <div className="og-chance-track">
          <i style={{ width: `${p * 100}%` }} />
        </div>
      </div>

      <Board>
        {shown && shown.mode === 'over' && shown.auto && <InstantResult multiplier={shown.payout} stake={shown.stake} id={shown.id} />}
        <Fleet m={m} down={shown?.down ?? Array(ROCKETS).fill(null)} drop={shown?.drop ?? Array(ROCKETS).fill(0)} won={shown?.outcome === 'win'} />
      </Board>

      {phase === 'over' && shown && !shown.auto && (
        <RoundOver
          key={shown.id}
          title={shown.outcome === 'win' ? `${a} made it` : shown.outcome === 'cashed' ? 'Cashed out' : 'Fleet down'}
          multiplier={shown.payout}
          stake={shown.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void launch(bet.value, false)}
          onClear={clear}
          placement="inline"
        />
      )}
      <Caption>{`Five rockets climb; win if at least ${kk} reach 2×.`}</Caption>

      {infoOpen && (
        <InfoModal title="Fleet" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Five rockets climb together from 1× to 2×. Win if at least the number you chose are still flying when the climb reaches 2×.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many rockets you need, then bet (Space).</li>
              <li>Each rocket crashes at its own random height. A crash pauses the climb, and a red × stays where it fell.</li>
              <li>Cash out (Space or C) any time the climb is moving, or let it ride. If fewer than your number are left, the round is lost.</li>
              <li>Auto mode plays every round to 2× with your stake and stop rules.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The axis is linear from 0× to 2×. A flying rocket&apos;s height as a share of the axis is its chance to reach 2×, the same for every flying rocket. The
              climb raises that chance and every crash lowers your win chance. The bar is the chance that your whole bet wins.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Each crash point C has P(C ≥ x) = 1/x. A rocket flying at m reaches 2× with chance m/2, independently of the others. With a rockets flying and k
              needed, your win chance is P(Bin(a, m/2) ≥ k). The prize is {(RTP * 100).toFixed(0)}% ÷ P(Bin(5, ½) ≥ k), and the cash-out is the prize × that chance, so it is a
              martingale: no way of playing changes the return.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              RTP is {(RTP * 100).toFixed(0)}% for every choice of k and every cash-out rule. Prizes run from {fmtMult(prize(2))} (2 of 5, {fmtChance(startChance(2))}) to{' '}
              {fmtMult(MAX_MULTIPLIER)} (5 of 5, {fmtChance(startChance(5))}). Crash points are drawn when the bet is placed; leaving mid-round settles at the cash-out value at that moment.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
