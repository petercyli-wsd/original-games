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
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import { TowerBoard, type TowerView } from './Board';
import {
  DIFFICULTIES,
  DIFFICULTY,
  MAX_MULTIPLIER,
  PATTERNS,
  ROWS,
  RTP,
  buildTower,
  climb,
  multiplier,
  patternColumns,
  reachChance,
  rowSafe,
  summit,
  volatilityOf,
  type Difficulty,
  type Pattern,
  type Tower,
} from './math';

type Phase = 'idle' | 'live' | 'revealing' | 'over';
type Outcome = 'bust' | 'cashed' | 'summit';

interface Round {
  difficulty: Difficulty;
  stake: number;
  tower: Tower;
  picks: number[];
  cash: number;
  outcome: Outcome | null;
  bust: number | null;
}

interface AutoView {
  difficulty: Difficulty;
  tower: Tower;
  picks: number[];
  bust: number | null;
  pending: { row: number; col: number } | null;
  showAll: boolean;
  target: number;
  columns: number[];
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const OUTCOME_TITLE: Record<Outcome, string> = { bust: 'Trap hit', cashed: 'Cashed out', summit: 'Summit reached' };

const rowsWord = (n: number) => `${n} ${n === 1 ? 'row' : 'rows'}`;

/** Little dot strip for the difficulty picker: lit = safe tiles, dark = traps. */
function SafeDots({ d }: { d: Difficulty }) {
  const { tiles, safe } = DIFFICULTY[d];
  return (
    <span className="tw-dots" aria-hidden="true">
      {Array.from({ length: tiles }, (_, i) => (
        <i key={i} className={i < safe ? 's' : 't'} />
      ))}
    </span>
  );
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [pending, setPending] = useState<{ row: number; col: number } | null>(null);
  const [shake, setShake] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);

  // Auto choices: a target row and a pick pattern (Custom = tiles set on the board).
  const [target, setTarget] = useState(4);
  const [pattern, setPattern] = useState<Pattern>('random');
  const [custom, setCustom] = useState<number[]>(() => Array.from({ length: ROWS }, (_, r) => r % 2));
  const [autoView, setAutoView] = useState<AutoView | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const seq = useRef(0);

  // What an open bet is worth if the game unmounts. Set synchronously the
  // moment it changes (not from render state, which can lag a tick): the
  // stake's fair value 0.99 before any pick, the decided cash-out once a tile
  // is clicked (the tower was built at bet time, so leaving mid-flip settles
  // at the real result, 0 on a trap), and an auto bet's decided payout.
  const fair = useRef(0);
  const ticket = useTicket(() => fair.current);

  const flipMs = turbo.turbo ? 80 : 300;
  const autoStepMs = turbo.turbo ? 35 : 120;
  const live = phase === 'live' || phase === 'revealing';
  const spec = DIFFICULTY[difficulty];

  // ---------- Manual round ----------

  function finish(r: Round, outcome: Outcome, cash: number, bust: number | null = null) {
    fair.current = 0;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash, bust });
    setPending(null);
    setPhase('over');
    if (bust !== null) setShake((s) => s + 1);
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    fair.current = RTP;
    timers.clearAll();
    setAutoView(null);
    setLast(null);
    setRound({ difficulty, stake: bet.value, tower: buildTower(difficulty, (xs) => rng.shuffle(xs)), picks: [], cash: RTP, outcome: null, bust: null });
    setPending(null);
    setPhase('live');
  }

  function pick(col: number) {
    if (phase !== 'live' || !round) return;
    const row = round.picks.length;
    if (row >= ROWS || col < 0 || col >= DIFFICULTY[round.difficulty].tiles) return;
    const safe = round.tower[row][col];
    const cash = safe ? multiplier(round.difficulty, row + 1) : 0;
    fair.current = cash;
    setPending({ row, col });
    setPhase('revealing');
    timers.after(flipMs, () => {
      const next = { ...round, picks: [...round.picks, col] };
      if (!safe) return finish(next, 'bust', 0, row);
      next.cash = cash;
      if (next.picks.length >= ROWS) return finish(next, 'summit', cash);
      setRound(next);
      setPending(null);
      setPhase('live');
      track({ type: 'checkpoint', multiplier: cash, winChance: rowSafe(round.difficulty) });
    });
  }

  function pickRandom() {
    if (phase !== 'live' || !round) return;
    pick(rng.int(DIFFICULTY[round.difficulty].tiles));
  }

  function cashOut() {
    if (phase !== 'live' || !round || round.picks.length === 0 || !ticket.active()) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setAutoView(null);
    setPending(null);
    setLast(null);
    setPhase('idle');
  }

  // ---------- Auto ----------

  const selection = pattern === 'random' ? Array.from({ length: target }, () => -1) : patternColumns(pattern, difficulty, target, custom, () => 0);

  async function playAuto(stake: number): Promise<number | null> {
    const d = difficulty;
    const tgt = target;
    if (!(await ticket.place(stake))) return null;
    const tower = buildTower(d, (xs) => rng.shuffle(xs));
    const columns = patternColumns(pattern, d, tgt, custom, (n) => rng.int(n));
    const res = climb(tower, d, columns);
    fair.current = res.multiplier;
    setAutoBusy(true);
    setRound(null);
    setPhase('idle');
    setLast(null);
    const view: AutoView = { difficulty: d, tower, picks: [], bust: null, pending: null, showAll: false, target: tgt, columns };
    setAutoView(view);
    for (let i = 0; i < res.picks.length; i++) {
      view.pending = { row: i, col: res.picks[i] };
      setAutoView({ ...view });
      await timers.wait(autoStepMs);
      view.picks = res.picks.slice(0, i + 1);
      view.pending = null;
      setAutoView({ ...view });
    }
    view.bust = res.bust;
    view.showAll = true;
    setAutoView({ ...view });
    if (res.bust !== null) setShake((s) => s + 1);
    fair.current = 0;
    ticket.settle(res.multiplier);
    pushHistory(res.multiplier);
    setLast({ id: ++seq.current, multiplier: res.multiplier, stake });
    setAutoBusy(false);
    return res.multiplier;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  const autoLocked = auto.running || autoBusy;

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    timers.clearAll();
    setRound(null);
    setAutoView(null);
    setLast(null);
    setPending(null);
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  /** Any auto-choice edit clears the last auto result off the board. */
  function editAuto(apply: () => void) {
    if (autoLocked) return;
    apply();
    setAutoView(null);
    setLast(null);
  }

  // Auto: clicking a tile sets that row's column (switching to Custom), and
  // raises the target to that row. Clicking the top marked tile lowers it.
  function selectTile(row: number, col: number) {
    editAuto(() => {
      const cols = Array.from({ length: ROWS }, (_, r) => (r < target && pattern !== 'random' ? selection[r] : custom[r] ?? 0));
      if (row === target - 1 && selection[row] === col && target > 1) {
        setTarget(target - 1);
        return;
      }
      cols[row] = col;
      setCustom(cols);
      setPattern('custom');
      if (row + 1 > target) setTarget(row + 1);
    });
  }

  function changeTarget(t: number) {
    editAuto(() => setTarget(Math.min(ROWS, Math.max(1, t))));
  }

  // Changing the difficulty clears a finished board.
  function changeDifficulty(d: Difficulty) {
    if (d === difficulty || live || autoLocked) return;
    setDifficulty(d);
    if (phase === 'over' || autoView || last) clear();
  }

  function onTile(row: number, col: number) {
    if (isAuto) selectTile(row, col);
    else if (round && row === round.picks.length) pick(col);
  }

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'live') pickRandom();
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // 1–4 pick that tile in the current row.
  const pickRef = useRef(pick);
  pickRef.current = pick;
  useEffect(() => {
    if (infoOpen || isAuto) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= 4) pickRef.current(n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen, isAuto]);

  // ---------- What the board shows ----------

  const d = isAuto ? autoView?.difficulty ?? difficulty : round?.difficulty ?? difficulty;
  const { tiles, safe } = DIFFICULTY[d];
  const cleared = isAuto ? 0 : round ? (round.bust ?? round.picks.length) : 0;
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const p = rowSafe(d);
  const vol = volatilityOf(difficulty);

  const view: TowerView = isAuto
    ? autoView
      ? { difficulty: autoView.difficulty, tower: autoView.tower, picks: autoView.picks, bust: autoView.bust, pending: autoView.pending, showAll: autoView.showAll, active: null }
      : { difficulty, tower: null, picks: [], bust: null, pending: null, showAll: false, active: null }
    : {
        difficulty: d,
        tower: round?.tower ?? null,
        picks: round?.picks ?? [],
        bust: round?.bust ?? null,
        pending,
        showAll: phase === 'over',
        active: live && round ? round.picks.length : null,
      };

  const autoWon = isAuto && !!last && last.multiplier > 0 && !autoBusy;
  const manualWon = !isAuto && phase === 'over' && !!round && round.cash > 0;

  let status = `Ready · ${spec.label}, ${safe} of ${tiles} safe`;
  let tone: 'idle' | 'live' | 'won' | 'lost' = 'idle';
  if (isAuto) {
    if (auto.running || autoBusy) {
      status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ' · running'}`;
      tone = 'live';
    } else if (last) {
      status = last.multiplier > 0 ? `Row ${autoView?.target ?? target} reached · ${fmtMult(last.multiplier)}` : `Trap on row ${(autoView?.bust ?? 0) + 1}`;
      tone = last.multiplier > 0 ? 'won' : 'lost';
    } else status = `Auto · climb to row ${target}, ${PATTERNS.find((x) => x.value === pattern)!.label.toLowerCase()} picks`;
  } else if (phase === 'revealing') {
    status = `Row ${cleared + 1} of ${ROWS} · revealing…`;
    tone = 'live';
  } else if (phase === 'live') {
    status = cleared === 0 ? 'Pick a tile in row 1' : `Row ${cleared + 1} of ${ROWS} · pick a tile`;
    tone = 'live';
  } else if (phase === 'over' && round?.outcome) {
    status = round.outcome === 'bust' ? `Trap on row ${(round.bust ?? 0) + 1}` : `${OUTCOME_TITLE[round.outcome]} · ${rowsWord(cleared)}`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  const nextRow = Math.min(ROWS, cleared + 1);
  const readouts: ReadoutItem[] = isAuto
    ? [
        { label: 'Win chance', value: fmtChance(reachChance(difficulty, target)), sub: `clear ${rowsWord(target)}`, tone: 'chance' },
        { label: 'Payout', value: fmtMult(multiplier(difficulty, target)), sub: `pays ${formatAmount(bet.value * multiplier(difficulty, target), 2)}`, tone: 'cash' },
        { label: 'Summit', value: fmtMult(summit(difficulty)), sub: `${spec.label} · row ${ROWS}`, tone: 'prize' },
      ]
    : [
        {
          label: 'Next row safe',
          value: phase === 'over' ? '—' : fmtChance(p),
          sub: phase === 'over' ? `${safe} of ${tiles} tiles` : `${safe} of ${tiles} tiles in row ${nextRow}`,
          tone: 'chance',
        },
        {
          label: phase === 'over' ? (round?.outcome === 'bust' ? 'Paid' : OUTCOME_TITLE[round?.outcome ?? 'cashed']) : 'Cash out now',
          value: (live && cleared > 0) || phase === 'over' ? fmtMult(cash) : '—',
          sub: (live && cleared > 0) || phase === 'over' ? formatAmount(stake * cash, 2) : 'after row 1',
          tone: 'cash',
        },
        {
          label: 'Next row pays',
          value: phase === 'over' ? '—' : fmtMult(multiplier(d, nextRow)),
          sub: phase === 'over' ? 'round over' : `pays ${formatAmount(stake * multiplier(d, nextRow), 2)}`,
          tone: 'prize',
        },
      ];

  const difficultyPicker = (
    <>
      <Label hint={<VolBadge level={vol} />}>Difficulty</Label>
      <div className="tw-diff" role="radiogroup" aria-label="Difficulty">
        {DIFFICULTIES.map((x) => (
          <button
            key={x}
            type="button"
            role="radio"
            aria-checked={x === difficulty}
            className={'tw-diff-opt' + (x === difficulty ? ' on' : '')}
            disabled={live || autoLocked}
            title={`${DIFFICULTY[x].safe} safe of ${DIFFICULTY[x].tiles} per row · summit ${fmtMult(summit(x))}`}
            onClick={() => changeDifficulty(x)}
          >
            <span>{DIFFICULTY[x].label}</span>
            <SafeDots d={x} />
          </button>
        ))}
      </div>
    </>
  );

  return (
    <GameLayout
      name="Tower"
      accent="#fb923c"
      className="tw-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={live || autoLocked} />
          {difficultyPicker}

          {!isAuto ? (
            <>
              {live ? (
                <>
                  <Label hint={fmtMult(cleared > 0 ? cash : 0)}>Total profit</Label>
                  <div className={'tw-profit' + (cleared > 0 ? ' up' : '')}>
                    {cleared > 0 ? '+' : ''}
                    {formatAmount(cleared > 0 ? stake * cash - stake : 0, 2)}
                  </div>
                </>
              ) : (
                <dl className="og-stats">
                  <dt>Each row safe</dt>
                  <dd>{fmtChance(rowSafe(difficulty))}</dd>
                  <dt>Row 1 pays</dt>
                  <dd>{fmtMult(multiplier(difficulty, 1))}</dd>
                  <dt>Summit pays</dt>
                  <dd>{fmtMult(summit(difficulty))}</dd>
                  <dt>Reach the summit</dt>
                  <dd>{fmtChance(reachChance(difficulty, ROWS))}</dd>
                </dl>
              )}

              {live ? (
                <>
                  <ActionButton kind="cash" disabled={phase !== 'live' || cleared === 0} onClick={cashOut}>
                    Cash out <span>{formatAmount(cleared > 0 ? stake * cash : 0, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" disabled={phase !== 'live'} onClick={pickRandom}>
                    Random pick
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={!!bet.blocked} onClick={() => void start()}>
                  {phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <div className="tw-auto-pair">
                <div>
                  <Label>Target row</Label>
                  <div className="tw-stepper">
                    <button type="button" aria-label="Lower target row" disabled={autoLocked || target <= 1} onClick={() => changeTarget(target - 1)}>
                      −
                    </button>
                    <span>{target}</span>
                    <button type="button" aria-label="Raise target row" disabled={autoLocked || target >= ROWS} onClick={() => changeTarget(target + 1)}>
                      +
                    </button>
                  </div>
                </div>
                <div>
                  <Label>Pays</Label>
                  <div className="tw-pays">{fmtMult(multiplier(difficulty, target))}</div>
                </div>
              </div>
              <Label hint={pattern === 'custom' ? 'set on the board' : 'or click tiles'}>Pick pattern</Label>
              <div className="tw-pattern">
                <Chips label="Pick pattern" options={PATTERNS} value={pattern} disabled={autoLocked} onChange={(v) => editAuto(() => setPattern(v))} />
              </div>
            </AutoBetControls>
          )}
          {bet.blocked && <p className="tw-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className={'tw-board' + (isAuto ? ' auto' : '')}>
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <TowerBoard
          view={view}
          selection={isAuto ? autoView?.columns ?? selection : null}
          target={isAuto ? autoView?.target ?? target : null}
          clickable={isAuto ? !autoLocked : phase === 'live'}
          onTile={onTile}
          shakeKey={shake}
          won={manualWon || autoWon}
          hotkeys={!isAuto && phase === 'live'}
        />
      </Board>

      {!isAuto && phase === 'over' && round?.outcome ? (
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
      ) : !isAuto && live ? (
        <ChanceBar p={p} label={`Row ${nextRow} tile is safe`} note={`${safe} of the ${tiles} tiles in every row are safe, whichever you pick. Keys 1–${tiles} pick a tile.`} />
      ) : (
        <Caption>
          {isAuto
            ? `Each bet climbs to row ${target} with ${pattern === 'random' ? 'a random tile per row' : 'the marked tiles'}. Reaching it pays ${fmtMult(multiplier(difficulty, target))}; a trap on the way loses.`
            : `Nine rows, ${safe} safe ${safe === 1 ? 'tile' : 'tiles'} of ${tiles} in each. Press Bet, then climb. Cash out after any row. RTP ${(RTP * 100).toFixed(0)}%.`}
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Tower" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Climb the nine-row tower one tile at a time. Every safe tile lifts you a row and raises your multiplier; a trap ends the round. Cash out whenever you like, or reach the summit.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose a difficulty and your bet, then press Bet.</li>
              <li>Pick a tile in the glowing bottom row (click, keys 1–{tiles}, or Random pick / Space).</li>
              <li>After each safe row, cash out (C) or keep climbing. Clearing row 9 pays the summit prize automatically.</li>
              <li>When the round ends, every row is revealed so you can see where the traps were.</li>
              <li>Auto: set a target row and a pick pattern (Random, Left, Right, Zigzag, or Custom by clicking tiles on the board), then Start autobet. Each bet climbs to the target and pays its multiplier if every pick is safe.</li>
              <li>Keys: Space bets (or picks at random during a round, or starts and stops Auto), C cashes out, Esc clears a finished board.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Each row hides {safe} safe {safe === 1 ? 'tile' : 'tiles'} among {tiles}, placed at random when you bet, independently for every row. So every
              tile you could pick is safe with the same chance, {fmtChance(p)}: no column, pattern or streak is luckier than another. The bar under the tower is that
              chance, and the number beside each row is what you can cash out once it is cleared.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              With s safe tiles of t per row, clearing k rows has probability (s/t)<sup>k</sup>, a product of independent rows. The cash-out after k rows is{' '}
              {(RTP * 100).toFixed(0)}% × (t/s)<sup>k</sup>: each row multiplies it by t/s, exactly the inverse of the chance you survive it. The cash-out is
              therefore a martingale, and by the optional stopping theorem no rule for when to stop can change its expected value.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Whatever you choose (difficulty, tiles, when to cash out, Auto), the long-run return is exactly {(RTP * 100).toFixed(0)}%. The top prize is the
              Master summit, {fmtMult(MAX_MULTIPLIER)}. Payouts on {spec.label}:
            </p>
            <div className="tw-paytable">
              {Array.from({ length: ROWS }, (_, i) => i + 1).map((k) => (
                <div key={k}>
                  <span>Row {k}</span>
                  <b>{fmtMult(multiplier(difficulty, k))}</b>
                  <small>{fmtChance(reachChance(difficulty, k))}</small>
                </div>
              ))}
            </div>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
