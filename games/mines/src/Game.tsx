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
import { Gem, Grid, Ladder, type GridView } from './Board';
import {
  MAX_MINES,
  MAX_MULTIPLIER,
  MINE_PRESETS,
  MIN_MINES,
  RTP,
  TILES,
  fullClear,
  gemsFor,
  multiplier,
  nextSafe,
  placeMines,
  playSelection,
  surviveChance,
  volatilityOf,
} from './math';

type Phase = 'idle' | 'live' | 'revealing' | 'over';
type Outcome = 'bust' | 'cashed' | 'cleared';

interface Round {
  mines: number;
  stake: number;
  board: boolean[];
  revealed: number[];
  cash: number;
  outcome: Outcome | null;
  hit: number | null;
}

interface AutoView extends GridView {
  mines: number;
  selection: number[];
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const OUTCOME_TITLE: Record<Outcome, string> = { bust: 'Mine hit', cashed: 'Cashed out', cleared: 'Board cleared' };

const gemsWord = (n: number) => `${n} ${n === 1 ? 'gem' : 'gems'}`;
const minesWord = (n: number) => `${n} ${n === 1 ? 'mine' : 'mines'}`;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [mines, setMines] = useState(3);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [selection, setSelection] = useState<number[]>([]);
  const [autoView, setAutoView] = useState<AutoView | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [shake, setShake] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // A reveal is decided the moment the tile is clicked (the mines were placed
  // at bet time), so leaving mid-flip settles at its real result.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'revealing' || autoBusy ? resolved.current : round && !round.outcome ? round.cash : 0));

  const flipMs = turbo.turbo ? 70 : 260;
  const autoStepMs = turbo.turbo ? 30 : 95;
  const live = phase === 'live' || phase === 'revealing';
  const gems = gemsFor(mines);

  // ---------- Manual round ----------

  function finish(r: Round, outcome: Outcome, cash: number, hit: number | null = null) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash, hit });
    setPending(null);
    setPhase('over');
    if (hit !== null) setShake((s) => s + 1);
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setAutoView(null);
    setLast(null);
    setRound({ mines, stake: bet.value, board: placeMines(mines, (xs) => rng.shuffle(xs)), revealed: [], cash: RTP, outcome: null, hit: null });
    setPending(null);
    setPhase('live');
  }

  function reveal(tile: number) {
    if (phase !== 'live' || !round || round.revealed.includes(tile)) return;
    const k = round.revealed.length;
    const safe = !round.board[tile];
    const cash = safe ? multiplier(round.mines, k + 1) : 0;
    resolved.current = cash;
    setPending(tile);
    setPhase('revealing');
    timers.after(flipMs, () => {
      const next = { ...round, revealed: [...round.revealed, tile] };
      if (!safe) return finish(next, 'bust', 0, tile);
      next.cash = cash;
      if (next.revealed.length >= gemsFor(round.mines)) return finish(next, 'cleared', cash);
      setRound(next);
      setPending(null);
      setPhase('live');
      track({ type: 'checkpoint', multiplier: cash, winChance: nextSafe(round.mines, k + 1) });
    });
  }

  function pickRandom() {
    if (phase !== 'live' || !round) return;
    const hidden = Array.from({ length: TILES }, (_, i) => i).filter((t) => !round.revealed.includes(t));
    reveal(hidden[rng.int(hidden.length)]);
  }

  function cashOut() {
    if (phase !== 'live' || !round || round.revealed.length === 0) return;
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

  async function playAuto(stake: number): Promise<number | null> {
    const sel = selection;
    const m = mines;
    if (sel.length === 0 || sel.length > gemsFor(m)) return null;
    if (!(await ticket.place(stake))) return null;
    const board = placeMines(m, (xs) => rng.shuffle(xs));
    const res = playSelection(board, m, sel);
    resolved.current = res.multiplier;
    setAutoBusy(true);
    setRound(null);
    setPhase('idle');
    setLast(null);
    const view: AutoView = { mines: m, selection: sel, board, revealed: [], hit: null, showAll: false, pending: null };
    setAutoView(view);
    for (let i = 0; i < res.revealed.length; i++) {
      view.revealed = res.revealed.slice(0, i + 1);
      view.pending = res.revealed[i];
      setAutoView({ ...view });
      await timers.wait(autoStepMs);
    }
    view.pending = null;
    view.hit = res.hit;
    view.showAll = true;
    setAutoView({ ...view });
    if (res.hit !== null) setShake((s) => s + 1);
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
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  function toggleSelect(tile: number) {
    if (autoLocked) return;
    setAutoView(null);
    setLast(null);
    setSelection((s) => (s.includes(tile) ? s.filter((t) => t !== tile) : s.length < gems ? [...s, tile] : s));
  }

  function addRandomSelection() {
    if (autoLocked) return;
    setAutoView(null);
    setLast(null);
    setSelection((s) => {
      if (s.length >= gems) return s;
      const free = Array.from({ length: TILES }, (_, i) => i).filter((t) => !s.includes(t));
      return [...s, free[rng.int(free.length)]];
    });
  }

  // Changing the mine count clears a finished board and trims the auto picks.
  function changeMines(m: number) {
    const v = Math.min(MAX_MINES, Math.max(MIN_MINES, Math.round(m)));
    if (v === mines || live || autoLocked) return;
    setMines(v);
    setSelection((s) => s.slice(0, gemsFor(v)));
    if (phase === 'over' || autoView) clear();
  }

  function onTile(tile: number) {
    if (isAuto) toggleSelect(tile);
    else reveal(tile);
  }

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && selection.length > 0 && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'live') pickRandom();
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const m = isAuto ? autoView?.mines ?? mines : round?.mines ?? mines;
  const g = gemsFor(m);
  const found = isAuto ? 0 : round ? round.revealed.length - (round.hit !== null ? 1 : 0) : 0;
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const n = selection.length;
  const vol = volatilityOf(mines);

  const view: GridView = isAuto
    ? autoView ?? { board: null, revealed: [], hit: null, showAll: false, pending: null }
    : {
        board: round?.board ?? null,
        revealed: round?.revealed ?? [],
        hit: round?.hit ?? null,
        showAll: phase === 'over',
        pending,
      };

  let status = `Ready · ${minesWord(m)}, ${gemsWord(g)}`;
  let tone: 'idle' | 'live' | 'won' | 'lost' = 'idle';
  if (isAuto) {
    if (auto.running) {
      status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ' · running'}`;
      tone = 'live';
    } else if (last) {
      status = last.multiplier > 0 ? `${n === 1 ? 'Safe' : `All ${n} safe`} · ${fmtMult(last.multiplier)}` : 'Mine hit';
      tone = last.multiplier > 0 ? 'won' : 'lost';
    } else status = n ? `Auto · ${n} ${n === 1 ? 'tile' : 'tiles'} selected` : 'Auto · select tiles on the board';
  } else if (phase === 'revealing') {
    status = 'Revealing…';
    tone = 'live';
  } else if (phase === 'live') {
    status = found === 0 ? 'Pick a tile' : `${gemsWord(found)} found`;
    tone = 'live';
  } else if (phase === 'over' && round?.outcome) {
    status = `${OUTCOME_TITLE[round.outcome]} · ${gemsWord(found)}`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  const pSafe = nextSafe(m, found);
  const readouts: ReadoutItem[] = isAuto
    ? [
        { label: 'Win chance', value: n ? fmtChance(surviveChance(mines, n)) : '—', sub: n ? (n === 1 ? 'the tile is safe' : `all ${n} tiles safe`) : 'select tiles', tone: 'chance' },
        { label: 'Payout', value: n ? fmtMult(multiplier(mines, n)) : '—', sub: n ? formatAmount(bet.value * multiplier(mines, n), 2) : minesWord(mines), tone: 'cash' },
        { label: 'Board', value: `${mines} / ${gems}`, sub: 'mines / gems', tone: 'prize' },
      ]
    : phase === 'over' && round?.outcome
      ? [
          { label: 'Gems found', value: `${found} / ${g}`, sub: minesWord(m), tone: 'neutral' },
          { label: 'Result', value: fmtMult(cash), sub: round.outcome === 'bust' ? 'mine hit' : OUTCOME_TITLE[round.outcome].toLowerCase(), tone: cash > 0 ? 'cash' : 'neutral' },
          {
            label: 'Profit',
            value: `${cash >= 1 ? '+' : '−'}${formatAmount(Math.abs(stake * cash - stake), 2)}`,
            sub: `bet ${formatAmount(stake, 2)}`,
            tone: cash >= 1 ? 'prize' : 'neutral',
          },
        ]
      : [
          { label: 'Next tile safe', value: fmtChance(pSafe), sub: `${gemsWord(g - found)} in ${TILES - found} tiles`, tone: 'chance' },
          { label: 'Cash out now', value: found > 0 ? fmtMult(cash) : '—', sub: found > 0 ? formatAmount(stake * cash, 2) : 'after the first gem', tone: 'cash' },
          { label: 'Next gem', value: fmtMult(multiplier(m, found + 1)), sub: `pays ${formatAmount(stake * multiplier(m, found + 1), 2)}`, tone: 'prize' },
        ];

  const minesPicker = (
    <>
      <div className="mines-pair">
        <div>
          <Label hint={<VolBadge level={vol} />}>Mines</Label>
          <div className="mines-stepper">
            <button type="button" aria-label="Fewer mines" disabled={live || autoLocked || mines <= MIN_MINES} onClick={() => changeMines(mines - 1)}>
              −
            </button>
            <select aria-label="Mines" value={mines} disabled={live || autoLocked} onChange={(e) => changeMines(Number(e.target.value))}>
              {Array.from({ length: MAX_MINES }, (_, i) => i + 1).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <button type="button" aria-label="More mines" disabled={live || autoLocked || mines >= MAX_MINES} onClick={() => changeMines(mines + 1)}>
              +
            </button>
          </div>
        </div>
        <div>
          <Label>Gems</Label>
          <div className="mines-gems-box">
            <span className="mines-ico">
              <Gem />
            </span>
            {gems}
          </div>
        </div>
      </div>
      {!isAuto && (
        <Chips
          label="Mine presets"
          options={MINE_PRESETS.map((v): { value: number; label: number } => ({ value: v, label: v }))}
          value={mines}
          disabled={live || autoLocked}
          onChange={(v) => changeMines(v)}
        />
      )}
    </>
  );

  return (
    <GameLayout
      name="Mines"
      accent="#22c55e"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={live || autoLocked} />
          {minesPicker}

          {!isAuto ? (
            <>
              {live ? (
                <>
                  <Label hint={fmtMult(found > 0 ? cash : 0)}>Total profit</Label>
                  <div className={'mines-profit' + (found > 0 ? ' up' : '')}>
                    {found > 0 ? '+' : ''}
                    {formatAmount(found > 0 ? stake * cash - stake : 0, 2)}
                  </div>
                </>
              ) : (
                <dl className="og-stats">
                  <dt>First tile safe</dt>
                  <dd>{fmtChance(nextSafe(mines, 0))}</dd>
                  <dt>First gem pays</dt>
                  <dd>{fmtMult(multiplier(mines, 1))}</dd>
                  <dt>Clear the board</dt>
                  <dd>{fmtMult(fullClear(mines))}</dd>
                </dl>
              )}

              {live ? (
                <>
                  <ActionButton kind="cash" disabled={phase !== 'live' || found === 0} onClick={cashOut}>
                    Cash out <span>{formatAmount(found > 0 ? stake * cash : 0, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" disabled={phase !== 'live'} onClick={pickRandom}>
                    Pick random tile
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={!!bet.blocked} onClick={() => void start()}>
                  {phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || n === 0 || autoBusy}>
              <Label hint={n ? `${n} of max ${gems}` : 'click tiles on the board'}>Tiles to reveal</Label>
              <div className="mines-sel-row">
                <button type="button" className="og-ghost" disabled={autoLocked || n >= gems} onClick={addRandomSelection}>
                  + Random tile
                </button>
                <button
                  type="button"
                  className="og-ghost"
                  disabled={autoLocked || n === 0}
                  onClick={() => {
                    setSelection([]);
                    setAutoView(null);
                    setLast(null);
                  }}
                >
                  Clear tiles
                </button>
              </div>
            </AutoBetControls>
          )}
          {bet.blocked && <p className="mines-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className="mines-board">
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Grid
          {...view}
          selection={isAuto ? autoView?.selection ?? selection : []}
          showSelection={isAuto}
          clickable={isAuto ? !autoLocked : phase === 'live'}
          onTile={onTile}
          shakeKey={shake}
        />
      </Board>

      <Ladder mines={isAuto ? mines : m} found={isAuto ? 0 : found} target={isAuto ? n || null : null} showNext={isAuto || phase !== 'over'} />

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
        <ChanceBar p={pSafe} label="Next tile is a gem" note={`${g - found} of the ${TILES - found} hidden tiles ${g - found === 1 ? 'is a gem' : 'are gems'}, wherever you click.`} />
      ) : (
        <Caption>
          {isAuto
            ? n
              ? `Each bet reveals your ${n} marked ${n === 1 ? 'tile' : 'tiles'} in order. All safe pays ${fmtMult(multiplier(mines, n))}.`
              : 'Click tiles to mark them. Each auto bet reveals the marked set.'
            : `${minesWord(m)} hidden among ${TILES} tiles. Press Bet, then pick tiles. Cash out after any gem. RTP ${(RTP * 100).toFixed(0)}%.`}
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Mines" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Mines are hidden under some of the 25 tiles; the rest hide gems. Find gems to raise your multiplier and cash out before you uncover a mine.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose how many mines (1 to 24) and your bet, then press Bet.</li>
              <li>Click tiles to reveal them, or use Pick random tile. Each gem raises the cash-out.</li>
              <li>Cash out after any gem. A mine ends the round and loses the bet. Find every gem and the board pays out by itself.</li>
              <li>Auto: mark tiles on the board, set the number of bets and your stop rules, then Start autobet. Each bet reveals the marked tiles in order.</li>
              <li>Keys: Space bets (or picks a random tile during a round, or starts and stops Auto), C cashes out, Esc clears a finished board.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              "Next tile safe" is gems left ÷ hidden tiles. It is the same for every hidden tile: the mines are placed at random when you bet, so no tile, corner
              or pattern is luckier than another. The bar under the board is that chance.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              With m mines, the first k reveals are all gems with probability C(25 − m, k) ÷ C(25, k) (the hypergeometric distribution). The cash-out after k
              gems is {(RTP * 100).toFixed(0)}% × C(25, k) ÷ C(25 − m, k). Each gem multiplies it by (25 − k) ÷ (25 − m − k), exactly the inverse of the
              chance you survived, so every reveal is a fair bet.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Whatever you choose (mines, tiles, when to stop, Auto), the long-run return is exactly {(RTP * 100).toFixed(0)}%. The top prize is clearing 13
              gems with 12 mines: {fmtMult(MAX_MULTIPLIER)}. Payouts with {mines} {mines === 1 ? 'mine' : 'mines'}:
            </p>
            <div className="mines-paytable">
              {Array.from({ length: gems }, (_, i) => i + 1).map((k) => (
                <div key={k}>
                  <span>{gemsWord(k)}</span>
                  <b>{fmtMult(multiplier(mines, k))}</b>
                  <small>{fmtChance(surviveChance(mines, k))}</small>
                </div>
              ))}
            </div>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}

