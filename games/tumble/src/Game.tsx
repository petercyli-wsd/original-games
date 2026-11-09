import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
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
import Field, { CALL_LABEL } from './Board';
import {
  CUBES,
  DIRS,
  PLACES,
  ROLLS,
  RTP,
  prizeFor,
  roll,
  startChance,
  startFaces,
  verdict,
  volatilityOf,
  winChance,
  type Cubes,
  type Dir,
  type Face,
  type Place,
  type Rolls,
} from './math';

type Phase = 'idle' | 'rolling' | 'checkpoint' | 'over';
type Outcome = 'won' | 'lost' | 'cashed';

interface Round {
  rolls: Rolls;
  cubes: Cubes;
  target: Place;
  stake: number;
  /** Locked at bet time: RTP / P₀. */
  prize: number;
  faces: Face[];
  done: number;
  cash: number;
  outcome: Outcome | null;
}

const ACCENT = ACCENTS.sky;
const PLACE_NAME: Record<Place, string> = { top: 'Top', side: 'Side', bottom: 'Bottom' };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function outcomeTitle(r: Round): string {
  if (r.outcome === 'cashed') return 'Cashed out';
  if (r.outcome === 'won') return `Red ${CALL_LABEL[r.target]}!`;
  return r.done < r.rolls ? 'No way back' : `Not ${CALL_LABEL[r.target]}`;
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [rolls, setRolls] = useState<Rolls>(5);
  const [cubes, setCubes] = useState<Cubes>(1);
  const [target, setTarget] = useState<Place>('top');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [tipping, setTipping] = useState<Dir[] | null>(null);
  const [stepKey, setStepKey] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);

  // What an open bet is worth if the game unmounts, read only from this ref
  // (never from render state, which lags a tick: leaving right after Bet or a
  // roll must not settle at the last render's value). It is RTP right after
  // the bet, and each roll sets it to the post-roll value the moment the roll
  // is decided, so leaving mid-roll settles at the real result.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  const rollMs = eventMs(turbo.turbo);
  const live = phase === 'rolling' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  function rollNext(r: Round) {
    const dirs = r.faces.map(() => DIRS[rng.int(4)]);
    const faces = r.faces.map((f, i) => roll(f, dirs[i]));
    const done = r.done + 1;
    const left = r.rolls - done;
    const v = verdict(faces, left, r.target);
    const p = winChance(faces, left, r.target);
    const cash = v === 'won' ? r.prize : v === 'lost' ? 0 : r.prize * p;
    resolved.current = cash;
    setPhase('rolling');
    setTipping(dirs);
    timers.after(rollMs, () => {
      const landed = { ...r, faces, done, cash };
      setTipping(null);
      setStepKey((s) => s + 1);
      if (v) return finish(landed, v, cash);
      setRound(landed);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: p });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    resolved.current = RTP;
    timers.clearAll();
    const r: Round = { rolls, cubes, target, stake: bet.value, prize: prizeFor(rolls, cubes, target), faces: startFaces(cubes), done: 0, cash: RTP, outcome: null };
    setRound(r);
    setStepKey((s) => s + 1);
    rollNext(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setTipping(null);
    setStepKey((s) => s + 1);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (live) return;
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? rollNext(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const n = round?.rolls ?? rolls;
  const k = round?.cubes ?? cubes;
  const t = round?.target ?? target;
  const faces = round?.faces ?? startFaces(k);
  const done = round?.done ?? 0;
  const left = n - done;
  const pNow = winChance(faces, left, t);
  const prize = round?.prize ?? prizeFor(rolls, cubes, target);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const p0 = startChance(rolls, cubes, target);

  let status = `Ready · ${plural(k, 'cube')}, ${plural(n, 'roll')}, red ${CALL_LABEL[t]}`;
  if (phase === 'rolling') status = `Roll ${done + 1} of ${n}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${done} of ${n} rolls`;
  if (phase === 'over' && round) status = `${outcomeTitle(round)} · ${plural(done, 'roll')}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Tumble"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={volatilityOf(p0)} />}>Red face ends</Label>
          <Chips
            label="Red face ends"
            options={PLACES.map((v) => ({ value: v, label: PLACE_NAME[v] }))}
            value={target}
            disabled={live}
            onChange={(v) => change(() => setTarget(v))}
          />

          <Label hint="longer walks forget the start">Rolls</Label>
          <Chips label="Rolls" options={ROLLS.map((v) => ({ value: v, label: v }))} value={rolls} disabled={live} onChange={(v) => change(() => setRolls(v))} />

          <Label hint="every cube must match">Cubes</Label>
          <Chips label="Cubes" options={CUBES.map((v) => ({ value: v, label: v }))} value={cubes} disabled={live} onChange={(v) => change(() => setCubes(v))} />

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && rollNext(round)}>
                {left === 1 ? 'Last roll' : 'Roll next'}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'rolling' ? 'Rolling…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Win chance', value: fmtChance(pNow), tone: 'chance' },
          { label: 'Prize', value: fmtMult(prize), tone: 'prize' },
        ]}
      />

      <Board className="tumble-board">
        <Field faces={faces} left={left} rolls={n} target={t} tipping={tipping} stepKey={stepKey} rollMs={rollMs} over={phase === 'over'} />
        {phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={outcomeTitle(round)}
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

      <ChanceBar p={pNow} label="Chance every red face ends where you called" />

      <Caption>Win if every red face ends where you called after the last roll.</Caption>

      {infoOpen && (
        <InfoModal title="Tumble" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Each cube has one <b style={{ color: 'var(--suit-red)' }}>red face</b>, starting on top. The cubes tip over in random directions. Call where every red
              face ends after the last roll: on top, on a side, or on the bottom.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose your call, the number of rolls (3, 5, 8 or 12) and how many cubes (1 to 3), then bet. The first roll happens at once.</li>
              <li>Each roll, every cube tips over one of its four edges, each with chance ¼. After a roll you can cash out (C) or roll on (Space).</li>
              <li>
                After the last roll you win the prize if every red face is where you called. If a cube can no longer get there (a red face on top with one roll
                left must roll off), the round ends early.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Under each cube, a bar is split into top, side and bottom: each part's width is the exact chance the red face ends there. Your call is the{' '}
              <b style={{ color: 'var(--win)' }}>green part</b>. With several cubes, the round's chance is the product of the green parts   (the Win chance
              above the board, drawn again as the bar under it, which moves after every roll).
            </p>
            <p>
              The four cells around a cube are the four ways it can tip. Each is filled{' '}
              <b style={{ color: 'var(--win)' }}>green</b> if this cube's chance would rise that way, <b style={{ color: 'var(--lose)' }}>red</b> if it would fall; a bigger fill
              means a bigger change. Each happens a quarter of the time, so their average is the bar.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Tipping a cube sends the top face to a side and that side to the bottom. So the red face moves on a three-state Markov chain: from the top (or bottom)
              it always goes to a side; from a side it goes to the bottom with chance ¼ (tipping towards it), to the top with ¼ (away from it) and stays on a side
              with ½. The transition matrix has eigenvalues 1, −½ and 0, so with m ≥ 1 rolls left
            </p>
            <p>
              <b>P(side) = ⅔ + ⅓(−½)^m</b> from a side, <b>⅔ − ⅔(−½)^m</b> from top or bottom, and <b>P(top) = P(bottom) = (1 − P(side)) / 2</b>.
            </p>
            <p>
              The odds swing back and forth as (−½)^m dies away towards the stationary law: ⅙ top, ⅔ side, ⅙ bottom. Red on top after 3 rolls is exactly ⅛; on a
              side, ¾. The cubes roll independently, so their chances multiply.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is locked when you bet, at {(RTP * 100).toFixed(0)}% ÷ (chance for your settings). Cashing out pays prize × your chance now. One roll of
              the chain averages the chances (the four cells average to the bar), so every roll is a fair bet: by optional stopping, the round is worth{' '}
              {(RTP * 100).toFixed(0)}% of your stake whenever you cash out. Your call, the rolls and the cubes only trade chance for prize. The largest prize is{' '}
              {fmtMult(prizeFor(3, 3, 'top'))} (three cubes, red on top after 3 rolls: (⅛)³).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
