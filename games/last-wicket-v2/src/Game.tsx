import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  Caption,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
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
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import { Chase, WIN_SPLIT, WheelView } from './Board';
import {
  MAX_WIN,
  OUT,
  RTP,
  SETTINGS,
  WHEEL_NAMES,
  WHEELS,
  after,
  bestWheel,
  cashOut as cashAt,
  outOfReach,
  perBall,
  prize as startPrize,
  relock,
  startState,
  volatilityOf,
  winChance,
  type Setting,
  type State,
  type Wheel,
} from './math';

type Phase = 'idle' | 'pick' | 'rolling' | 'over';
type Outcome = 'won' | 'out' | 'balls' | 'reach' | 'cashed';

interface Round {
  st: Setting;
  stake: number;
  prize: number;
  s: State;
  cash: number;
  results: number[];
  outcome: Outcome | null;
  /** The status line and up to two plain lines explaining what changed. */
  status: string;
  why: string[];
}

const TITLE: Record<Outcome, string> = { won: 'Target reached', out: 'You were out', balls: 'Balls ran out', reach: 'Out of reach', cashed: 'Cashed out' };
const CALL: Record<number, string> = { 0: 'Dot ball.', 1: 'Single.', 2: 'Two!', 4: 'Four!', 6: 'Six!' };
const NAME: Record<Wheel, string> = { block: 'Block', swing: 'Swing' };
const ABORT = new Error('aborted');

const fresh = (st: Setting, stake: number): Round => {
  const s = startState(st);
  return { st, stake, prize: startPrize(st), s, cash: RTP, results: [], outcome: null, status: `Pick a wheel. Need ${s.need} runs, ${s.balls} balls`, why: [] };
};

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [si, setSi] = useState(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [rot, setRot] = useState<Record<Wheel, number>>({ block: 0, swing: 0 });
  const [ms, setMs] = useState(700);
  const [landed, setLanded] = useState<{ w: Wheel; i: number } | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);

  // The open ticket's value right now, set synchronously when the stake is placed
  // and when a ball is drawn, so leaving mid-animation settles at the ball's real result.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);
  const busy = useRef(false);
  const rotRef = useRef<Record<Wheel, number>>({ block: 0, swing: 0 });

  const setting = SETTINGS[si];
  const live = phase === 'pick' || phase === 'rolling';
  const manualMs = { spin: eventMs(turbo.turbo, 700), gap: eventMs(turbo.turbo, 400) };
  const autoMs = { spin: eventMs(true, 700), gap: eventMs(true, 400) };

  async function pause(t: number) {
    if (!(await timers.wait(t))) throw ABORT;
  }

  /** One ball: the wheel is picked (prize relocked if it is the weaker one), drawn now, then the pointer turns and the numbers update. */
  async function bowl(r: Round, w: Wheel, t: { spin: number; gap: number }): Promise<Round> {
    const np = relock(r.prize, r.s, w) ?? r.prize;
    const i = rng.int(12);
    const x = WHEELS[w][i];
    const s2 = x === OUT ? r.s : after(r.s, x);
    const won = x !== OUT && s2.need === 0;
    const outcome: Outcome | null = won ? 'won' : x === OUT ? 'out' : s2.balls === 0 ? 'balls' : outOfReach(s2) ? 'reach' : null;
    const cash = won ? np : outcome ? 0 : cashAt(np, s2);
    resolved.current = cash;

    setMs(t.spin);
    setLanded(null);
    const target = i * 30 + 15;
    rotRef.current = { ...rotRef.current, [w]: rotRef.current[w] + 720 + ((((target - rotRef.current[w]) % 360) + 360) % 360) };
    setRot(rotRef.current);
    await pause(t.spin);
    setLanded({ w, i });

    const why: string[] = [];
    let status: string;
    if (outcome === 'won') status = TITLE.won;
    else if (outcome === 'out') status = 'Out! Your round is over';
    else if (outcome === 'balls') status = `No balls left: ${s2.need} short`;
    else if (outcome === 'reach') {
      status = `Out of reach: need ${s2.need} runs, ${s2.balls} ${s2.balls === 1 ? 'ball' : 'balls'}`;
      why.push(`Most you can make is ${6 * s2.balls} runs`);
    } else {
      status = `${CALL[x]} Need ${s2.need} runs, ${s2.balls} ${s2.balls === 1 ? 'ball' : 'balls'} left`;
      const d = winChance(s2) - winChance(r.s);
      const dr = perBall(s2) - perBall(r.s);
      if (d > 1e-12) why.push(dr < -0.005 ? 'Chance up: runs made beat the pace' : 'Chance up: one fewer ball to survive');
      else if (d < -1e-12) why.push(dr > 0.005 ? 'Chance down: runs fell behind the pace' : 'Chance down: too few runs for the pace');
      else why.push('Chance same');
    }
    if (fmtMult(np) !== fmtMult(r.prize)) why.push(`Weaker wheel: prize now ${fmtMult(np)}`);
    const next: Round = { ...r, prize: np, s: s2, cash, results: [...r.results, x], outcome, status, why };
    setRound(next);
    await pause(t.gap);
    return next;
  }

  function clearBoard() {
    setRound(null);
    setLanded(null);
    setPhase('idle');
  }

  function finish(r: Round, outcome: Outcome) {
    ticket.settle(r.cash);
    pushHistory(r.cash);
    setRound({ ...r, outcome, status: outcome === 'cashed' ? TITLE.cashed : r.status });
    setPhase('over');
  }

  async function choose(w: Wheel) {
    if (phase !== 'pick' || !round || busy.current || relock(round.prize, round.s, w) === null) return;
    busy.current = true;
    setPhase('rolling');
    try {
      const next = await bowl(round, w, manualMs);
      busy.current = false;
      if (next.outcome) return finish(next, next.outcome);
      setPhase('pick');
      track({ type: 'checkpoint', multiplier: next.cash, winChance: winChance(next.s) });
    } catch {
      busy.current = false;
    }
  }

  async function start() {
    if (live || autoBusy || busy.current || bet.blocked) return;
    busy.current = true;
    const ok = await ticket.place(bet.value);
    busy.current = false;
    if (!ok) return;
    resolved.current = RTP;
    timers.clearAll();
    setLanded(null);
    setRound(fresh(setting, bet.value));
    setPhase('pick');
  }

  function cashOut() {
    if (phase !== 'pick' || !round || busy.current) return;
    finish(round, 'cashed');
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    clearBoard();
  }

  // Auto plays a whole chase on the best wheel every ball, with no cash-out.
  async function playAuto(stake: number): Promise<number | null> {
    if (busy.current || !(await ticket.place(stake))) return null;
    busy.current = true;
    resolved.current = RTP;
    setAutoBusy(true);
    setLanded(null);
    let r = fresh(setting, stake);
    setRound(r);
    try {
      do r = await bowl(r, bestWheel(r.s), autoMs);
      while (!r.outcome);
    } catch {
      busy.current = false;
      return null;
    }
    ticket.settle(r.cash);
    pushHistory(r.cash);
    setPhase('over');
    setAutoBusy(false);
    busy.current = false;
    return r.cash;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  const locked = live || autoBusy || auto.running;

  useEffect(() => {
    timers.clearAll();
    clearBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => {
        if (isAuto) return auto.running ? auto.stop() : !autoBusy && !bet.blocked ? auto.start() : undefined;
        if (!live) void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------
  const st = round?.st ?? setting;
  const s = round?.s ?? startState(st);
  const results = round?.results ?? [];
  const finished = phase === 'over' && round?.outcome;
  const result: 'won' | 'lost' | null = finished && round!.outcome !== 'cashed' ? (round!.outcome === 'won' ? 'won' : 'lost') : null;
  const p = result === 'won' ? 1 : result === 'lost' ? 0 : winChance(s);
  const tinted = phase === 'pick' || phase === 'rolling' ? s : null;

  let status = `Need ${st.k} runs in ${st.balls} balls`;
  let why: string[] = ['Block is safe, Swing scores big'];
  if (round) {
    status = round.status;
    why = round.why;
  }
  if (phase === 'rolling') status = 'Bowling…';
  if (isAuto && (auto.running || autoBusy)) status = `Auto${auto.remaining !== null ? ` · ${auto.remaining} rounds left` : ''}`;
  const tone = finished ? (round!.cash > 0 ? 'won' : 'lost') : live || autoBusy ? 'live' : 'idle';

  const picks = WHEEL_NAMES.map((w) => ({ w, prize: round ? relock(round.prize, round.s, w) : null }));

  return (
    <GameLayout
      name="Last Wicket"
      accent="#e6b450"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={volatilityOf(setting)} />}>Runs to make / balls</Label>
          <Chips
            label="Runs to make / balls"
            options={SETTINGS.map((v, i) => ({ value: i, label: `${v.k}/${v.balls}` }))}
            value={si}
            disabled={locked}
            onChange={(v) => change(() => setSi(v))}
          />

          {isAuto ? (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || live || autoBusy} />
          ) : live ? (
            <>
              {picks.map(({ w, prize }) => (
                <ActionButton
                  key={w}
                  kind="secondary"
                  disabled={phase !== 'pick' || prize === null}
                  title={prize === null ? `${NAME[w]} cannot win from here` : undefined}
                  onClick={() => void choose(w)}
                >
                  {prize !== null && round && fmtMult(prize) !== fmtMult(round.prize) ? `${NAME[w]} · prize if picked ${fmtMult(prize)}` : NAME[w]}
                </ActionButton>
              ))}
              <ActionButton kind="cash" disabled={phase !== 'pick'} onClick={cashOut}>
                Cash out <span>{fmtMult(round?.cash ?? RTP)}</span>
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
          { label: 'Win chance', value: fmtChance(p), tone: 'chance' },
          { label: 'Prize if you win', value: fmtMult(round?.prize ?? startPrize(st)), tone: 'prize' },
        ]}
      />

      <Board className="lw-board">
        <div className="lw-bar" role="img" aria-label="Green share is your win chance">
          <i className="win" style={WIN_SPLIT(p)} />
        </div>
        <div className="lw-cap">Green share = your win chance</div>
        <Chase pace={perBall(s).toFixed(1)} need={s.need} target={st.k} balls={st.balls} results={results} result={result} />
        <div className="lw-why">
          {why.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
        <div className="lw-wheels">
          {WHEEL_NAMES.map((w) => (
            <WheelView key={w} wheel={w} tintState={tinted} rot={rot[w]} ms={ms} landed={landed?.w === w ? landed.i : null} picked={landed?.w === w} />
          ))}
        </div>
        <div className="lw-key">Numbers are runs scored. Out ends the round</div>
        {live && <div className="lw-cap">A weaker wheel relocks the prize</div>}
        <div className="lw-key">Green raises your chance, red lowers it</div>
        {phase === 'over' && round?.outcome && !isAuto && (
          <RoundOver
            key={history[0]?.id}
            title={TITLE[round.outcome]}
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

      <Caption>Score the runs before the balls run out; one Out ends the round.</Caption>

      {infoOpen && (
        <InfoModal title="Last Wicket" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Make the runs you need before the balls run out, in the balls you have. One Out ends the round.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a chase (runs off balls), then bet.</li>
              <li>Before each ball, pick a wheel. Block: 1 Out in 12, scores 1 or 2 runs. Swing: 4 Outs in 12, scores 0, 4 or 6 runs.</li>
              <li>The pointer stops on a sector. Runs lower what you need; an Out loses.</li>
              <li>Between balls, cash out or bowl again. Auto bowls the better wheel every ball.</li>
              <li>If the runs needed are more than 6 a ball can give, the chase is out of reach and the round ends.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The bar and Win chance are your chance of making the runs with the better wheel each ball. A sector is green if landing there raises it, red if it lowers it. A
              single can lower it when you are behind the pace, because the runs a ball you need go up.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The win chance is computed exactly over (runs needed, balls left) with the better wheel each ball. Picking the other wheel keeps your cash-out the same and relocks the
              prize, so the choice changes risk, never value (prizes are capped at {MAX_WIN.toLocaleString('en-US')}×).
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays {(RTP * 100).toFixed(0)}% ÷ the win chance at the start. Cash-out is the prize times the current win chance, so every way of playing returns{' '}
              {(RTP * 100).toFixed(0)}% in the long run.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
