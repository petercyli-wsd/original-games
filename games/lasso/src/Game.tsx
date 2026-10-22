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
import Field, { type BoardOutcome } from './Board';
import {
  BURST,
  FIELDS,
  FIELD_LABEL,
  LAPS,
  RTP,
  START,
  STEPS,
  allowed,
  chance,
  chanceField,
  prizeFor,
  sweepOf,
  volatilityOf,
  walk,
  windingOf,
  winChance,
  type Cell,
  type Field as FieldSize,
  type Laps,
  type Settings,
  type Steps,
} from './math';

type Phase = 'idle' | 'walking' | 'checkpoint' | 'over';

interface Round {
  s: Settings;
  stake: number;
  prize: number;
  /** Every cell walked, including any part of the burst still animating. */
  path: Cell[];
  /** Cash-out at the end of the committed path. */
  cash: number;
  outcome: BoardOutcome | null;
}

const OUTCOME_TITLE: Record<BoardOutcome, string> = {
  won: 'Lassoed',
  sure: 'Lassoed for sure',
  loose: 'No loop',
  reach: 'Out of reach',
  cashed: 'Cashed out',
};

const ACCENT = '#98f5e1';
const loopsLabel = (k: number) => `${k} loop${k > 1 ? 's' : ''}`;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [field, setField] = useState<FieldSize>(3);
  const [steps, setSteps] = useState<Steps>(40);
  const [laps, setLaps] = useState<Laps>(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [shown, setShown] = useState(1);
  const [infoOpen, setInfoOpen] = useState(false);

  // The burst in flight is decided when it starts, so leaving mid-walk
  // settles at its real result, never at the pre-burst value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'walking' ? resolved.current : round?.cash ?? 0));

  const stepMs = turbo.turbo ? 40 : 160;
  const live = phase === 'walking' || phase === 'checkpoint';

  function finish(r: Round, outcome: BoardOutcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setShown(r.path.length);
    setPhase('over');
  }

  function burst(r: Round) {
    const at = r.path[r.path.length - 1];
    const w = windingOf(r.path);
    const left = r.s.steps - (r.path.length - 1);
    const res = walk(r.s, at, w, left, BURST, () => rng.next());
    const cash = res.p === 1 ? r.prize : res.p === 0 ? 0 : r.prize * res.p;
    resolved.current = cash;
    const next: Round = { ...r, path: [...r.path, ...res.cells], cash };
    const from = r.path.length;
    setRound(next);
    setShown(from);
    setPhase('walking');
    res.cells.forEach((_, i) => timers.after((i + 1) * stepMs, () => setShown(from + i + 1)));
    timers.after(res.cells.length * stepMs + 120, () => {
      if (res.p === 1) return finish(next, res.left === 0 ? 'won' : 'sure', cash);
      if (res.p === 0) return finish(next, res.left === 0 ? 'loose' : 'reach', 0);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: res.p });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const s: Settings = { field, steps, laps };
    const r: Round = { s, stake: bet.value, prize: prizeFor(s), path: [START], cash: RTP, outcome: null };
    burst(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setShown(1);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? burst(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const s = round?.s ?? { field, steps, laps };
  const path = round ? round.path.slice(0, shown) : [START];
  const at = path[path.length - 1];
  const w = windingOf(path);
  const left = s.steps - (path.length - 1);
  const pNow = chance(s.field, s.laps, at, w, left);
  const prize = round?.prize ?? prizeFor(s);
  const p0 = winChance(s);
  const cash = round ? (phase === 'over' ? round.cash : prize * pNow) : RTP;
  const stake = round?.stake ?? bet.value;
  const heat = chanceField(s.field, s.laps, w, left);
  const sel: Settings = { field, steps, laps };
  const pSel = winChance(sel);
  const vol = volatilityOf(sel);
  const nextSteps = Math.min(BURST, left);

  let status = `Ready · ${FIELD_LABEL[s.field]} · ${s.steps} steps · ${loopsLabel(s.laps)}`;
  if (phase === 'walking') status = `Walking · step ${path.length - 1} of ${s.steps}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${left} steps left`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${path.length - 1} of ${s.steps} steps`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const chanceValue =
    phase === 'over' ? (round?.outcome === 'cashed' ? '—' : (round?.cash ?? 0) > 0 ? '100%' : '0%') : fmtChance(live ? pNow : p0);

  return (
    <GameLayout
      name="Lasso"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Steps</Label>
          <Chips
            label="Steps in the walk"
            options={STEPS.map((v) => ({ value: v, label: v }))}
            value={steps}
            disabled={live}
            onChange={(v) =>
              change(() => {
                setSteps(v);
                if (!allowed(v, laps)) setLaps(1);
              })
            }
          />

          <Label hint="cells round the pole">Field</Label>
          <Chips
            label="Field size"
            options={FIELDS.map((v) => ({ value: v, label: FIELD_LABEL[v] }))}
            value={field}
            disabled={live}
            onChange={(v) => change(() => setField(v))}
          />

          <Label hint="net seam crossings">Loops to win</Label>
          <Chips
            label="Loops to win"
            options={LAPS.map((v) => ({
              value: v,
              label: loopsLabel(v),
              disabled: !allowed(steps, v),
              title: allowed(steps, v) ? undefined : 'Two loops need 40 steps or more',
            }))}
            value={laps}
            disabled={live}
            onChange={(v) => change(() => setLaps(v))}
          />
          <dl className="og-stats">
            <dt>Chance to lasso</dt>
            <dd>{fmtChance(pSel)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(RTP / pSel)}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && burst(round)}>
                Walk {nextSteps} more · {fmtChance(pNow)} to win
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'walking' ? 'Walking…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            label: 'Chance to lasso',
            value: chanceValue,
            sub: live ? `${left} steps left · ${w === 0 ? 'no loop yet' : `${Math.abs(w)} of ${s.laps} tied`}` : `${s.steps} steps · ${loopsLabel(s.laps)}`,
            tone: 'chance',
          },
          {
            label: 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : `checkpoint every ${BURST} steps`,
            tone: 'cash',
          },
          { label: 'Prize', value: fmtMult(prize), sub: `if the rope loops ${s.laps === 1 ? 'the pole' : 'it twice'}`, tone: 'prize' },
        ]}
      />

      <Board className="lasso-board">
        <Field
          field={s.field}
          laps={s.laps}
          path={path}
          w={w}
          sweep={sweepOf(path)}
          left={left}
          steps={s.steps}
          heat={heat}
          outcome={phase === 'over' ? round?.outcome ?? null : null}
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
            placement={at.y < 0 ? 'top' : 'bottom'}
          />
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={pNow}
          label="Chance to lasso"
          note="Bright cells are where your chance is best. Crossing the gold seam downwards ties a loop, crossing back up unties it."
        />
      ) : (
        <Caption>
          Tie the rope round the pole: cross the gold seam on net. {s.steps} random steps on a {FIELD_LABEL[s.field]} field end with{' '}
          {loopsLabel(s.laps)} {fmtChance(p0)} of the time. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Lasso" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A walker tied to a rope starts just right of the pole and wanders the field at random. When the walk ends, the rope is pulled back to the start
              the short way round. If it is still looped round the pole (as many times as you chose), you win the prize.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the number of steps, the size of the field and how many loops you need, then bet.</li>
              <li>Each step goes to one of the open neighbouring cells, all equally likely. Walls and the pole block the way.</li>
              <li>
                Every {BURST} steps there is a checkpoint: cash out, or walk on (Space). The round ends at once when the result is settled: looped with no
                way to undo it, or with no way left to tie the loops in time.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The <b style={{ color: 'var(--gold)' }}>gold seam</b> runs from the pole to the left wall, opposite the start. Crossing it downwards ties a loop
              (+1, anticlockwise); crossing it upwards unties one (−1). The counter in the rope gauge is the net count, and the spiral shows the angle the rope
              has swept round the pole.
            </p>
            <p>
              Each cell is shaded by your exact chance of winning if the walker stood there now, with the same loops and steps left. The walker's own cell is
              your chance; the legend gives the brightest cell's value.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Winding number on a punctured lattice. The number of times a closed loop winds round the pole equals its signed crossings of any cut from the
              pole to the outer wall. With the cut opposite the start, the net crossing count w is the winding number of the walk closed the short way round:
              w = ⌈θ/2π − ½⌉, where θ is the total angle swept.
            </p>
            <p>
              The chance of finishing with |w| ≥ k from cell c with winding w and t steps left is an exact dynamic programme: P(c, w, 0) = [|w| ≥ k] and
              P(c, w, t) is the average of P(n, w + crossing, t − 1) over the open neighbours n of c.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is {(RTP * 100).toFixed(0)}% ÷ (chance at the start), and cashing out pays prize × (chance now). The recursion above is the average over
              the next step, so the cash-out is a fair bet at every step (a martingale): any way of deciding when to stop returns exactly{' '}
              {(RTP * 100).toFixed(0)}% of your stake.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
