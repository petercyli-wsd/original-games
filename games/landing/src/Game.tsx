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
import { useMemo, useRef, useState } from 'react';
import Track from './Board';
import {
  DICE,
  GATE_COUNTS,
  PRESETS,
  RTP,
  applyRoll,
  faceKinds,
  hitChance,
  landingProfile,
  moveGate,
  prizeFor,
  renewalLimit,
  volatilityOf,
  winChance,
  type Die,
  type FaceKind,
  type GateCount,
} from './math';

type Phase = 'idle' | 'rolling' | 'checkpoint' | 'over';
type Outcome = 'bust' | 'cashed' | 'win';

interface Round {
  die: Die;
  gates: readonly number[];
  stake: number;
  prize: number;
  pos: number;
  next: number;
  cash: number;
  landed: number[];
  outcome: Outcome | null;
  /** The gate jumped over, if the round busted. */
  missed: number | null;
}

interface Shown {
  faces: FaceKind[];
  face: number | null;
}

const ACCENT = '#ffadad';

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [die, setDie] = useState<Die>(6);
  const [gates, setGates] = useState<readonly number[]>(PRESETS[2]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [tokenAt, setTokenAt] = useState(0);
  const [roll, setRoll] = useState<Shown | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // A roll is decided the moment it starts, so leaving mid-animation settles
  // at its real result, never at the pre-roll value.
  const resolved = useRef(0);
  // Set synchronously, so a double press can't start two rolls from one state.
  const inFlight = useRef(false);
  const ticket = useTicket(() => (phase === 'rolling' ? resolved.current : round?.cash ?? 0));

  const k = turbo.turbo ? 0.25 : 1;
  const flickMs = Math.round(70 * k);
  const live = phase === 'rolling' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  function doRoll(r: Round) {
    if (inFlight.current) return;
    inFlight.current = true;
    const face = 1 + rng.int(r.die);
    const res = applyRoll(r.gates, r.pos, r.next, face);
    const cash = res.outcome === 'bust' ? 0 : res.outcome === 'win' ? r.prize : r.prize * winChance(r.gates, r.die, res.to, res.next);
    resolved.current = cash;
    const faces = faceKinds(r.gates, r.die, r.pos, r.next);
    setPhase('rolling');

    // The die flickers onto its face, then the token hops square by square.
    const flicks = 4;
    for (let i = 0; i < flicks; i++) timers.after(i * flickMs, () => setRoll({ faces, face: ((face - 1 + flicks - 1 - i) % r.die) + 1 }));
    const hopMs = Math.round(Math.min(120, Math.max(55, 560 / face)) * k);
    const t0 = flicks * flickMs;
    for (let h = 1; h <= face; h++) timers.after(t0 + (h - 1) * hopMs, () => setTokenAt(r.pos + h));
    timers.after(t0 + face * hopMs + Math.round(140 * k), () => {
      inFlight.current = false;
      const moved: Round = { ...r, pos: res.to, next: res.next, cash, landed: [...r.landed, res.to] };
      if (res.outcome === 'bust') return finish({ ...moved, pos: r.pos, next: r.next, missed: r.next }, 'bust', 0);
      if (res.outcome === 'win') return finish(moved, 'win', cash);
      setRound(moved);
      setRoll(null);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: winChance(r.gates, r.die, res.to, res.next) });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = {
      die,
      gates,
      stake: bet.value,
      prize: prizeFor(gates, die),
      pos: 0,
      next: 0,
      cash: RTP,
      landed: [0],
      outcome: null,
      missed: null,
    };
    setRound(r);
    setTokenAt(0);
    setRoll(null);
    doRoll(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setRoll(null);
    setTokenAt(0);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? doRoll(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const d = round?.die ?? die;
  const g = round?.gates ?? gates;
  const pos = round?.pos ?? 0;
  const next = round?.next ?? 0;
  const prize = round?.prize ?? prizeFor(gates, die);
  const p0 = winChance(gates, die);
  const over = phase === 'over';
  const pNow = !round ? p0 : round.outcome === 'win' ? 1 : round.outcome === 'bust' ? 0 : winChance(g, d, pos, next);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const nextFaces = next < g.length ? faceKinds(g, d, pos, next) : [];
  const overFaces = nextFaces.filter((f) => f === 'over').length;
  // Bars stay up after a cash-out (the odds you walked away from); a bust or a win has none left.
  const showBars = !over || round?.outcome === 'cashed';
  const profile = useMemo(() => (showBars ? landingProfile(g, d, pos, next) : null), [showBars, g, d, pos, next]);
  // The die strip: the roll in flight, else the next roll's faces.
  const shown: Shown = phase === 'rolling' && roll ? roll : { faces: nextFaces, face: null };
  const k1 = g.length;
  const gateGap = next < k1 ? g[next] - pos : 0;
  const allGates = k1 === 1 ? 'the gate' : `all ${k1} gates`;

  let status = `Ready · ${k1} gate${k1 > 1 ? 's' : ''} · d${d}`;
  if (phase === 'rolling') status = `Rolling the d${d}…`;
  if (phase === 'checkpoint')
    status = round && next > 0 && pos === g[next - 1] ? `Gate ${next} landed · ${k1 - next} to go` : `Square ${pos} · gate ${next + 1} is ${gateGap} ahead`;
  if (over && round) {
    if (round.outcome === 'win') status = `Landed on ${allGates}`;
    if (round.outcome === 'bust') status = `Jumped over gate ${(round.missed ?? 0) + 1}`;
    if (round.outcome === 'cashed') status = `Cashed out on square ${pos}`;
  }
  const tone = over ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';
  const title = !round?.outcome ? '' : round.outcome === 'win' ? 'Every gate landed' : round.outcome === 'bust' ? `Overshot gate ${(round.missed ?? 0) + 1}` : 'Cashed out';

  const pickGate = (square: number) => change(() => setGates((gs) => moveGate(gs, square)));

  return (
    <GameLayout
      name="Landing"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={volatilityOf(p0)} />}>Die</Label>
          <Chips
            label="Die"
            options={DICE.map((v) => ({ value: v, label: `d${v}`, title: `Steps 1 to ${v}` }))}
            value={die}
            disabled={live}
            onChange={(v) => change(() => setDie(v))}
          />

          <Label hint="tap a square to move one">Gates</Label>
          <Chips
            label="Number of gates"
            options={GATE_COUNTS.map((v) => ({ value: v, label: v }))}
            value={gates.length as GateCount}
            disabled={live}
            onChange={(v) => change(() => setGates(PRESETS[v]))}
          />
          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(p0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(gates, die))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && doRoll(round)}>
                Roll · {d - overFaces}/{d} safe
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'rolling' ? 'Rolling…' : over ? 'Bet again' : 'Bet'}
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
            value: fmtChance(pNow),
            sub: live && next < k1 ? `gate ${next + 1}: ${fmtChance(hitChance(gateGap, d))}` : `land on ${allGates}`,
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || over ? fmtMult(cash) : '—', sub: formatAmount(stake * cash, 2), tone: 'cash' },
          { label: 'Prize', value: fmtMult(prize), sub: 'land on every gate', tone: 'prize' },
        ]}
      />

      <Board className="landing-board">
        <Track
          die={d}
          gates={g}
          next={next}
          pos={pos}
          tokenAt={tokenAt}
          hopMs={Math.round(Math.min(120, Math.max(55, 560 / Math.max(1, roll?.face ?? 1))) * k)}
          profile={profile}
          faces={shown.faces}
          face={shown.face}
          landed={round?.landed ?? []}
          missed={round?.missed ?? null}
          showReach={!over}
          live={live}
          hideDie={over}
          rolling={phase === 'rolling'}
          onPick={live ? undefined : pickGate}
        />
        {over && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={title}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement="bottom"
          />
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={pNow}
          label="Chance to land on every gate"
          note={
            overFaces
              ? `Bars = chance the token lands on each square. This roll: ${overFaces} of ${d} faces jump gate ${next + 1} (red).`
              : `Bars = chance the token lands on each square. No face can jump gate ${next + 1} on this roll.`
          }
        />
      ) : (
        <Caption>
          Land exactly on every gate; jump one and the round is lost. Bars show each square's landing chance. Far from a gate a d{d} lands on it{' '}
          {fmtChance(renewalLimit(d))} of the time (2/(d+1), the renewal theorem). Tap a square to move the nearest gate. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Landing" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A token starts on square 0 and moves forward by the roll of a die. Mark 1 to 4 gate squares. You win when the token has landed exactly on
              every gate. If a roll carries it over a gate, the round is lost.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a die (d4, d6 or d10) and how many gates. Tap any square to move the nearest gate there.</li>
              <li>Bet: the first roll happens straight away. After every roll you can cash out, or roll again (Space).</li>
              <li>Landing on the last gate pays the prize automatically. Jumping over any gate ends the round.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The <b>bar</b> in each square is the chance the token ever lands there in a live round. A gate's bar (and its percentage) is the chance of
              getting that far; the last gate's bar is your win chance. The squares outlined ahead are the {d} places the next roll can land, each 1 in {d}.
              The die below the track shows the same faces: <b style={{ color: 'var(--red)' }}>red</b> faces jump the next gate,{' '}
              <b style={{ color: 'var(--green)' }}>green</b> lands on it.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Renewal theorem. Let u(n) be the chance of ever landing exactly n squares ahead. The next roll lands on one of the d squares ahead and the walk
              starts afresh, so u(n) = (u(n−1) + … + u(n−d)) / d with u(0) = 1. Close up, u(n) = (1 + 1/d)<sup>n−1</sup>/d, rising to a peak at n = d; far
              away it settles on 1 / mean step = 2/(d+1): {fmtChance(renewalLimit(4))} for a d4, {fmtChance(renewalLimit(6))} for a d6,{' '}
              {fmtChance(renewalLimit(10))} for a d10.
            </p>
            <p>
              Each gate restarts the walk, so P(win) = u(first gap) × u(second gap) × … and, mid-round, P(win | square x) = u(next gate − x) × the
              remaining gaps.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is {(RTP * 100).toFixed(0)}% ÷ P(win). Cash out is always prize × P(win | where the token stands). The recursion for u says the next
              roll's average cash-out equals the current one, so every roll is a fair bet: the round is worth {(RTP * 100).toFixed(0)}% of your stake however
              you place the gates and whenever you cash out. The largest possible prize is {fmtMult(RTP * 10 ** 4)} (four adjacent gates with a d10).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
