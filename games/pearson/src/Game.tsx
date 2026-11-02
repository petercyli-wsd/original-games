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
  START,
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
  type Steps,
  type Verdict,
} from './math';

type Phase = 'idle' | 'stepping' | 'checkpoint' | 'over';

interface Round {
  steps: Steps;
  home: Home;
  stake: number;
  prize: number;
  /** The walker's distance from the centre after each step; dists[0] is the start. */
  dists: number[];
  cash: number;
  outcome: BoardOutcome | null;
}

/** One drawn step: where it lands and what the round is worth afterwards. */
interface Drawn {
  angle: number;
  to: { x: number; y: number };
  d: number;
  end: Verdict | null;
  cash: number;
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

/** Smallest view (in step lengths): home and the start's step circle, with room to spare. */
const viewMin = (home: Home) => Math.max(2.6, home + 1.4);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [steps, setSteps] = useState<Steps>(6);
  const [home, setHome] = useState<Home>(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [running, setRunning] = useState(false);
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

  // The steps in flight are all decided when the button is pressed, so leaving
  // mid-step (or mid-run) settles at their real result, never at the pre-step value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'stepping' ? resolved.current : round?.cash ?? 0));

  const moveMs = turbo.turbo ? 300 : 1150;
  const gapMs = turbo.turbo ? 60 : 200;
  const zoomMs = turbo.turbo ? 160 : 520;
  const live = phase === 'stepping' || phase === 'checkpoint';

  function finish(r: Round, outcome: BoardOutcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setMove(null);
    setRunning(false);
    setPhase('over');
  }

  /** Draws one step from distance r with `left` steps to go (the walker sits on the board's ray). */
  function draw(r: Round, from: number, left: number): Drawn {
    const angle = rng.next() * 2 * Math.PI;
    const to = stepFrom({ x: 0, y: -from }, angle);
    const d = dist(to);
    const end = verdict(left - 1, d, r.home);
    const cash = end === 'home' ? r.prize : end === 'lost' ? 0 : r.prize * homeChance(left - 1, d, r.home);
    return { angle, to, d, end, cash };
  }

  /** One step, or (all = true) every step until the round is decided. */
  function walk(r: Round, all: boolean) {
    const drawn: Drawn[] = [];
    let from = r.dists[r.dists.length - 1];
    let left = r.steps - (r.dists.length - 1);
    do {
      const s = draw(r, from, left);
      drawn.push(s);
      from = s.d;
      left--;
      if (s.end) break;
    } while (all);
    const last = drawn[drawn.length - 1];
    resolved.current = last.cash;
    setRunning(all);
    setPhase('stepping');
    animate(r, drawn, 0);
  }

  function animate(r: Round, drawn: Drawn[], i: number) {
    const s = drawn[i];
    const from = r.dists[r.dists.length - 1];
    setMove({ id: ++moveSeq.current, from, angle: s.angle, to: s.to });
    timers.after(moveMs, () => {
      const next = { ...r, dists: [...r.dists, s.d], cash: s.cash };
      const left = r.steps - (next.dists.length - 1);
      if (s.end === 'home') return finish(next, left === 0 ? 'home' : 'sure', s.cash);
      if (s.end === 'lost') return finish(next, left === 0 ? 'missed' : 'reach', 0);
      setRound(next);
      setMove(null);
      if (i + 1 < drawn.length) {
        timers.after(gapMs, () => animate(next, drawn, i + 1));
        return;
      }
      setRunning(false);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: s.cash, winChance: homeChance(left, s.d, r.home) });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { steps, home, stake: bet.value, prize: prizeFor(steps, home), dists: [START], cash: RTP, outcome: null };
    setRound(r);
    walk(r, false);
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
      space: () => (phase === 'checkpoint' && round ? walk(round, false) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const n = round?.steps ?? steps;
  const h = round?.home ?? home;
  const dists = round?.dists ?? [START];
  const taken = dists.length - 1;
  const left = n - taken;
  const r = dists[dists.length - 1];
  const p0 = winChance(n, h);
  const prize = round?.prize ?? prizeFor(n, h);
  const chance = phase === 'over' ? (round?.cash ?? 0) / prize : homeChance(left, r, h);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const far = Math.max(0, ...dists, move ? dist(move.to) : 0);
  const view = Math.max(viewMin(h), far + 1.3);
  const vol = volatilityOf(steps, home);
  const pSel = winChance(steps, home);

  const rule = `The walker takes ${plural(n, 'random step')}; win if it ends inside the green home.`;

  let status = `${plural(n, 'random step')} · end in the green home`;
  if (phase === 'stepping') status = `${running ? 'Running · ' : ''}Step ${taken + 1} of ${n}`;
  if (phase === 'checkpoint') status = `Cash out or step on · ${left} left`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${taken} of ${n} steps`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const note =
    left === 1
      ? 'Last step: the green arc is every direction that lands home, so its share of the circle is your chance.'
      : 'Green directions on the dashed circle bring the walker closer (better odds); red ones take it away.';

  const exact = h === 1 ? ` Home one step wide: exactly 1 in ${n + 2}.` : '';

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
            options={HOMES.map((v) => ({ value: v, label: HOME_LABEL[v], title: v === 1 ? 'One step: chance exactly 1/(steps + 2)' : undefined }))}
            value={home}
            disabled={live}
            onChange={(v) => change(() => setHome(v))}
          />
          <dl className="og-stats">
            <dt>Chance to end home</dt>
            <dd>{home === 1 ? `1/${steps + 2} · ${fmtChance(pSel)}` : fmtChance(pSel)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(RTP / pSel)}</dd>
          </dl>

          {live ? (
            <>
              <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={() => round && walk(round, false)}>
                {phase === 'stepping' ? (running ? 'Running…' : 'Stepping…') : left === 1 ? 'Last step' : `Next step (${taken + 1} of ${n})`}
              </ActionButton>
              {(left > 1 || running) && (
                <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={() => round && walk(round, true)}>
                  Run to the end
                </ActionButton>
              )}
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
            label: 'Chance to end home',
            value: phase === 'over' ? (round?.outcome === 'cashed' ? '—' : chance >= 1 ? '100%' : '0%') : fmtChance(live ? chance : p0),
            sub: live ? `${plural(left, 'step')} left` : phase === 'over' ? `after ${taken} of ${n} steps` : `${plural(n, 'step')} · home ${HOME_LABEL[h]}`,
            tone: 'chance',
          },
          {
            label: 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'after every step',
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
          r={r}
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
            placement="bottom"
          />
        )}
      </Board>

      {live ? (
        <ChanceBar p={chance} label="Chance to end home" note={`${rule} ${note}`} />
      ) : (
        <Caption>
          {rule} It starts one step from the centre.{exact} RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Pearson Walk" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A walker starts one step from the centre of the green home disc and takes a fixed number of unit steps, each in a completely random direction.
              If it finishes inside home, you win the prize.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the number of steps and the size of home (its radius, measured in step lengths), then bet. The bet takes the first step.</li>
              <li>
                After every step the walk waits for you: <b>Cash out</b> (C), <b>Next step</b> (Space), or <b>Run to the end</b> to take the rest without
                stopping.
              </li>
              <li>
                If home can no longer be reached (the red zone), the round is lost at once. If every remaining step must land home, it pays at once. Otherwise
                the last step decides.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The walk has no preferred direction, so your chance depends only on how far the walker is from the centre and how many steps are left. That is
              why the board turns after every step to put the walker back on the same line up from the centre: only its distance in or out matters.
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
              <b>1/(n+1)</b>. A walk's first step from the centre always lands one step out, so N steps from one step out are an (N+1)-step walk: the chance
              is exactly <b>1/(N+2)</b>, 1/4 for two steps and 1/14 for twelve.
            </p>
            <p>
              With k steps left at distance r, the chance P<sub>k</sub>(r) is the average of P<sub>k−1</sub> over the circle the next step lands on. For the last
              step it is arccos((r² + 1 − ρ²)/2r)/π, the green arc. The game tabulates P<sub>k</sub> by exact quadrature, checked against Kluyver's 1/(k+1) to
              1e-9.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is {(RTP * 100).toFixed(0)}% ÷ (chance at the start), and cashing out pays prize × (chance now). Each step averages your chance over
              the step circle, so the cash-out is a fair bet at every step (a martingale): any way of deciding when to stop, including Run to the end, returns
              exactly {(RTP * 100).toFixed(0)}% of your stake.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
