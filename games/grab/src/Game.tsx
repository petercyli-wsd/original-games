import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
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
  eventMs,
  fmtMult,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import Field from './Board';
import { REDS, RTP, WEDGES, cashOf, chanceOf, greens, layout, levelOf, prizeFor, spin, startChance, type Kind, type Reds, type State } from './math';

type Phase = 'idle' | 'spinning' | 'checkpoint' | 'over';
type Outcome = 'won' | 'lost' | 'cashed';

const RULE = 'Grey wedges you land on turn green; land on green twice before red.';
const TITLE: Record<Outcome, string> = { won: 'Two hits: win', lost: 'Red: round lost', cashed: 'Cashed out' };

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [reds, setReds] = useState<Reds>(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [wedges, setWedges] = useState<Kind[]>(() => layout(1));
  const [hits, setHits] = useState(0);
  const [rot, setRot] = useState(0);
  const [landed, setLanded] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [roundStake, setRoundStake] = useState(0);
  const [paid, setPaid] = useState(0);
  const [last, setLast] = useState<Last | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const rotRef = useRef(0);
  const stateRef = useRef<State>({ wedges: layout(1), hits: 0 });
  const redsRef = useRef<Reds>(1);

  // The open ticket's value, set synchronously when the stake is placed and again the moment each
  // spin is drawn (before it animates), so leaving mid-spin settles at the real result.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  const fastRef = useRef(false);
  const spinMs = () => eventMs(fastRef.current);
  const convMs = () => (fastRef.current ? 120 : 450);

  /** Draws and animates one spin. Returns the new state, or null when red ended the round. */
  async function spinOnce(s: State): Promise<{ state: State | null; kind: 'red' | 'hit' | 'grey' }> {
    const i = rng.int(WEDGES);
    const out = spin(s, i);
    const next = out.kind === 'red' ? null : out.state;
    resolved.current = next ? cashOf(next) : 0;
    // Turn the wheel at least two full turns so wedge i ends under the pointer.
    const want = -i * (360 / WEDGES);
    const delta = ((((want - rotRef.current) % 360) + 360) % 360) + 720;
    rotRef.current += delta;
    setLanded(null);
    setNote('Spinning');
    setPhase('spinning');
    setRot(rotRef.current);
    await timers.wait(spinMs());
    setLanded(i);
    if (out.kind === 'grey') {
      setWedges(out.state.wedges);
      setNote(`Grey turned green: ${greens(out.state)} green`);
      await timers.wait(convMs());
    } else if (out.kind === 'hit') {
      setHits(out.state.hits);
      setNote(out.state.hits >= 2 ? TITLE.won : `Green: hit ${out.state.hits} of 2`);
      await timers.wait(convMs());
    } else {
      setNote(TITLE.lost);
      await timers.wait(convMs());
    }
    return { state: next, kind: out.kind };
  }

  function finish(o: Outcome, value: number, stake: number) {
    ticket.settle(value);
    pushHistory(value);
    setOutcome(o);
    setPaid(value);
    setLast({ id: ++seq.current, multiplier: value, stake });
    setNote(TITLE[o]);
    setPhase('over');
  }

  /** The bet: place the stake, show the wheel at rest, then spin. In Manual it stops at a checkpoint. */
  async function play(stake: number, toEnd: boolean): Promise<number | null> {
    if (!(await ticket.place(stake))) return null;
    resolved.current = RTP;
    timers.clearAll();
    const r = redsRef.current;
    const s0: State = { wedges: layout(r), hits: 0 };
    stateRef.current = s0;
    setWedges(s0.wedges);
    setHits(0);
    setLanded(null);
    setOutcome(null);
    setRoundStake(stake);
    setPaid(0);
    setLast(null);
    setNote('Wheel at rest');
    setPhase('spinning');
    await timers.wait(fastRef.current ? 100 : 500);
    return await advance(s0, stake, toEnd);
  }

  async function advance(s: State, stake: number, toEnd: boolean): Promise<number | null> {
    let cur = s;
    for (;;) {
      const { state, kind } = await spinOnce(cur);
      if (state === null) {
        finish('lost', 0, stake);
        return 0;
      }
      cur = state;
      stateRef.current = cur;
      if (kind === 'hit' && cur.hits >= 2) {
        finish('won', cashOf(cur), stake);
        return cashOf(cur);
      }
      if (!toEnd) {
        setPhase('checkpoint');
        return null;
      }
    }
  }

  const auto = useAutoBet({ bet, play: (stake) => play(stake, true), turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  fastRef.current = turbo.turbo || auto.running;
  redsRef.current = reds;
  const live = phase === 'spinning' || phase === 'checkpoint';
  const busy = live || auto.running;

  function start() {
    if (busy || bet.blocked) return;
    void play(bet.value, false);
  }
  function more() {
    if (phase !== 'checkpoint') return;
    void advance(stateRef.current, roundStake, false);
  }
  function cashNow() {
    if (phase !== 'checkpoint') return;
    finish('cashed', cashOf(stateRef.current), roundStake);
  }
  function clear() {
    if (live || auto.running) return;
    timers.clearAll();
    setWedges(layout(reds));
    setHits(0);
    setLanded(null);
    setOutcome(null);
    setNote(null);
    setLast(null);
    setPhase('idle');
  }
  const change = (apply: () => void, r?: Reds) => {
    if (busy) return;
    apply();
    if (r !== undefined) {
      redsRef.current = r;
      setWedges(layout(r));
      setHits(0);
      setLanded(null);
      setOutcome(null);
      setNote(null);
      setLast(null);
      setPhase('idle');
    }
  };

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    timers.clearAll();
    setWedges(layout(redsRef.current));
    setHits(0);
    setLanded(null);
    setOutcome(null);
    setNote(null);
    setLast(null);
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  useHotkeys(
    {
      space: () => (auto.mode !== 'manual' ? undefined : phase === 'checkpoint' ? more() : start()),
      cashOut: cashNow,
    },
    !infoOpen,
  );

  const s: State = { wedges, hits };
  const started = phase !== 'idle';
  const chance = outcome === 'lost' ? 0 : outcome === 'won' ? 1 : started ? chanceOf(s) : startChance(reds);
  const cash = cashOf(s);
  const stake = started ? roundStake : bet.value;

  let status = `${reds} red of 16 wedges`;
  let tone: 'idle' | 'live' | 'won' | 'lost' = 'idle';
  if (live || outcome) status = note ?? status;
  if (live) tone = 'live';
  if (outcome) tone = paid > 0 ? 'won' : 'lost';
  if (isAuto && auto.running) {
    status = `Autobet${auto.remaining !== null ? `: ${auto.remaining} left` : ''}`;
    tone = 'live';
  }

  return (
    <GameLayout
      name="Grab"
      accent={ACCENTS.sky}
      panel={
        <>
          <ModeTabs auto={auto} disabled={live} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={levelOf(reds)} />}>Red wedges</Label>
          <Chips label="Red wedges" options={REDS.map((v) => ({ value: v, label: v }))} value={reds} disabled={busy} onChange={(v) => change(() => setReds(v), v)} />

          {isAuto ? (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || live} />
          ) : phase === 'checkpoint' ? (
            <>
              <ActionButton kind="secondary" onClick={more}>
                Spin
              </ActionButton>
              <ActionButton kind="cash" onClick={cashNow}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={busy || !!bet.blocked} onClick={start}>
              {phase === 'spinning' ? 'Spinning…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <ChanceBar p={chance} label="Win chance" />
      <Readouts
        items={[
          { label: 'Prize', value: fmtMult(prizeFor(reds)), tone: 'prize' },
        ]}
      />

      <Board className="grab-board">
        {isAuto && <InstantResult multiplier={last && !auto.running ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Field
          wedges={wedges}
          rot={rot}
          spinMs={spinMs()}
          convMs={convMs()}
          landed={landed}
          hits={hits}
          label={`Wheel: ${greens(s)} green, ${wedges.filter((k) => k === 'red').length} red, ${hits} of 2 hits`}
        />
      </Board>

      {!isAuto && phase === 'over' && outcome && (
        <RoundOver
          key={history[0]?.id}
          title={TITLE[outcome]}
          multiplier={paid}
          stake={roundStake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={start}
          onClear={clear}
          placement="inline"
        />
      )}
      <Caption>{RULE}</Caption>

      {infoOpen && (
        <InfoModal title="Grab" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{RULE} The wheel has 16 equal wedges.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many wedges are red, then bet. The wheel starts with one green wedge, your red wedges and the rest grey.</li>
              <li>Each spin lands on one wedge. Grey turns green and you can spin again. Green scores a hit and stays green. Red loses.</li>
              <li>Two hits win the prize. After each safe spin you can cash out (C) or spin again (Space).</li>
              <li>Auto plays whole rounds to the end.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Each spin lands on a wedge with chance 1/16, so green, grey and red wedge counts are the next spin's odds. Red wedges never change; green only
              grows. Every grey you land on and every hit raises your chance to win, and the bar shows the chance for the whole bet.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              With g green wedges, h hits and r red: W(g, 2) = 1 and W(g, h) = [g·W(g, h+1) + (16 − g − r)·W(g+1, h)] / 16. Green only grows and hits only
              grow, so this is computed exactly. The prize is {(RTP * 100).toFixed(0)}% ÷ W(1, 0).
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Cash-out = prize × W(g, h). A spin's average cash-out afterwards equals the cash-out now, so every way of playing returns{' '}
              {(RTP * 100).toFixed(0)}% of stakes.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
