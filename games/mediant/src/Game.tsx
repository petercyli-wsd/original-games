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
import Field, { type Outcome } from './Board';
import { DEPTHS, PRESETS, RTP, clampWin, countLit, fmtX, nodeAt, prizeFor, volatilityOf, xOfGrid, type Depth, type Dir, type Win } from './math';

type Phase = 'idle' | 'stepping' | 'checkpoint' | 'over';

interface Round {
  win: Win;
  depth: Depth;
  stake: number;
  /** Locked at bet time: RTP / P(win). */
  prize: number;
  path: Dir[];
  cash: number;
  outcome: Outcome | null;
}

const ACCENT = '#c3f584';
const MAX_PRIZE = RTP * 2 ** 10;

const frac = (path: Dir[]) => {
  const n = nodeAt(path);
  return n.q === 1 ? String(n.p) : `${n.p}/${n.q}`;
};

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [depth, setDepth] = useState<Depth>(6);
  const [win, setWin] = useState<Win>(PRESETS[1]);
  const [preset, setPreset] = useState<string>(PRESETS[1].id);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [moving, setMoving] = useState<Dir | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // A flip is decided the moment it starts, so leaving mid-animation settles
  // at its real result, never at the pre-flip value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'stepping' ? resolved.current : (round?.cash ?? 0)));

  const stepMs = turbo.turbo ? 140 : 560;
  const live = phase === 'stepping' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setMoving(null);
    setPhase('over');
  }

  function step(r: Round) {
    const d: Dir = rng.next() < 0.5 ? 'L' : 'R';
    const path = [...r.path, d];
    const { lit, total } = countLit(path, r.depth, r.win);
    const p = lit / total;
    const cash = r.prize * p;
    resolved.current = cash;
    setPhase('stepping');
    setMoving(d);
    timers.after(stepMs, () => {
      const next = { ...r, path, cash };
      setMoving(null);
      // The round ends by itself once the ending is certain either way.
      if (p === 0) return finish(next, 'lost', 0);
      if (p === 1) return finish(next, 'won', r.prize);
      setRound(next);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: p });
    });
  }

  async function start() {
    if (live || bet.blocked || lit0 === 0) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = {
      win,
      depth,
      stake: bet.value,
      prize: prizeFor(depth, win),
      path: [],
      cash: RTP,
      outcome: null,
    };
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
    setMoving(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (live) return;
    apply();
    if (phase === 'over') clear();
  };
  const choosePreset = (id: string) =>
    change(() => {
      const p = PRESETS.find((x) => x.id === id)!;
      setPreset(id);
      setWin({ lo: p.lo, hi: p.hi });
    });
  const dragWindow = (lo: number, hi: number) =>
    change(() => {
      const w = clampWin(lo, hi);
      setWin(w);
      setPreset(PRESETS.find((p) => p.lo === w.lo && p.hi === w.hi)?.id ?? 'custom');
    });

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? step(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // Settings odds (for the panel) and what the board shows.
  const c0 = countLit([], depth, win);
  const lit0 = c0.lit;
  const p0 = c0.lit / c0.total;
  const prize0 = lit0 > 0 ? prizeFor(depth, win) : 0;

  const w = round?.win ?? win;
  const n = round?.depth ?? depth;
  const path = round?.path ?? [];
  const { lit, total } = countLit(path, n, w);
  const pNow = lit / total;
  const prize = round?.prize ?? prize0;
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const left = n - path.length;
  const pL = left > 0 ? countLit([...path, 'L'], n, w) : null;
  const pR = left > 0 ? countLit([...path, 'R'], n, w) : null;
  const ifL = pL ? pL.lit / pL.total : 0;
  const ifR = pR ? pR.lit / pR.total : 0;
  const winText = `${fmtX(xOfGrid(win.lo))} to ${fmtX(xOfGrid(win.hi))}`;

  const OUTCOME_TITLE: Record<Outcome, string> = {
    won: round && round.path.length < round.depth ? 'Locked in' : 'In the window',
    lost: round && round.path.length < round.depth ? 'Window out of reach' : 'Missed the window',
    cashed: 'Cashed out',
  };

  let status = `Ready · ${n} flips, window ${fmtX(xOfGrid(w.lo))} to ${fmtX(xOfGrid(w.hi))}`;
  if (phase === 'stepping') status = `Flip ${path.length + 1} of ${n}: ${moving === 'L' ? 'left' : 'right'}`;
  if (phase === 'checkpoint') status = `Checkpoint · at ${frac(path)}, flip ${path.length} of ${n}`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${frac(path)}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Mediant"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={lit0 > 0 ? <VolBadge level={volatilityOf(p0)} /> : 'empty'}>
            Window <b className="md-win">{winText}</b>
          </Label>
          <div className="md-presets">
            <Chips
              label="Window on the number line"
              wrap
              options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
              value={preset}
              disabled={live}
              onChange={choosePreset}
            />
          </div>
          <div className="md-hint">or drag the window and its edges on the board</div>

          <Label hint="the walk's final depth">Coin flips</Label>
          <Chips
            label="Coin flips"
            options={DEPTHS.map((v) => ({ value: v, label: v }))}
            value={depth}
            disabled={live}
            onChange={(v) => change(() => setDepth(v))}
          />
          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{lit0 > 0 ? `${fmtChance(p0)} (${lit0}/${c0.total})` : '—'}</dd>
            <dt>Prize</dt>
            <dd>{lit0 > 0 ? fmtMult(prize0) : '—'}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && step(round)}>
                Flip {path.length + 1} of {n} · L {fmtChance(ifL)} / R {fmtChance(ifR)}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked || lit0 === 0} onClick={() => void start()}>
              {phase === 'stepping' ? 'Flipping…' : lit0 === 0 ? 'No fraction in window' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            value: total ? fmtChance(pNow) : '—',
            sub: `${lit} of ${total} lit`,
            tone: 'chance',
          },
          {
            label: 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'after each flip',
            tone: 'cash',
          },
          {
            label: 'Prize',
            value: prize > 0 ? fmtMult(prize) : '—',
            sub: prize > 0 ? formatAmount(stake * prize, 2) : 'window is empty',
            tone: 'prize',
          },
        ]}
      />

      <Board className="md-board">
        <Field
          depth={n}
          win={w}
          path={path}
          moving={phase === 'stepping' ? moving : null}
          stepMs={stepMs}
          lit={lit}
          total={total}
          outcome={phase === 'over' ? (round?.outcome ?? null) : null}
          live={live}
          onWindow={dragWindow}
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
            placement="inline"
          />
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={pNow}
          label="Lit fractions among the reachable ones"
          note="Every reachable ending is equally likely, so the lit share is exactly your chance. A flip keeps one half of the endings."
        />
      ) : (
        <Caption>
          {lit0 > 0
            ? `${n} fair coin flips walk down the Stern–Brocot tree from 1/1. ${lit0} of the ${c0.total} possible endings lie in your window: ${fmtChance(p0)}. RTP ${(RTP * 100).toFixed(0)}%.`
            : `No depth-${depth} fraction lies in this window. Widen it, move it, or take more flips.`}
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Mediant" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A fair coin walks down the Stern–Brocot tree, the tree that holds every positive fraction exactly once. Win if the fraction it ends on lies in
              your window on the number line.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a window (a preset, or drag it and its edges on the board) and how many coin flips the walk takes. Then bet: the first flip happens.</li>
              <li>The walk starts at 1/1. Each flip moves it left (smaller) or right (bigger) to the next fraction down the tree.</li>
              <li>
                After each flip you can cash out (C) or flip again (Space). Once every reachable ending is in the window, the prize is locked in; once none is,
                the round is lost.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The dots on the number line are all the fractions the walk can end on. The bright ones can still be reached; the{' '}
              <b style={{ color: ACCENT }}>lit dots</b> are the reachable ones inside your window. Every ending is equally likely, so{' '}
              <b>lit ÷ reachable is exactly your chance</b>. Each flip throws away half of the endings, and your chance moves up or down.
            </p>
            <p>The line is drawn as x/(1+x), so 0 is at the left edge, 1 in the middle and ∞ at the right edge.</p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Between bounds a/b and c/d the walk sits on the <b>mediant</b> (a+c)/(b+d). Left makes the current fraction the upper bound, right makes it the
              lower bound. Starting from 0/1 and 1/0 this reaches every positive fraction exactly once (the Stern–Brocot tree), so n flips end on 2ⁿ different
              fractions, each with chance 1/2ⁿ:
            </p>
            <p>
              <b>P(win) = (number of depth-n fractions in the window) / 2ⁿ</b>
            </p>
            <p>
              The endings land very unevenly: they thin out around simple fractions such as ½, 1 and 2 and crowd together in between. In the limit, the share of
              endings below x is Minkowski's question-mark function ?(x/(1+x)), which takes dyadic values at every fraction of the tree. So a window from ½ to 2
              holds exactly half of the endings at any depth, while a window of the same width elsewhere can hold far fewer.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is locked when you bet, at {(RTP * 100).toFixed(0)}% ÷ P(win). Cashing out pays prize × (lit ÷ reachable). A flip keeps the left or the
              right half of the endings with equal chance, so your chance now is the average of your two chances after the flip: every flip is a fair bet. By
              optional stopping the round is worth {(RTP * 100).toFixed(0)}% of your stake whenever you cash out, and the window only trades chance for prize.
              The largest prize is {fmtMult(MAX_PRIZE)} (one lit ending after 10 flips).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
