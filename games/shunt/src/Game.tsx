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
import { useRef, useState } from 'react';
import Field, { type View } from './Board';
import {
  CARS,
  RTP,
  allOrders,
  arrive,
  cashOf,
  clearChance,
  clearingOrders,
  initialYard,
  isCleared,
  nextRisk,
  prizeOf,
  startChance,
  topOf,
  volatilityOf,
  type Cars,
  type Yard,
} from './math';

type Phase = 'idle' | 'moving' | 'checkpoint' | 'over';
type Outcome = 'jam' | 'cashed' | 'clear';

interface Round {
  id: number;
  n: Cars;
  stake: number;
  yard: Yard;
  cash: number;
  outcome: Outcome | null;
}

const OUTCOME_TITLE: Record<Outcome, string> = { jam: 'Siding jammed', cashed: 'Cashed out', clear: 'All cars out in order' };

/** The board frames for one arrival: in along the main line, then each move the greedy rule makes. */
function framesFor(y: Yard, car: number): View[] {
  const rest = y.rest.filter((c) => c !== car);
  const frames: View[] = [
    { yard: { ...y, rest }, fly: { car, at: 'entry' } },
    { yard: { ...y, rest }, fly: { car, at: 'junction' } },
  ];
  const stack = [...y.stack];
  const out = [...y.out];
  for (const m of arrive(y, car).moves) {
    if (m.kind === 'jam') frames.push({ yard: { ...y, rest, stack: [...stack], out: [...out], jammed: car }, fly: null });
    else if (m.kind === 'exit') {
      out.push(m.car);
      frames.push({ yard: { ...y, rest, stack: [...stack], out: [...out] }, fly: null });
    } else if (m.kind === 'push') {
      stack.push(m.car);
      frames.push({ yard: { ...y, rest, stack: [...stack], out: [...out] }, fly: null });
    } else {
      stack.pop();
      frames.push({ yard: { ...y, rest, stack: [...stack], out: [...out] }, fly: { car: m.car, at: 'junction' } });
      out.push(m.car);
      frames.push({ yard: { ...y, rest, stack: [...stack], out: [...out] }, fly: null });
    }
  }
  return frames;
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [n, setN] = useState<Cars>(6);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [auto, setAuto] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const roundSeq = useRef(0);

  // The arriving car is drawn the moment the step starts, so leaving
  // mid-animation settles at its real result, never at the pre-step value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'moving' ? resolved.current : round?.cash ?? 0));

  const legMs = turbo.turbo ? 80 : 320;
  const live = phase === 'moving' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setAuto(false);
    setPhase('over');
  }

  function step(r: Round) {
    const car = r.yard.rest[rng.int(r.yard.rest.length)];
    const { yard } = arrive(r.yard, car);
    const jam = yard.jammed !== null;
    const cash = jam ? 0 : cashOf(yard);
    resolved.current = cash;
    setPhase('moving');
    const frames = framesFor(r.yard, car);
    // A short first beat lets a fresh board paint before the car sets off.
    frames.forEach((f, i) => timers.after(30 + i * legMs, () => setView(f)));
    timers.after(30 + frames.length * legMs, () => {
      const next = { ...r, yard, cash };
      if (jam) return finish(next, 'jam', 0);
      if (isCleared(yard)) return finish(next, 'clear', cash);
      setRound(next);
      // Only cars that can't jam are left: the clear is certain, so roll them in.
      if (clearChance(yard) === 1) {
        setAuto(true);
        return step(next);
      }
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: clearChance(yard) });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { id: ++roundSeq.current, n, stake: bet.value, yard: initialYard(n), cash: RTP, outcome: null };
    setRound(r);
    setAuto(false);
    setView({ yard: r.yard, fly: null });
    step(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    roundSeq.current++;
    setRound(null);
    setView(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? step(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const cars = round?.n ?? n;
  const yard = round?.yard ?? initialYard(n);
  const shown: View = view && round ? view : { yard: initialYard(n), fly: null };
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const prize = prizeOf(cars);
  const p = clearChance(yard);
  const q = nextRisk(yard);
  const arrived = cars - yard.rest.length;
  const vol = volatilityOf(n);

  let status = `Ready · ${cars} cars, one siding`;
  if (phase === 'moving') status = auto ? 'Last cars are safe · rolling in' : `Car ${arrived + 1} of ${cars} arriving`;
  if (phase === 'checkpoint') status = `Checkpoint · ${arrived} of ${cars} arrived, ${yard.out.length} out`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${yard.out.length} of ${cars} out`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';
  const top = topOf(yard);

  return (
    <GameLayout
      name="Shunt"
      accent="#a2d2ff"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Cars in the train</Label>
          <Chips label="Cars in the train" options={CARS.map((v) => ({ value: v, label: v }))} value={n} disabled={live} onChange={(v) => change(() => setN(v))} />

          <dl className="og-stats">
            <dt>Chance to clear</dt>
            <dd>{fmtChance(startChance(n))}</dd>
            <dt>Clear prize</dt>
            <dd>{fmtMult(prizeOf(n))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && step(round)}>
                Next car {q === 0 ? '· safe' : `· ${fmtChance(1 - q)} safe`}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'moving' ? 'Shunting…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            label: 'Chance to clear',
            value: phase === 'over' ? (round?.outcome === 'jam' ? '0%' : round?.outcome === 'clear' ? '100%' : fmtChance(p)) : fmtChance(p),
            sub: live ? `${clearingOrders(yard).toLocaleString('en-US')} of ${allOrders(yard).toLocaleString('en-US')} orders` : `Catalan(${cars}) / ${cars}!`,
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: formatAmount(stake * cash, 2), tone: 'cash' },
          { label: 'Clear prize', value: fmtMult(prize), sub: `all ${cars} out in order`, tone: 'prize' },
        ]}
      />

      <Board className="shunt-board">
        <Field view={shown} roundKey={round?.id ?? 0} legMs={legMs} live={live} over={phase === 'over'} />
        {phase === 'over' && round?.outcome && (
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
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={1 - q}
          label="Next car is safe"
          note={top === null ? 'The siding is empty, so no car can jam it next.' : `Red cars are bigger than ${top}, the siding's top car: any of them arriving next jams it.`}
        />
      ) : (
        <Caption>
          Cars 1–{cars} arrive in random order and must leave 1, 2, 3… through one last-in-first-out siding. Knuth: only orders with no 2-3-1 pattern get
          through, Catalan({cars}) of {cars}! = {fmtChance(startChance(cars))}. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Shunt" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>A train of numbered cars arrives in random order. Get every car out of the yard in the order 1, 2, 3, … using one dead-end siding.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many cars are in the train, then bet. The first car rolls in straight away.</li>
              <li>
                The switchman follows one rule: a car that is next in line drives straight out; any other car backs into the siding; whenever the siding's top
                car is next in line, it leaves.
              </li>
              <li>After each car you can cash out, or call the next car (Space). If a car would have to sit on top of a smaller car, the siding jams and the round is lost. Get every car out and the prize pays automatically.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The siding is last in, first out, so its cars must sit smallest on top. The cars still to come that are bigger than the top car are drawn{' '}
              <b style={{ color: 'var(--red)' }}>red</b>: any of them arriving next jams the siding. The next car is equally likely to be any car still to
              come, so red cars ÷ cars still to come is exactly the chance the next car jams.
            </p>
            <p>"Chance to clear" counts the arrival orders of the remaining cars that still get everyone out, out of all of them.</p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Knuth's stack-sorting theorem: an arrival order gets through one siding exactly when it has no 2-3-1 pattern (three cars b, c, a arriving in that
              order with a &lt; b &lt; c). There are Catalan(n) = (2n)! / (n!(n+1)!) such orders out of n!, so a fresh train clears with chance Catalan(n) / n!
              (58% for 4 cars, 1.3% for 9).
            </p>
            <p>
              Mid-round, the siding's cars cut the cars still to come into blocks. Each block must arrive in full, lowest block first, and in a sortable order,
              so exactly ∏ Catalan(block size) of the m! remaining orders clear.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A full clear pays {(RTP * 100).toFixed(0)}% × n! / Catalan(n). Cashing out pays that prize times the exact chance to clear from where you are.
              That value is a fair price at every moment, so the round is worth {(RTP * 100).toFixed(0)}% of your stake whenever you cash out.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
