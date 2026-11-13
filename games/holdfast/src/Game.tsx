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
  GameLayout,
  InfoModal,
  InfoSection,
  InstantResult,
  ModeTabs,
  PanelFoot,
  Readouts,
  StageTop,
  eventMs,
  fmtMult,
  fmtOneIn,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import { Grid, SHAPE_NAME, SymbolArt, Track } from './Board';
import { SCATTER } from './math';
import {
  FREE_CAP,
  INNER_SYMS,
  KEY,
  LOCK_PAY,
  LOCK_RESPINS,
  OUTER_SYMS,
  PAYLINES,
  PAY_BASE,
  PAY_FREE,
  RTP,
  WILD,
  featureChance,
  lockDistribution,
  pLock,
  pScatter3,
  playRound,
  type Grid as GridT,
  type LockEvent,
  type Round,
  type SpinEvent,
} from './math';

const RULE = '3+ stars: free spins. Full key column on a side: lock.';

// A quiet starting board with no paying line.
const IDLE_GRID: GridT = [
  [0, 2, 4],
  [3, 7, 1, 5],
  [6, 8, 2, 0],
  [1, 4, 3, 7],
  [5, 0, 8],
];

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

interface LockView {
  held: boolean[];
  landed: boolean[] | null;
  left: number;
  done: boolean;
}

const ABORT = new Error('aborted');

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [grid, setGrid] = useState<GridT>(IDLE_GRID);
  const [spinning, setSpinning] = useState<boolean[]>([false, false, false, false, false]);
  const [lit, setLit] = useState<Set<string> | null>(null);
  const [lines, setLines] = useState<{ line: number; run: number }[]>([]);
  const [free, setFree] = useState<{ n: number; of: number } | null>(null);
  const [lock, setLock] = useState<LockView | null>(null);
  const [status, setStatus] = useState('Ready: 40 lines, bet to spin');
  const [tone, setTone] = useState<'idle' | 'live' | 'won' | 'lost'>('idle');
  const [won, setWon] = useState(0);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const seq = useRef(0);
  const placing = useRef(false);
  const live = useRef(false);
  const resolved = useRef(0);
  const spinRef = useRef<boolean[]>([false, false, false, false, false]);
  const flick = useRef<number | null>(null);
  const fast = useRef(false);

  // The whole round is drawn right after the bet is placed; `resolved` is its total, set in the
  // same handler. Leaving mid-replay settles it (the same as finishing). Never reads rendered state.
  const ticket = useTicket(() => (live.current ? resolved.current : 0));

  useEffect(
    () => () => {
      if (flick.current !== null) window.clearInterval(flick.current);
    },
    [],
  );

  const T = (ms: number) => eventMs(fast.current, ms);
  const wait = async (ms: number) => {
    if (!(await timers.wait(T(ms)))) throw ABORT;
  };

  const setSpin = (v: boolean[]) => {
    spinRef.current = v;
    setSpinning(v);
  };

  function startFlicker() {
    if (flick.current !== null) return;
    flick.current = window.setInterval(() => {
      setGrid((g) =>
        g.map((col, r) => (spinRef.current[r] ? col.map(() => (r === 0 || r === 4 ? OUTER_SYMS[rng.int(OUTER_SYMS.length)] : INNER_SYMS[rng.int(INNER_SYMS.length)])) : col)),
      );
    }, 70);
  }
  function stopFlicker() {
    if (flick.current !== null) window.clearInterval(flick.current);
    flick.current = null;
  }

  async function showSpin(ev: SpinEvent) {
    setLock(null);
    setLit(null);
    setLines([]);
    setFree(ev.free ? { n: ev.n, of: ev.of } : null);
    setTone('live');
    setStatus(ev.free ? `Free spin ${ev.n} of ${ev.of}` : 'Spinning');
    setSpin([true, true, true, true, true]);
    startFlicker();
    await wait(450);
    for (let r = 0; r < 5; r++) {
      const next = spinRef.current.slice();
      next[r] = false;
      spinRef.current = next;
      setGrid((g) => g.map((col, i) => (i === r ? ev.grid[r] : col)));
      setSpinning(next);
      if (r < 4) await wait(150);
    }
    stopFlicker();
    const cells = new Set<string>();
    for (const w of ev.wins) paylineCells(w.line, w.run).forEach((c) => cells.add(c));
    setLit(cells);
    setLines(ev.wins.map((w) => ({ line: w.line, run: w.run })));
    const extra = ev.added > 0 ? `, +${ev.added} spins` : ev.awarded > 0 ? ', 10 free spins' : '';
    setStatus(ev.pay > 0 ? `Pays ${fmtMult(ev.pay)}${extra}` : ev.lock ? 'Lock opens' : ev.awarded || ev.added ? `No pay${extra}` : 'No 3 in a row from left');
    await wait(ev.pay > 0 || ev.lock || ev.awarded || ev.added ? 700 : 300);
  }

  async function showLock(ev: LockEvent, trigger: GridT) {
    const cells = new Set<string>();
    for (const reel of [0, 4]) if (trigger[reel].every((s) => s === KEY)) trigger[reel].forEach((_, row) => cells.add(`${reel}-${row}`));
    setLit(cells);
    setLines([]);
    let held = new Array<boolean>(12).fill(false);
    setLock({ held, landed: null, left: LOCK_RESPINS, done: false });
    setTone('live');
    setStatus('Lock: 5 respins');
    await wait(600);
    for (let i = 0; i < ev.respins.length; i++) {
      const rs = ev.respins[i];
      setStatus(`Respin ${i + 1} of ${LOCK_RESPINS}`);
      setLock({ held, landed: null, left: LOCK_RESPINS - i, done: false });
      setSpinning([false, false, false, false, false]);
      await wait(450);
      held = rs.held;
      const n = held.filter(Boolean).length;
      setLock({ held, landed: rs.landed, left: LOCK_RESPINS - i - 1, done: false });
      setStatus(`Respin ${i + 1} of ${LOCK_RESPINS}, ${n} locked`);
      await wait(350);
    }
    setLock({ held, landed: null, left: 0, done: true });
    setStatus(ev.pay > 0 ? `Lock paid ${fmtMult(ev.pay)}` : 'Lock paid nothing');
    await wait(700);
  }

  async function replay(round: Round) {
    let running = 0;
    let trigger: GridT = IDLE_GRID;
    for (const ev of round.events) {
      if (ev.type === 'spin') {
        trigger = ev.grid;
        await showSpin(ev);
      } else {
        await showLock(ev, trigger);
      }
      running += ev.pay;
      setWon(running);
    }
  }

  async function playOnce(stake: number): Promise<number | null> {
    if (placing.current || live.current) return null;
    placing.current = true;
    try {
      if (!(await ticket.place(stake))) return null;
      // Draw only now that the bet is placed; the ref carries the total for a leave mid-replay.
      const round = playRound(rng);
      resolved.current = round.multiplier;
      live.current = true;
      setBusy(true);
      setLast(null);
      setWon(0);
      try {
        await replay(round);
      } catch (e) {
        if (e === ABORT) return null;
        throw e;
      }
      ticket.settle(round.multiplier);
      pushHistory(round.multiplier);
      setLast({ id: ++seq.current, multiplier: round.multiplier, stake });
      setTone(round.multiplier > 1 ? 'won' : 'lost');
      setFree(null);
      setStatus(round.multiplier > 0 ? `Round paid ${fmtMult(round.multiplier)}` : 'No win this round');
      return round.multiplier;
    } finally {
      placing.current = false;
      live.current = false;
      stopFlicker();
      setSpin([false, false, false, false, false]);
      setBusy(false);
    }
  }

  const auto = useAutoBet({ bet, play: playOnce, turbo: turbo.turbo });
  fast.current = turbo.turbo || auto.running;
  const working = busy || auto.running;

  useHotkeys({ space: () => (auto.mode === 'manual' && !working && !bet.blocked ? void playOnce(bet.value) : undefined) }, !infoOpen);

  const stars = grid.reduce((n, col) => n + col.filter((s) => s === SCATTER).length, 0);
  const leftKeys = grid[0].filter((s) => s === KEY).length;
  const rightKeys = grid[4].filter((s) => s === KEY).length;
  const heldCount = lock ? lock.held.filter(Boolean).length : null;
  const dist = lock ? lockDistribution(heldCount ?? 0, lock.left) : lockDistribution(0, LOCK_RESPINS);

  return (
    <GameLayout
      name="Holdfast"
      accent={ACCENTS.blue}
      panel={
        <>
          <ModeTabs auto={auto} disabled={busy} />
          <BetField bet={bet} disabled={working} />
          {auto.mode === 'manual' ? (
            <ActionButton disabled={working || !!bet.blocked} onClick={() => void playOnce(bet.value)}>
              {busy ? 'Spinning…' : 'Bet'}
            </ActionButton>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || busy} />
          )}
          {bet.blocked && <p className="hf-blocked">{bet.blocked}</p>}
          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <ChanceBar p={featureChance()} label="Chance a spin starts a feature" />
      <Readouts
        items={[
          { label: 'Round win', value: fmtMult(won), tone: 'prize' },
          ...(free ? [{ label: 'Free spin', value: `${free.n} of ${free.of}` }] : []),
        ]}
      />
      <Board className="hf-board">
        <InstantResult multiplier={last && !busy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />
        <div className="hf-machine">
          <Grid grid={grid} spinning={spinning} lit={lit} held={lock?.held ?? null} landed={lock?.landed ?? null} wins={lines} respinning={!!lock && !lock.done && lock.landed === null} />
          {!lock && (
            <div className="hf-feat" role="group" aria-label="Feature progress">
              <span className={stars >= 3 ? 'on' : ''}>Stars {stars}/3: free spins</span>
              <span className={leftKeys === 3 ? 'on' : ''}>Left keys {leftKeys}/3: lock</span>
              <span className={rightKeys === 3 ? 'on' : ''}>Right keys {rightKeys}/3: lock</span>
            </div>
          )}
          <p className="hf-key-line">Green line: win. Wild W: any but star.</p>
          <Track dist={dist} count={heldCount} done={lock?.done ?? false} />
        </div>
      </Board>
      <Caption>{RULE}</Caption>

      {infoOpen && (
        <InfoModal title="Holdfast" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Land matching symbols along 40 fixed lines, and trigger free spins or the lock feature for bigger pays.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Set your bet and press Bet (or Space). All 40 lines always play; the bet is the only setting.</li>
              <li>Lines pay from the left reel. The Wild stands in for every symbol except the star. A line pays its best symbol only.</li>
              <li>Three or more stars on the middle three columns award 10 free spins, on a richer paytable. More stars during free spins add 10 more, up to {FREE_CAP} in all.</li>
              <li>A full column of keystones on the left or right reel opens the lock: 5 respins of the 12 middle cells. Keystones that land stay locked. It pays by how many you hold.</li>
              <li>Auto runs a series of bets with your own stop rules. Pays are in multiples of the whole bet.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The bar shows the chance a spin starts a feature: free spins {fmtOneIn(pScatter3())}, lock {fmtOneIn(pLock())}. In the lock each open middle cell
              lands a keystone with 12% per respin. The bars on the track show the exact chance of ending on each count, and update after every respin.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Every cell is drawn independently from a fixed weight table, so the return is exact: RTP = 40 L + t E + q N (40 Lf + t E), where L and Lf are the expected
              pay of one line (base and free spins), t the chance a spin opens the lock, E the lock&apos;s expected pay, q the chance of 3+ stars and N the expected free spins
              from one award (with the {FREE_CAP}-spin cap).
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>Pays for 3, 4 and 5 in a row, times the whole bet. Return to player {(RTP * 100).toFixed(2)}%, the same for every bet. There is no cash-out.</p>
            <table className="hf-pay">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Base 4 / 5</th>
                  <th>Free 3 / 4 / 5</th>
                </tr>
              </thead>
              <tbody>
                {[4, 2, 0, 7, WILD, KEY].map((s) => (
                  <tr key={s}>
                    <td>
                      <SymbolArt sym={s} /> {SHAPE_NAME[s]}
                    </td>
                    <td>{s === KEY ? `0.5 / 1 / 1.5 (3-5)` : `${PAY_BASE[s][1]} / ${PAY_BASE[s][2]}`}</td>
                    <td>{PAY_FREE[s].join(' / ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>Shapes in the same tier pay the same. Lock pays for 1 to 12 held: {LOCK_PAY.slice(1).join(', ')}.</p>
            <p>The largest possible round is far beyond what anyone will see; nothing is capped, so the return stays exact. Stake {formatAmount(1, 2)} returns {(RTP * 100).toFixed(2)} on average.</p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}

/** The cells a winning line covers: its first `run` reels. */
function paylineCells(line: number, run: number): string[] {
  return PAYLINES[line].slice(0, run).map((row, r) => `${r}-${row}`);
}
