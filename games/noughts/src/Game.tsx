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
import Field, { type SeriesSlot } from './Board';
import {
  EMPTY,
  GAMES,
  MAX_MULTIPLIER,
  RTP,
  SIDE_NAME,
  cashValue,
  cellChances,
  chances,
  completed,
  emptyCells,
  gameChance,
  newSeries,
  outcome,
  perGame,
  plan,
  prizeFor,
  startChance,
  threats,
  toMove,
  volatilityOf,
  winChance,
  type Games,
  type Grid,
  type Mode,
  type Series,
  type Side,
} from './math';

const ACCENT = '#8ecae6';

type Phase = 'idle' | 'moving' | 'checkpoint' | 'over';
type Outcome = 'won' | 'cashed' | 'lost' | 'dead';

interface Round {
  side: Side;
  games: Games;
  stake: number;
  series: Series;
  /** Finished games, in order. */
  played: Grid[];
  cash: number;
  outcome: Outcome | null;
}

interface View {
  /** The board on screen (a finished game lingers here before the next one starts). */
  grid: Grid;
  cursor: number | null;
  fresh: number | null;
}

const BLANK: View = { grid: EMPTY, cursor: null, fresh: null };

// The scanner sweeps the free cells clockwise from the corner, centre last.
const RING = [0, 1, 2, 5, 8, 7, 6, 3, 4];
function hopPath(free: number[], target: number, hops: number): number[] {
  const order = RING.filter((c) => free.includes(c));
  if (order.length < 2) return [target];
  const t = order.indexOf(target);
  return Array.from({ length: hops + 1 }, (_, k) => order[(((t - hops + k) % order.length) + order.length) % order.length]);
}

const sideLabel = (side: Side) => (side === 'D' ? 'a draw' : `${side} to win`);

function outcomeTitle(r: Round): string {
  const s = r.series;
  switch (r.outcome) {
    case 'won':
      return r.games > 1 ? `${r.games} in a row` : r.side === 'D' ? "It's a draw" : `${r.side} wins`;
    case 'cashed':
      return 'Cashed out';
    case 'dead':
      return r.side === 'D' ? 'No draw possible' : `${r.side} can't win now`;
    default: {
      const res = outcome(s.grid);
      return res === 'D' ? "It's a draw" : `${res} wins`;
    }
  }
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [side, setSide] = useState<Side>('X');
  const [games, setGames] = useState<Games>(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [view, setView] = useState<View>(BLANK);
  const [infoOpen, setInfoOpen] = useState(false);

  // An action's marks are all drawn the moment it starts, so leaving
  // mid-animation settles at the real result, never at the earlier value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'moving' ? resolved.current : round ? cashValue(round.series) : 0));

  const live = phase === 'moving' || phase === 'checkpoint';
  const speed = turbo.turbo ? 0.25 : 1;
  const ms = (t: number) => Math.max(16, Math.round(t * speed));
  const drawMs = ms(300);

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setView((v) => ({ ...v, cursor: null }));
    setPhase('over');
  }

  function settle(r: Round) {
    const s = r.series;
    if (s.status === 'won') return finish(r, 'won', prizeFor(s.side, s.games));
    if (s.status === 'lost') return finish(r, outcome(s.grid) ? 'lost' : 'dead', 0);
    setRound(r);
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: cashValue(s), winChance: winChance(s) });
  }

  /** Plays one action: a single mark, or the rest of the game. */
  async function run(r: Round, mode: Mode) {
    const moves = plan(r.series, mode, rng);
    resolved.current = cashValue(moves[moves.length - 1].next);
    setPhase('moving');
    let cur = r;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const quick = mode === 'game' || i > 0;
      const path = hopPath(emptyCells(cur.series.grid), m.cell, quick ? 2 : 4);
      for (let k = 0; k < path.length; k++) {
        setView((v) => ({ ...v, cursor: path[k] }));
        if (!(await timers.wait(ms(quick ? 45 : 44 + k * 12)))) return;
      }
      setView({ grid: m.grid, cursor: m.cell, fresh: m.cell });
      cur = { ...cur, series: m.next, played: m.ended ? [...cur.played, m.grid] : cur.played };
      setRound(cur);
      if (!(await timers.wait(ms(quick ? 200 : 280)))) return;
      setView((v) => ({ ...v, cursor: null }));
      if (m.ended && m.next.status === 'live') {
        // A game won on the way: let it sink in, then bring out a fresh board.
        if (!(await timers.wait(ms(750)))) return;
        setView(BLANK);
      } else if (m.ended) {
        if (!(await timers.wait(ms(380)))) return;
      }
    }
    settle(cur);
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { side, games, stake: bet.value, series: newSeries(side, games), played: [], cash: RTP, outcome: null };
    setRound(r);
    setView(BLANK);
    void run(r, 'move');
  }

  function step(mode: Mode) {
    if (phase !== 'checkpoint' || !round) return;
    void run(round, mode);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', cashValue(round.series));
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setView(BLANK);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' ? step('move') : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const k = round?.games ?? games;
  const sd = round?.side ?? side;
  const s = round?.series ?? newSeries(sd, k);
  const grid = view.grid;
  const result = outcome(grid);
  const odds = chances(grid);
  const over = phase === 'over';
  const cells = over || result ? null : cellChances(grid, sd);
  const mover = over || result ? null : toMove(grid);
  const atBoundary = phase === 'checkpoint' && s.won > 0 && s.grid.every((m) => m === 0);
  const marks = s.grid.filter((m) => m !== 0).length;

  const p = round ? (over ? (round.outcome === 'won' ? 1 : round.outcome === 'cashed' ? winChance(s) : 0) : winChance(s)) : startChance(sd, k);
  const cash = round ? (over ? round.cash : cashValue(s)) : RTP;
  const stake = round?.stake ?? bet.value;
  const prize = prizeFor(sd, k);
  const vol = volatilityOf(side, games);

  const slots: SeriesSlot[] = Array.from({ length: k }, (_, i) => {
    if (round && i < s.won) return { grid: round.played[i], state: 'won', line: completed(round.played[i])[0] ?? null };
    if (round && i === s.won) {
      const lost = s.status === 'lost';
      return { grid: s.grid, state: lost ? 'lost' : 'live', line: lost ? (completed(s.grid)[0] ?? null) : null };
    }
    return { grid: null, state: 'next', line: null };
  });

  let note: string | undefined;
  if (result) note = result === 'D' ? 'Board full: draw' : `${result} completes a line`;
  else if (over && round?.outcome === 'dead') note = sd === 'D' ? 'No draw possible now' : `${sd} can no longer win`;
  else if (over) note = 'Round over';

  const gamePrefix = k > 1 ? `Game ${Math.min(s.won + 1, k)} of ${k} · ` : '';
  let status = `Ready · back ${SIDE_NAME[sd]}${k > 1 ? `, ${k} in a row` : ''}`;
  if (phase === 'moving') status = result ? `${note}${result === sd ? ' · your way' : ''}` : `${gamePrefix}Next mark landing…`;
  if (phase === 'checkpoint') status = atBoundary ? `Game ${s.won} won · checkpoint` : `${gamePrefix}Checkpoint · ${marks} mark${marks === 1 ? '' : 's'} down`;
  if (over && round) status = `${outcomeTitle(round)} · ${fmtMult(round.cash)}`;
  const tone = over ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const nextName = toMove(s.grid) === 1 ? 'X' : 'O';
  const after = k - s.won - 1;
  const restNote = after === 0 ? '' : after === 1 ? ` × ${fmtChance(perGame(sd))} for the game after it` : ` × ${fmtChance(perGame(sd))} for each of the ${after} games after it`;

  return (
    <GameLayout
      name="Noughts"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Back</Label>
          <Chips
            label="Result to back"
            options={(['X', 'O', 'D'] as const).map((v) => ({ value: v, label: SIDE_NAME[v], title: `${fmtChance(perGame(v))} per game` }))}
            value={side}
            disabled={live}
            onChange={(v) => change(() => setSide(v))}
          />

          <Label hint="all must go your way">Games in a row</Label>
          <Chips
            label="Games in a row"
            options={GAMES.map((v) => ({ value: v, label: v }))}
            value={games}
            disabled={live}
            onChange={(v) => change(() => setGames(v))}
          />
          <dl className="og-stats">
            {games > 1 && (
              <>
                <dt>Each game</dt>
                <dd>{fmtChance(perGame(side))}</dd>
              </>
            )}
            <dt>Chance to win</dt>
            <dd>{fmtChance(startChance(side, games))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(side, games))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => step('move')}>
                {atBoundary ? `Start game ${s.won + 1}` : `Next mark · ${nextName}`}
              </ActionButton>
              <ActionButton kind="secondary" className="nt-auto" onClick={() => step('game')}>
                {atBoundary ? `Play game ${s.won + 1} out` : 'Play the game out'}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'moving' ? 'Marking…' : over ? 'Bet again' : 'Bet'}
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
            value: fmtChance(p),
            sub: k > 1 ? `game ${Math.min(s.won + 1, k)} of ${k}` : `${sideLabel(sd)}`,
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || over ? fmtMult(cash) : '—', sub: formatAmount(stake * cash, 2), tone: 'cash' },
          { label: 'Prize', value: fmtMult(prize), sub: k > 1 ? `${SIDE_NAME[sd]}, ${k} in a row` : `if ${SIDE_NAME[sd] === 'Draw' ? 'it is a draw' : SIDE_NAME[sd]}`, tone: 'prize' },
        ]}
      />

      <Board className="nt-stage">
        <Field
          grid={grid}
          side={sd}
          slots={slots}
          cells={cells}
          base={odds[sd]}
          odds={odds}
          threats={over || result ? [] : threats(grid)}
          lines={completed(grid)}
          result={result}
          mover={mover}
          cursor={view.cursor}
          fresh={view.fresh}
          drawMs={drawMs}
          hopMs={ms(70)}
          band={!over}
          note={note}
        />
        {over && round?.outcome && (
          // A compact card over the outcome bar, so the final board stays in view.
          <div className="nt-over">
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
          </div>
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={p}
          label="Chance to win"
          note={
            atBoundary
              ? `A fresh game: ${fmtChance(perGame(sd))} per game, ${k - s.won} still to play.`
              : `This game ${fmtChance(gameChance(s))}${restNote}. The next mark lands on a random empty cell, so the cell numbers average to this game's chance.`
          }
        />
      ) : (
        <Caption>
          X and O fill the board at random, X first. In random play X wins 737/1260 ({fmtChance(perGame('X'))}), O 121/420 ({fmtChance(perGame('O'))}) and a draw
          is 8/63 ({fmtChance(perGame('D'))}). Each cell shows your chance if the first mark lands there. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Noughts" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              X and O play noughts and crosses with no strategy at all: each mark lands on a random empty cell, X first, until someone completes a line of three or
              the board fills. Back X to win, O to win or a draw, for one game or for two or three games in a row.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the result you back and how many games in a row it must happen, then bet. The first mark goes down at once.</li>
              <li>After every mark you can cash out, place the next mark (Space), or play the rest of the game out.</li>
              <li>If the game ends your way, the next game starts (or the prize pays). If it ends another way, or your result can no longer happen, the round is lost.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Every empty cell shows your chance this game <b>if the next mark lands there</b>. <b style={{ color: 'var(--green)' }}>Green</b> cells raise it,{' '}
              <b style={{ color: 'var(--red)' }}>red</b> cells lower it, and 0% or 100% cells end the game. The next mark is equally likely to land on any empty
              cell, so your chance right now is exactly the <b>average of the cell numbers</b>.
            </p>
            <p>
              Dotted lines are threats: two marks of one kind with the third cell open. The bar under the board splits this game into X wins, draw and O wins; its
              green length is your chance. With several games in a row, multiply by the per-game chance for each game still to come.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Random-play tic-tac-toe has 4,520 unfinished positions, few enough to count every way each one can finish. From a position with n empty cells, a
              finish that takes m more marks has probability (n − m)! / n!, so n! × P is a whole number. From the empty board, out of 9! = 362,880: X wins
              212,256, O wins 104,544 and draws 46,080. So P(X) = 737/1260 ≈ 58.5%, P(O) = 121/420 ≈ 28.8% and P(draw) = 8/63 ≈ 12.7%. For k games in a row the
              chance is p<sup>k</sup>.
            </p>
            <p>
              A draw needs a very particular final pattern, so a draw bet can be dead after only three marks: from X on two edges next to one corner and O in
              the opposite corner, no way of finishing is a draw. The cell numbers show it coming.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is {(RTP * 100).toFixed(0)}% ÷ your chance to win. The cash-out is always prize × your chance to win from here. Because the next mark is a
              uniform pick, your chance now is the average of your chances after it, so the cash-out is a martingale. By the optional stopping theorem, cashing out early,
              playing a game out or stopping between games are all worth exactly {(RTP * 100).toFixed(0)}% of your stake. When your result becomes impossible the round ends; when it
              becomes certain, the rest of that game plays itself. The biggest prize is a draw three times in a row: {fmtMult(MAX_MULTIPLIER)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
