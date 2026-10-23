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
import Field, { type Anim } from './Board';
import {
  BLINDS,
  CUPS,
  MAX_WIN,
  MOVES,
  RTP,
  applyMove,
  canSwitch,
  drawMove,
  finalChances,
  moveBall,
  nextOdds,
  schedule,
  startBelief,
  startChances,
  volatilityOf,
  type Blinds,
  type Cups,
} from './math';

type Phase = 'idle' | 'moving' | 'checkpoint' | 'revealing' | 'over';
type Outcome = 'found' | 'missed' | 'gone' | 'cashed';

interface Round {
  cups: Cups;
  sched: boolean[];
  stake: number;
  belief: number[];
  done: number;
  /** The real ball (hidden until the reveal). */
  ball: number;
  slot: number;
  prize: number;
  /** The ball is showing (its cup has been lifted). */
  revealed: boolean;
  /** Cups lifted so far in the reveal. */
  lifted: boolean[];
  outcome: Outcome | null;
  payout: number;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const OUTCOME_TITLE: Record<Outcome, string> = { found: 'Found it', missed: 'Not under your cup', gone: 'Out of reach', cashed: 'Cashed out' };
const RULE = 'Follow the ball under the cups and back the cup it ends under; blind swaps blur where it is.';
const TARGETS = [0, 1.5, 2, 3, 5] as const;

const chancesOf = (r: Round) => finalChances(r.belief, r.sched, r.done);
const valueOf = (r: Round) => r.prize * chancesOf(r)[r.slot];
/** During the reveal: where the ball is, given the cups lifted so far came up empty. */
const conditioned = (r: Round) => {
  const left = r.belief.reduce((s, b, i) => (r.lifted[i] ? s : s + b), 0);
  return r.belief.map((b, i) => (r.lifted[i] || left <= 0 ? 0 : b / left));
};

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [cups, setCups] = useState<Cups>(4);
  const [blinds, setBlinds] = useState<Blinds>(2);
  const [pick, setPick] = useState(0);
  const [target, setTarget] = useState<number>(0);

  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [anim, setAnim] = useState<Anim | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // A move is decided when it starts, so leaving mid-animation settles at its
  // real result; between moves the bet is worth its fair cash-out.
  const resolved = useRef(0);
  const ticket = useTicket(() =>
    phase === 'moving' || phase === 'revealing' || autoBusy ? resolved.current : phase === 'checkpoint' && round ? valueOf(round) : 0,
  );

  const swapMs = turbo.turbo ? 150 : 560;
  const blindMs = turbo.turbo ? 200 : 820;
  const liftMs = turbo.turbo ? 130 : 460;
  const lastLiftMs = turbo.turbo ? 170 : 700;
  const holdMs = turbo.turbo ? 120 : 420;
  const autoSwapMs = turbo.turbo ? 110 : 360;
  const autoBlindMs = turbo.turbo ? 150 : 520;

  const live = phase === 'moving' || phase === 'checkpoint' || phase === 'revealing';

  // ---------- One round's steps (shared by Manual and Auto) ----------

  function newRound(stake: number): Round {
    const sched = schedule(blinds);
    const slot = Math.min(pick, cups - 1);
    const p0 = finalChances(startBelief(cups), sched, 0)[slot];
    return { cups, sched, stake, belief: startBelief(cups), done: 0, ball: 0, slot, prize: RTP / p0, revealed: false, lifted: Array.from({ length: cups }, () => false), outcome: null, payout: 0 };
  }

  /** Draws and animates one move; resolves to the round after it (or null if interrupted). */
  async function move(r: Round, swapT: number, blindT: number): Promise<Round | null> {
    const blind = r.sched[r.done];
    const { pair, swapped } = drawMove(rng, r.cups, blind);
    const next: Round = { ...r, belief: applyMove(r.belief, pair, blind), ball: moveBall(r.ball, pair, swapped), done: r.done + 1 };
    const v = valueOf(next);
    resolved.current = v;
    const ms = blind ? blindT : swapT;
    setAnim({ id: ++seq.current, pair, blind, ms });
    if (blind) {
      // The belief changes while the cover hides the pair.
      if (!(await timers.wait(ms / 2))) return null;
      setRound(next);
      if (!(await timers.wait(ms / 2))) return null;
    } else {
      if (!(await timers.wait(ms))) return null;
      setRound(next);
    }
    setAnim(null);
    return next;
  }

  function settle(r: Round, outcome: Outcome, payout: number) {
    ticket.settle(payout);
    pushHistory(payout);
    const done = { ...r, outcome, payout, revealed: true, lifted: r.belief.map(() => true) };
    setRound(done);
    return done;
  }

  // ---------- Manual ----------

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setLast(null);
    const r = newRound(bet.value);
    setRound(r);
    void step(r);
  }

  async function step(r: Round) {
    setPhase('moving');
    const next = await move(r, swapMs, blindMs);
    if (!next) return;
    const q = chancesOf(next);
    if (q[next.slot] === 0) return finish(next, next.done >= MOVES ? 'missed' : 'gone', 0);
    if (next.done >= MOVES && q[next.slot] === 1) return void reveal(next);
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: valueOf(next), winChance: q[next.slot] });
  }

  /**
   * The reveal lifts the cups one at a time: the empty ones at once, then each
   * rival that could hold the ball, least likely first, and yours last. Each
   * empty lift raises your chance (the rest renormalise). The result was fixed
   * before the first lift; this is only how it is shown.
   */
  async function reveal(r: Round) {
    const win = r.ball === r.slot;
    resolved.current = win ? r.prize : 0;
    setPhase('revealing');
    let lifted = r.belief.map((b, i) => i !== r.slot && b === 0);
    let cur: Round = { ...r, lifted };
    setRound(cur);
    const rivals = r.belief
      .map((b, i) => ({ b, i }))
      .filter(({ b, i }) => i !== r.slot && b > 0)
      .sort((x, y) => x.b - y.b || x.i - y.i);
    for (const { i } of rivals) {
      if (!(await timers.wait(liftMs))) return;
      lifted = lifted.slice();
      lifted[i] = true;
      cur = { ...cur, lifted, revealed: i === r.ball };
      setRound(cur);
      if (cur.revealed) break;
    }
    if (!cur.revealed) {
      if (!(await timers.wait(lastLiftMs))) return;
      lifted = lifted.slice();
      lifted[r.slot] = true;
      setRound({ ...cur, lifted, revealed: true });
    }
    if (!(await timers.wait(holdMs))) return;
    finish(r, win ? 'found' : 'missed', win ? r.prize : 0);
  }

  function finish(r: Round, outcome: Outcome, payout: number) {
    settle(r, outcome, payout);
    setAnim(null);
    setPhase('over');
  }

  function proceed() {
    if (phase !== 'checkpoint' || !round) return;
    if (round.done >= MOVES) void reveal(round);
    else void step(round);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', valueOf(round));
  }

  function switchTo(t: number) {
    if (phase !== 'checkpoint' || !round || t === round.slot) return;
    const q = chancesOf(round);
    const v = valueOf(round);
    if (!canSwitch(v, q[t])) return;
    setRound({ ...round, slot: t, prize: v / q[t] });
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setAnim(null);
    setLast(null);
    setPhase('idle');
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    if (!(await ticket.place(stake))) return null;
    const tgt = target;
    setAutoBusy(true);
    setPhase('idle');
    setLast(null);
    let r: Round | null = newRound(stake);
    resolved.current = RTP;
    setRound(r);
    let outcome: Outcome | null = null;
    let payout = 0;
    while (r && r.done < MOVES) {
      r = await move(r, autoSwapMs, autoBlindMs);
      if (!r) break;
      const v = valueOf(r);
      if (v === 0) {
        outcome = r.done >= MOVES ? 'missed' : 'gone';
        break;
      }
      if (tgt > 0 && v >= tgt) {
        outcome = 'cashed';
        payout = v;
        break;
      }
    }
    if (!r) {
      // Interrupted (unmounted): the ticket lifecycle settles at the resolved value.
      setAutoBusy(false);
      return null;
    }
    if (!outcome) {
      outcome = r.ball === r.slot ? 'found' : 'missed';
      payout = outcome === 'found' ? r.prize : 0;
    }
    resolved.current = payout;
    settle(r, outcome, payout);
    setLast({ id: ++seq.current, multiplier: payout, stake });
    await timers.wait(turbo.turbo ? 120 : 420);
    setAutoBusy(false);
    return payout;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  const autoLocked = auto.running || autoBusy;

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    timers.clearAll();
    setRound(null);
    setAnim(null);
    setLast(null);
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (live || autoLocked) return;
    apply();
    if (phase === 'over' || round) clear();
  };

  function onPick(i: number) {
    if (phase === 'checkpoint') return switchTo(i);
    if (live || autoLocked || i >= cups) return;
    change(() => setPick(i));
  }

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'checkpoint') proceed();
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // Number keys back (or switch to) a cup.
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= 5) pickRef.current(n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  // ---------- What the board shows ----------

  const preview: Round = round ?? { ...newRound(bet.value), stake: bet.value };
  const view = preview;
  // Once the cups are lifted the answer is known: one bar at 100%.
  const chances = view.revealed
    ? view.belief.map((_, i) => (i === view.ball ? 1 : 0))
    : view.lifted.some(Boolean)
      ? conditioned(view)
      : chancesOf(view);
  const sched = view.sched;
  const slot = view.slot;
  const myChance = chances[slot];
  const value = round ? valueOf(round) : RTP;
  const stake = round?.stake ?? bet.value;
  const over = phase === 'over' || (isAuto && !!round?.outcome);
  const p0 = startChances(cups, blinds)[Math.min(pick, cups - 1)];
  const vol = volatilityOf(p0);

  const prizes = chances.map((q, i) => {
    if (!round) return q > 0 ? RTP / q : null;
    if (i === round.slot) return round.prize;
    if (phase === 'checkpoint' || phase === 'moving') return canSwitch(value, q) ? value / q : null;
    return null;
  });
  const next = !isAuto && (phase === 'checkpoint' || phase === 'idle') && view.done < MOVES ? nextOdds(view.belief, sched, view.done, slot) : null;
  const nextBlind = sched[view.done];

  let status = `Ready · ${view.cups} cups, ${blinds === 0 ? 'no' : blinds} blind swaps`;
  let tone: StatusTone = 'idle';
  if (isAuto && (auto.running || autoBusy)) {
    status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ' · running'} · move ${Math.min(MOVES, view.done + (anim ? 1 : 0))} of ${MOVES}`;
    tone = 'live';
  } else if (phase === 'moving') {
    status = `Move ${view.done + 1} of ${MOVES} · ${anim?.blind ? 'blind swap' : 'swap'}`;
    tone = 'live';
  } else if (phase === 'checkpoint') {
    status = view.done >= MOVES ? 'Shuffle done · reveal or cash out' : `Move ${view.done} of ${MOVES} done · next is ${nextBlind ? 'blind' : 'in sight'}`;
    tone = 'live';
  } else if (phase === 'revealing') {
    status = view.revealed
      ? `Ball under cup ${view.ball + 1}`
      : view.lifted.some(Boolean)
        ? `Lifting the cups · cup ${slot + 1} now ${fmtChance(myChance)}`
        : 'Lifting the cups…';
    tone = 'live';
  } else if (round?.outcome) {
    status = `${OUTCOME_TITLE[round.outcome]} · ball under cup ${round.ball + 1}`;
    tone = round.payout > 0 ? 'won' : 'lost';
  } else if (isAuto) {
    status = `Auto · back cup ${slot + 1}, ${target ? `cash out at ${fmtMult(target)}` : 'play to the reveal'}`;
  }

  const showValue = live || over || autoBusy;
  const readouts: ReadoutItem[] = [
    { label: 'Win chance', value: over ? (round?.outcome === 'found' ? '100%' : '—') : fmtChance(myChance), sub: `cup ${slot + 1} ends with the ball`, tone: 'chance' },
    {
      label: 'Cash out now',
      value: phase === 'revealing' ? '—' : showValue ? fmtMult(over ? round?.payout ?? 0 : value) : '—',
      sub: phase === 'revealing' ? 'cups are lifting' : showValue ? formatAmount(stake * (over ? round?.payout ?? 0 : value), 2) : 'after the first move',
      tone: 'cash',
    },
    { label: 'Prize', value: fmtMult(round?.prize ?? RTP / myChance), sub: `if the ball ends under cup ${slot + 1}`, tone: 'prize' },
  ];

  const settings = (
    <>
      <Label hint={<VolBadge level={vol} />}>Cups</Label>
      <Chips
        label="Cups"
        options={CUPS.map((v) => ({ value: v, label: `${v} cups` }))}
        value={cups}
        disabled={live || autoLocked}
        onChange={(v) => change(() => {
          setCups(v);
          setPick((s) => Math.min(s, v - 1));
        })}
      />
      <Label hint={`of ${MOVES} moves`}>Blind swaps</Label>
      <Chips
        label="Blind swaps"
        options={BLINDS.map((v) => ({ value: v, label: v === 0 ? 'None' : v === MOVES ? `All ${v}` : `${v}` }))}
        value={blinds}
        disabled={live || autoLocked}
        onChange={(v) => change(() => setBlinds(v))}
      />
      <Label hint="or click a cup">Your cup</Label>
      <Chips
        label="Your cup"
        options={Array.from({ length: cups }, (_, i) => ({ value: i, label: `${i + 1}`, title: `${fmtChance(startChances(cups, blinds)[i])} · ${fmtMult(RTP / startChances(cups, blinds)[i])}` }))}
        value={Math.min(pick, cups - 1)}
        disabled={live || autoLocked}
        onChange={(v) => change(() => setPick(v))}
      />
    </>
  );

  const stats = (
    <dl className="og-stats">
      <dt>Chance to win</dt>
      <dd>{fmtChance(p0)}</dd>
      <dt>Prize</dt>
      <dd>{fmtMult(RTP / p0)}</dd>
    </dl>
  );

  return (
    <GameLayout
      name="Shells"
      accent="#f4a261"
      className="sh-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={live || autoLocked} />
          {settings}

          {!isAuto ? (
            <>
              {!live && stats}
              {phase === 'checkpoint' || phase === 'moving' || phase === 'revealing' ? (
                <>
                  <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                    Cash out <span>{formatAmount(stake * value, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={proceed}>
                    {phase === 'moving'
                      ? 'Shuffling…'
                      : phase === 'revealing'
                        ? 'Lifting…'
                        : view.done >= MOVES
                          ? 'Reveal'
                          : `Next move · ${nextBlind ? 'blind' : 'in sight'}`}
                  </ActionButton>
                  <p className="sh-hint">Click another cup to switch to it: the cash-out stays the same and the prize relocks.</p>
                </>
              ) : (
                <ActionButton disabled={!!bet.blocked} onClick={() => void start()}>
                  {phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={target ? 'or the reveal' : 'no cash-out'}>Cash out at</Label>
              <Chips
                label="Cash out at"
                options={TARGETS.map((v) => ({ value: v, label: v === 0 ? 'Reveal' : `${v}×` }))}
                value={target}
                disabled={autoLocked}
                onChange={(v) => change(() => setTarget(v))}
              />
              {stats}
            </AutoBetControls>
          )}
          {bet.blocked && <p className="sh-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className="sh-board">
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Field
          cups={view.cups}
          belief={view.lifted.some(Boolean) && !view.revealed ? chances : view.belief}
          chances={chances}
          slot={slot}
          prizes={prizes}
          next={next}
          sched={sched}
          done={view.done}
          anim={anim}
          reveal={view.revealed ? view.ball : null}
          lifted={view.lifted}
          suspense={phase === 'revealing' && !view.revealed}
          won={view.revealed ? view.ball === view.slot : null}
          pickable={!isAuto && (phase === 'idle' || phase === 'over' || phase === 'checkpoint')}
          onPick={onPick}
        />
        {!isAuto && phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={OUTCOME_TITLE[round.outcome]}
            multiplier={round.payout}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement="bottom"
          />
        )}
      </Board>

      {live || (isAuto && autoBusy) ? (
        <ChanceBar
          p={myChance}
          label={`Ball ends under cup ${slot + 1}`}
          note="Bars are each cup's chance to end with the ball; the white pie in a cup is where the ball is now."
        />
      ) : (
        <Caption>{RULE}</Caption>
      )}

      {infoOpen && (
        <InfoModal title="Shells" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{RULE}</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose 3–5 cups, how many of the {MOVES} moves are blind, and the cup you back (click it). The ball starts under cup 1.</li>
              <li>Bet. The dealer swaps a random pair of neighbouring cups, one move at a time. In-sight swaps you can follow; a blind swap covers the pair, which then swaps or not, 50/50.</li>
              <li>After each move you can cash out, play the next move (Space), or click another cup to switch to it. After the last move, reveal: the other cups lift first, least likely first, and yours last. Each empty cup raises your chance.</li>
              <li>Auto plays whole rounds on the cup you chose, cashing out once the bet is worth your target (or playing to the reveal).</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The <b>white pie</b> in each cup is the chance the ball is under it right now: a full disc when you have followed it, two halves after a blind swap.
              The <b>bar</b> over each cup is the chance the ball ends there once the remaining moves are done; yours is orange. The chips between cups show what your
              chance becomes if that pair is moved next. Each pair is equally likely, so the chips average exactly to your chance now.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              A Markov chain on the cup positions. Let p be where the ball is now. An in-sight swap permutes p; a blind swap replaces the two entries by their average.
              Averaged over the {`n − 1`} equally likely pairs, a move multiplies p by a matrix M (the ball steps to each neighbour with chance 1/(n−1), or half that
              when blind), so the chance cup s ends with the ball is (p · M<sub>next</sub> · … · M<sub>last</sub>)[s], computed exactly.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Backing cup s locks a prize of {(RTP * 100).toFixed(0)}% ÷ P(s). Your cash-out is prize × P(s), and P(s) is a posterior chance, so on average each move leaves it
              unchanged: every cash-out rule returns {(RTP * 100).toFixed(0)}%. Switching keeps the cash-out and relocks the prize at cash-out ÷ P(new cup), so it changes
              how much you can win and how likely, never what the bet is worth. Switches that would lock more than {fmtMult(MAX_WIN)} are not offered.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
