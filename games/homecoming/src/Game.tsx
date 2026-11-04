import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  BetField,
  Board,
  Caption,
  ACCENTS,
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
  eventMs,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { formatAmount } from '@originals/game-sdk';
import { useRef, useState } from 'react';
import Field, { type BoardOutcome } from './Board';
import { BUDGET, DIMS, RTP, isHome, l1, origin, prizeFor, sideChance, slotIndex, startChance, volatilityOf, walkStep, type Dim, type Settings, type Side } from './math';

type Phase = 'idle' | 'live' | 'stepping' | 'over';

interface Round {
  s: Settings;
  stake: number;
  prize: number;
  /** Positions visited, starting at home. */
  path: number[][];
  cash: number;
  outcome: BoardOutcome | null;
}

/** The step being played: drawn from `from`, shown as slot `slot`. */
interface Pending {
  from: number[];
  slot: number;
  /** Which step this is (1-based). */
  n: number;
}

const OUTCOME_TITLE: Record<BoardOutcome, string> = {
  'came-home': 'Came home',
  'too-far': 'Out of reach',
  'stayed-away': 'Stayed away',
  caught: 'Came home',
  cashed: 'Cashed out',
};

const SIDE_LABEL: Record<Side, string> = { home: 'Home', away: 'Away' };
const RULE = `Back Home or Away: does the dot get home within ${BUDGET} steps?`;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [dim, setDim] = useState<Dim>(2);
  const [side, setSide] = useState<Side>('home');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // A step is decided when it starts, so leaving mid-step settles at its real
  // result, never at the pre-step value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'stepping' ? resolved.current : round?.cash ?? 0));

  const stepMs = eventMs(turbo.turbo);
  const live = phase === 'live' || phase === 'stepping';

  function finish(r: Round, outcome: BoardOutcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPending(null);
    setPhase('over');
  }

  function step(r: Round) {
    const from = r.path[r.path.length - 1];
    const left = BUDGET - (r.path.length - 1);
    const st = walkStep(r.s, from, left, rng.next());
    resolved.current = st.cash;
    setPhase('stepping');
    // First the drawn move lights up, then the dot moves, then the step settles.
    setPending({ from, slot: slotIndex(r.s.dim, from, st.move), n: r.path.length });
    const next: Round = { ...r, path: [...r.path, st.to], cash: st.cash };
    timers.after(Math.round(stepMs * 0.7), () => setRound(next));
    timers.after(Math.round(stepMs * 0.7) + stepMs + 60, () => {
      if (st.verdict) {
        const home = isHome(st.to);
        const outcome: BoardOutcome = r.s.side === 'home' ? (home ? 'came-home' : 'too-far') : home ? 'caught' : 'stayed-away';
        return finish(next, outcome, st.cash);
      }
      setPending(null);
      setPhase('live');
      track({ type: 'checkpoint', multiplier: st.cash, winChance: sideChance(r.s.side, r.s.dim, st.to, left - 1) });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const s: Settings = { dim, side };
    setPending(null);
    setRound({ s, stake: bet.value, prize: prizeFor(s), path: [origin(dim)], cash: RTP, outcome: null });
    setPhase('live');
  }

  function cashOut() {
    if (phase !== 'live' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setPending(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'live' && round ? step(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const s: Settings = round?.s ?? { dim, side };
  const path = round?.path ?? [origin(s.dim)];
  const taken = path.length - 1;
  const left = BUDGET - taken;
  const pos = path[path.length - 1];
  const dist = l1(pos);
  const prize = round?.prize ?? prizeFor(s);
  const settled = phase === 'over';
  const chance = settled ? (round?.cash ?? 0) / prize : taken === 0 ? startChance(s) : sideChance(s.side, s.dim, pos, left);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const sel: Settings = { dim, side };
  const vol = volatilityOf(sel);
  const sideWord = s.side === 'home' ? 'comes home' : 'stays away';
  const slotsFrom = settled ? null : pending ? pending.from : pos;

  let status = `Ready · ${s.dim}D · back ${SIDE_LABEL[s.side]}`;
  if (phase === 'live') status = taken === 0 ? `Bet placed · ${BUDGET} steps to go` : `Step ${taken} of ${BUDGET} · ${dist} from home`;
  if (phase === 'stepping' && pending) status = `Step ${pending.n} of ${BUDGET}…`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${taken} of ${BUDGET} steps`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Homecoming"
      accent={ACCENTS.violet}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Dimension</Label>
          <Chips
            label="Dimension"
            options={DIMS.map((v) => ({ value: v, label: `${v}D`, title: `${2 * v} equally likely moves per step` }))}
            value={dim}
            disabled={live}
            onChange={(v) => change(() => setDim(v))}
          />

          <Label>Back</Label>
          <Chips
            label="Back a side"
            options={[
              { value: 'home' as Side, label: 'Home', title: `Win if the dot gets home within ${BUDGET} steps` },
              { value: 'away' as Side, label: 'Away', title: `Win if it doesn't get home within ${BUDGET} steps` },
            ]}
            value={side}
            disabled={live}
            onChange={(v) => change(() => setSide(v))}
          />

          {live ? (
            <>
              <ActionButton kind="cash" disabled={phase !== 'live'} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" disabled={phase !== 'live'} onClick={() => round && step(round)}>
                Step
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={!!bet.blocked} onClick={() => void start()}>
              {phase === 'over' ? 'Bet again' : 'Bet'}
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
            label: `Chance it ${sideWord}`,
            value: settled ? (round?.outcome === 'cashed' ? '—' : chance >= 1 ? '100%' : '0%') : fmtChance(chance),
            tone: 'chance',
          },
          { label: 'Prize', value: fmtMult(prize), tone: 'prize' },
        ]}
      />

      <Board className="homecoming-board">
        <Field
          dim={s.dim}
          side={s.side}
          pos={pos}
          left={left}
          slotsFrom={slotsFrom}
          drawn={pending ? pending.slot : null}
          stepMs={stepMs}
          outcome={settled ? round?.outcome ?? null : null}
        />
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
            placement="bottom"
          />
        )}
      </Board>

      <Caption>{RULE}</Caption>

      {infoOpen && (
        <InfoModal title="Homecoming" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A dot leaves home and takes {BUDGET} random steps. Back <b>Home</b> to win if it gets back home before the steps run out, or <b>Away</b> to
              win if it doesn't. You can cash out between any two steps.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the dimension (1D, 2D or 3D) and a side, then bet.</li>
              <li>Each press of Step (Space) moves the dot one step. Between steps you can cash out (C).</li>
              <li>
                The round ends the moment the dot is home, or once it is further from home than the steps left can cover (the shaded "out of reach" end of
                the tracks), or when the steps run out.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The walk has one track per dimension. Each track shows how far the dot is from home along that direction; home is every track at 0 at the
              same time. Each step picks one of the {2 * s.dim} equally likely moves shown under the board: a move takes one track a notch closer to home
              or a notch further (a track already at home can only go further, so both of its moves do).
            </p>
            <p>
              The shaded end of each track is out of reach: once a dot is there, the steps left cannot bring it home. It closes in as the steps are used.
              The chance above the board is your exact chance right now, and updates after every step.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Pólya's recurrence theorem (1921): a simple random walk on the grid returns home with probability 1 in one and two dimensions, but only with
              probability ≈ 0.3405 in three. Within {BUDGET} steps the chance is lower, and it falls with every extra dimension: {DIMS.map((d) => `${d}D ${fmtChance(startChance({ dim: d, side: 'home' }))}`).join(', ')}. In 1D it is exactly 1 − C(T, T/2)/2<sup>T</sup>.
            </p>
            <p>
              The game computes the chance g(x, t) of reaching home from x within t steps exactly: g(x, 0) = 0, and g(x, t) is the average over the{' '}
              {2 * s.dim} neighbours y of (1 if y is home, else g(y, t − 1)). Signs and the order of the directions do not matter, which is why the board
              only shows distances; the result is checked against the renewal equation for return probabilities.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is {(RTP * 100).toFixed(0)}% ÷ (your side's chance at the start), and cashing out pays prize × (your chance now), starting at{' '}
              {fmtMult(RTP)} the moment you bet. Because the chance now is the average of the chances after the {2 * s.dim} possible moves, the cash-out is a
              fair bet at every step (a martingale): any way of deciding when to stop returns exactly {(RTP * 100).toFixed(0)}% of your stake. Home and Away
              are each priced at their own odds, so the side you back changes the swings, not the value.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
