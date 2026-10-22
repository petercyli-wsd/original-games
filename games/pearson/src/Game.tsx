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
import { useEffect, useRef, useState } from 'react';
import Field, { type BoardOutcome, type Move } from './Board';
import {
  HOMES,
  HOME_LABEL,
  RTP,
  STEPS,
  dist,
  homeChance,
  prepare,
  prizeFor,
  stepFrom,
  verdict,
  volatilityOf,
  winChance,
  type Home,
  type Pt,
  type Steps,
} from './math';

type Phase = 'idle' | 'stepping' | 'checkpoint' | 'over';

interface Round {
  steps: Steps;
  home: Home;
  stake: number;
  prize: number;
  path: Pt[];
  cash: number;
  outcome: BoardOutcome | null;
}

const OUTCOME_TITLE: Record<BoardOutcome, string> = {
  home: 'Home',
  sure: 'Home for sure',
  missed: 'Missed home',
  reach: 'Out of reach',
  cashed: 'Cashed out',
};

const ACCENT = '#ff70a6';
const KMAX = Math.max(...STEPS);
const ORIGIN: Pt = { x: 0, y: 0 };

/** Smallest view (in step lengths): home plus the first step circle, with room to spare. */
const viewMin = (home: Home) => Math.max(2.4, home + 1.4);

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [steps, setSteps] = useState<Steps>(6);
  const [home, setHome] = useState<Home>(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const moveSeq = useRef(0);

  // Build the odds tables in small slices after mount (selected home first),
  // so switching settings later is instant.
  useEffect(() => {
    let cancelled = false;
    let id = 0;
    const order = [home, ...HOMES.filter((h) => h !== home)];
    const work = () => {
      if (cancelled) return;
      const next = order.find((h) => !prepare(h, KMAX, 0));
      if (next !== undefined) id = window.setTimeout(work, 30);
    };
    id = window.setTimeout(work, 60);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // Only on mount: the order just picks a head start.
  }, []);

  // The step in flight is decided when it starts, so leaving mid-step settles
  // at its real result, never at the pre-step value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'stepping' ? resolved.current : round?.cash ?? 0));

  const moveMs = turbo.turbo ? 260 : 950;
  const zoomMs = turbo.turbo ? 160 : 520;
  const live = phase === 'stepping' || phase === 'checkpoint';

  function finish(r: Round, outcome: BoardOutcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setMove(null);
    setPhase('over');
  }

  function step(r: Round) {
    const from = r.path[r.path.length - 1];
    const angle = rng.next() * 2 * Math.PI;
    const to = stepFrom(from, angle);
    const left = r.steps - r.path.length; // steps left after this one
    const d = dist(to);
    const end = verdict(left, d, r.home);
    const cash = end === 'home' ? r.prize : end === 'lost' ? 0 : r.prize * homeChance(left, d, r.home);
    resolved.current = cash;
    setPhase('stepping');
    setMove({ id: ++moveSeq.current, to, angle });
    timers.after(moveMs, () => {
      const next = { ...r, path: [...r.path, to], cash };
      if (end === 'home') return finish(next, left === 0 ? 'home' : 'sure', cash);
      if (end === 'lost') return finish(next, left === 0 ? 'missed' : 'reach', 0);
      setRound(next);
      setMove(null);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: homeChance(left, d, r.home) });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { steps, home, stake: bet.value, prize: prizeFor(steps, home), path: [ORIGIN], cash: RTP, outcome: null };
    setRound(r);
    step(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setMove(null);
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
  const n = round?.steps ?? steps;
  const h = round?.home ?? home;
  const path = round?.path ?? [ORIGIN];
  const taken = path.length - 1;
  const left = n - taken;
  const pos = path[path.length - 1];
  const p0 = winChance(n, h);
  const prize = round?.prize ?? prizeFor(n, h);
  const chance = phase === 'over' ? (round?.cash ?? 0) / prize : homeChance(left, dist(pos), h);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const far = Math.max(0, ...path.map(dist), move ? dist(move.to) : 0);
  const view = Math.max(viewMin(h), far + 1.3);
  const vol = volatilityOf(steps, home);
  const pSel = winChance(steps, home);

  let status = `Ready · ${n} steps · home ${HOME_LABEL[h]}`;
  if (phase === 'stepping') status = `Step ${taken + 1} of ${n}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${left} step${left === 1 ? '' : 's'} left`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${taken} of ${n} steps`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const note =
    left === 1
      ? 'Last step. The green arc is every direction that lands home: its share of the circle is your chance.'
      : 'Rings join points with equal odds. On the step circle, green directions raise your odds and red ones lower them.';

  return (
    <GameLayout
      name="Pearson Walk"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Steps</Label>
          <Chips
            label="Number of steps"
            options={STEPS.map((v) => ({ value: v, label: v }))}
            value={steps}
            disabled={live}
            onChange={(v) => change(() => setSteps(v))}
          />

          <Label hint="in step lengths">Home radius</Label>
          <Chips
            label="Home radius"
            options={HOMES.map((v) => ({ value: v, label: HOME_LABEL[v], title: v === 1 ? 'One step: chance exactly 1/(n+1)' : undefined }))}
            value={home}
            disabled={live}
            onChange={(v) => change(() => setHome(v))}
          />
          <dl className="og-stats">
            <dt>Chance to end home</dt>
            <dd>{home === 1 ? `1/${steps + 1} · ${fmtChance(pSel)}` : fmtChance(pSel)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(RTP / pSel)}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && step(round)}>
                {left === 1 ? 'Last step' : `Step ${taken + 1} of ${n}`} · {fmtChance(chance)} to win
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'stepping' ? 'Walking…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            label: 'Chance to end home',
            value: phase === 'over' ? (round?.outcome === 'cashed' ? '—' : chance >= 1 ? '100%' : '0%') : fmtChance(live ? chance : p0),
            sub: live ? `${left} step${left === 1 ? '' : 's'} left` : `${n} steps · home ${HOME_LABEL[h]}`,
            tone: 'chance',
          },
          {
            label: 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : `${fmtMult(RTP)} after the free first step`,
            tone: 'cash',
          },
          { label: 'Prize', value: fmtMult(prize), sub: 'if the walk ends home', tone: 'prize' },
        ]}
      />

      <Board className="pearson-board">
        <Field
          home={h}
          steps={n}
          left={left}
          path={path}
          move={move}
          moveMs={moveMs}
          zoomMs={zoomMs}
          view={view}
          live={live}
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
            placement={pos.y / view > 0.15 ? 'top' : 'bottom'}
          />
        )}
      </Board>

      {live ? (
        <ChanceBar p={chance} label="Chance to end home" note={note} />
      ) : (
        <Caption>
          {h === 1
            ? `Kluyver: ${n} random unit steps end within one step of the start exactly 1 time in ${n + 1}.`
            : `${n} random unit steps end within ${HOME_LABEL[h]} step of the start ${fmtChance(p0)} of the time (Kluyver's Bessel integral).`}{' '}
          The first step is free. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Pearson Walk" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A walker starts at the centre of the green home disc and takes a fixed number of unit steps, each in a completely random direction. If it
              finishes inside home, you win the prize.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the number of steps and the size of home (its radius, measured in step lengths), then bet.</li>
              <li>The first step is taken for you. After every step you can cash out, or take the next step (Space).</li>
              <li>
                If home can no longer be reached (the red zone), the round is lost at once. If every remaining step must land home, it pays at once. Otherwise
                the last step decides.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The walk has no preferred direction, so your chance depends only on how far you are from the centre and how many steps are left. The shaded
              field is brighter where the odds are better, and the labelled rings join points with equal odds; your own ring passes through the walker.
            </p>
            <p>
              The dashed circle around the walker is where the next step can land. <b style={{ color: 'var(--green)' }}>Green</b> directions raise your odds,{' '}
              <b style={{ color: 'var(--red)' }}>red</b> ones lower them. On the last step the green arc is exactly the directions that land home, so its share
              of the circle is your chance. The <b style={{ color: 'var(--red)' }}>red zone</b> is out of reach: from there no way of taking the remaining steps
              ends inside home (too far away, or on the last step too close to the centre to land back in a small home).
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Pearson's random walk (1905). Kluyver (1906) showed that n unit steps in random directions end within distance ρ of the start with probability
              ρ∫₀<sup>∞</sup>J₁(ρt)J₀(t)<sup>n</sup>dt. When home is one step wide (ρ = 1) the integrand is a perfect derivative and the answer is exactly{' '}
              <b>1/(n+1)</b>: 1/3 for two steps, 1/10 for nine.
            </p>
            <p>
              With k steps left at distance r, the chance P<sub>k</sub>(r) is the average of P<sub>k−1</sub> over the circle the next step lands on. For the last
              step it is arccos((r² + 1 − ρ²)/2r)/π, the green arc. The game tabulates P<sub>k</sub> by exact quadrature, checked against Kluyver's 1/(k+1) to
              1e-9.
            </p>
            <p>
              A bonus identity: with home one step wide, (k+1)·P<sub>k</sub>(r) is exactly the chance that a fresh (k+1)-step walk ends farther than r from
              its start.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is {(RTP * 100).toFixed(0)}% ÷ (chance at the start), and cashing out pays prize × (chance now). Each step averages your chance over
              the step circle, so the cash-out is a fair bet at every step (a martingale): any way of deciding when to stop returns exactly{' '}
              {(RTP * 100).toFixed(0)}% of your stake. The first step always lands on the unit circle, so it never changes the value.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
