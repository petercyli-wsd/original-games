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
import Field, { type Flip } from './Board';
import {
  MAX_MULTIPLIER,
  PLAYERS,
  RTP,
  SEAT_NAMES,
  STREAKS,
  branches,
  cashValue,
  expectedDuels,
  fracText,
  newDuel,
  playDuel,
  prizeFor,
  seatChances,
  seatFraction,
  startChance,
  toNumber,
  volatilityOf,
  winChance,
  type Duel,
  type Players,
  type Settings,
  type Side,
  type Streak,
} from './math';

const ACCENT = '#e5989b';

type Phase = 'idle' | 'dueling' | 'checkpoint' | 'over';
type Outcome = 'won' | 'lost' | 'cashed';
type Mode = 'one' | 'out';

interface Round {
  settings: Settings;
  stake: number;
  duel: Duel;
  cash: number;
  outcome: Outcome | null;
}

const betName = (s: Settings) => `${s.side === 'back' ? 'Back' : 'Lay'} ${SEAT_NAMES[s.seat]}`;

function outcomeTitle(r: Round): string {
  const w = r.duel.winner;
  if (r.outcome === 'cashed') return 'Cashed out';
  return `${w === null ? '?' : SEAT_NAMES[w]} takes the pot`;
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [players, setPlayers] = useState<Players>(3);
  const [streak, setStreak] = useState<Streak>(2);
  const [seat, setSeat] = useState(0);
  const [side, setSide] = useState<Side>('back');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [flip, setFlip] = useState<Flip | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // Every coin in an action is tossed the moment it starts, so leaving
  // mid-animation settles at the real result, never at the earlier value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'dueling' ? resolved.current : round ? cashValue(round.duel, round.settings) : 0));

  const live = phase === 'dueling' || phase === 'checkpoint';
  const speed = turbo.turbo ? 0.25 : 1;
  const ms = (t: number) => Math.max(16, Math.round(t * speed));

  const settings: Settings = { players, streak, seat, side };

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setFlip(null);
    setPhase('over');
  }

  function settle(r: Round) {
    const d = r.duel;
    if (d.winner !== null) {
      const won = winChance(d, r.settings.streak, r.settings.seat, r.settings.side) === 1;
      return finish(r, won ? 'won' : 'lost', won ? prizeFor(r.settings) : 0);
    }
    const cash = cashValue(d, r.settings);
    setRound({ ...r, cash });
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: cash, winChance: winChance(d, r.settings.streak, r.settings.seat, r.settings.side) });
  }

  /** One duel, or every duel until someone takes the pot. */
  async function run(r: Round, mode: Mode) {
    const k = r.settings.streak;
    const coins: boolean[] = [];
    const path: Duel[] = [];
    let d = r.duel;
    do {
      const champWins = rng.next() < 0.5;
      coins.push(champWins);
      d = playDuel(d, k, champWins);
      path.push(d);
    } while (mode === 'out' && d.winner === null);
    resolved.current =
      d.winner !== null ? (winChance(d, k, r.settings.seat, r.settings.side) === 1 ? prizeFor(r.settings) : 0) : cashValue(d, r.settings);

    setPhase('dueling');
    const quick = mode === 'out';
    let cur = r;
    for (let i = 0; i < path.length; i++) {
      setFlip({ champWins: coins[i], stage: 'spin' });
      if (!(await timers.wait(ms(quick ? 260 : 620)))) return;
      setFlip({ champWins: coins[i], stage: 'land' });
      if (!(await timers.wait(ms(quick ? 240 : 420)))) return;
      cur = { ...cur, duel: path[i], cash: path[i].winner === null ? cashValue(path[i], cur.settings) : cur.cash };
      setRound(cur);
      setFlip(null);
      if (!(await timers.wait(ms(quick ? 140 : 160)))) return;
    }
    settle(cur);
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { settings, stake: bet.value, duel: newDuel(players), cash: RTP, outcome: null };
    setRound(r);
    void run(r, 'one');
  }

  function step(mode: Mode) {
    if (phase !== 'checkpoint' || !round) return;
    void run(round, mode);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', cashValue(round.duel, round.settings));
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setFlip(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' ? step('one') : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const s = round?.settings ?? settings;
  const d = round?.duel ?? newDuel(s.players);
  const over = phase === 'over';
  const chances = seatChances(d, s.streak);
  const p = winChance(d, s.streak, s.seat, s.side);
  const prize = prizeFor(s);
  const cash = round ? (over ? round.cash : cashValue(d, s)) : RTP;
  const stake = round?.stake ?? bet.value;
  const br = d.winner === null && !over ? branches(d, s) : null;
  const vol = volatilityOf(settings);
  const [champ, chall] = d.order;

  let status = `Ready · ${s.players} players, ${s.streak} in a row takes the pot`;
  if (phase === 'dueling') status = `Duel ${d.duels + 1} · ${SEAT_NAMES[champ]} vs ${SEAT_NAMES[chall]}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${d.duels} duel${d.duels === 1 ? '' : 's'} · ${SEAT_NAMES[champ]} on ${d.streak} of ${s.streak}`;
  if (over && round) status = `${outcomeTitle(round)} · ${fmtMult(round.cash)}`;
  const tone = over ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const startFrac = seatFraction(settings.players, settings.streak, settings.seat);
  const n3 = seatFraction(3, 2, 0);

  return (
    <GameLayout
      name="Waldegrave"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Players</Label>
          <Chips
            label="Players"
            options={PLAYERS.map((v) => ({ value: v, label: v }))}
            value={players}
            disabled={live}
            onChange={(v) =>
              change(() => {
                setPlayers(v);
                setStreak((v - 1) as Streak);
                setSeat((x) => Math.min(x, v - 1));
              })
            }
          />

          <Label hint="wins in a row take the pot">Streak to win</Label>
          <Chips
            label="Streak to win"
            options={STREAKS.map((v) => ({ value: v, label: v }))}
            value={streak}
            disabled={live}
            onChange={(v) => change(() => setStreak(v))}
          />

          <Label hint="A and B open">Your seat</Label>
          <Chips
            label="Your seat"
            options={Array.from({ length: players }, (_, i) => ({
              value: i,
              label: SEAT_NAMES[i],
              title: `${fmtChance(startChance({ ...settings, seat: i, side: 'back' }))} to take the pot`,
            }))}
            value={seat}
            disabled={live}
            onChange={(v) => change(() => setSeat(v))}
          />

          <Label hint={side === 'back' ? 'your seat takes the pot' : 'anyone else takes it'}>Bet</Label>
          <Chips
            label="Back or lay"
            options={[
              { value: 'back' as Side, label: `Back ${SEAT_NAMES[seat]}` },
              { value: 'lay' as Side, label: `Lay ${SEAT_NAMES[seat]}` },
            ]}
            value={side}
            disabled={live}
            onChange={(v) => change(() => setSide(v))}
          />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(startChance(settings))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(settings))}</dd>
            <dt>Average duels</dt>
            <dd>{expectedDuels(players, streak).toFixed(0)}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => step('one')}>
                Next duel · {SEAT_NAMES[champ]} vs {SEAT_NAMES[chall]}
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => step('out')}>
                Play it out
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'dueling' ? 'Duelling…' : over ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Win chance', value: fmtChance(p), sub: betName(s), tone: 'chance' },
          { label: 'Cash out now', value: live || over ? fmtMult(cash) : '—', sub: formatAmount(stake * cash, 2), tone: 'cash' },
          { label: 'Prize', value: fmtMult(prize), sub: s.side === 'back' ? `if ${SEAT_NAMES[s.seat]} takes the pot` : `if anyone but ${SEAT_NAMES[s.seat]} does`, tone: 'prize' },
        ]}
      />

      <Board className="wg-stage">
        <Field duel={d} streakToWin={s.streak} seat={s.seat} side={s.side} chances={chances} now={p} branches={br} flip={flip} spinMs={ms(620)} over={over} />
        {over && round?.outcome && (
          <div className="wg-over">
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
            br
              ? `The next duel is a coin flip: ${fmtChance(br[0])} if ${SEAT_NAMES[champ]} wins, ${fmtChance(br[1])} if ${SEAT_NAMES[chall]} does. Your chance is their average.`
              : undefined
          }
        />
      ) : (
        <Caption>
          {SEAT_NAMES[settings.seat]} takes the pot with chance {fracText(startFrac)} ({fmtChance(toNumber(startFrac))}){settings.side === 'lay' ? `, so laying it wins ${fmtChance(1 - toNumber(startFrac))}` : ''}. Waldegrave, 1713:
          three players, two in a row, gives {fracText(n3)}, {fracText(n3)} and 2/7. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Waldegrave" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Three to five players queue for a table. Two play a duel (a fair coin flip); the winner stays on and the loser goes to the back of the queue. The
              first player to win a set number of duels in a row takes the pot. Back a seat to take the pot, or lay it (anyone else takes it).
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the number of players, the streak that wins, your seat and back or lay, then bet. The opening duel (A against B) plays at once.</li>
              <li>After every duel you can cash out, play the next duel (Space), or play it out to the end.</li>
              <li>When someone completes the streak the round ends: you win the prize if your bet came good.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Each seat has a bar whose height is its exact chance of taking the pot from here. The <b style={{ color: 'var(--green)' }}>green</b> bars are the
              results that pay you, so their total is your win chance. Under each duellist you can see your chance if that player wins the next duel. The two
              are equally likely, so your chance now is exactly their average.
            </p>
            <p>
              The champion's pips show the current streak. Seats near the front of the queue get to the table sooner, which is why A and B are favourites and
              the last seat is the long shot.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Waldegrave's problem (1713, solved by Montmort and Nicolaus Bernoulli). Everything depends only on the champion's streak and who stands where in
              the queue, so each seat's chance solves a small linear system: W(s, i) = ½ W(after the champion wins) + ½ W(after the challenger wins), with the
              pot at streak k. It is solved in exact fractions. For three players and two in a row the answer is 5/14, 5/14 and 2/7. The average number of duels
              is 2<sup>k</sup> − 1, whatever the number of players.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is {(RTP * 100).toFixed(0)}% ÷ your starting chance, and the cash-out is always prize × your chance from here. Because every duel is a
              fair coin and your chance is the average of the two outcomes, the cash-out is a martingale: cashing out after any duel or playing it out are all
              worth exactly {(RTP * 100).toFixed(0)}% of your stake. Choosing a seat or laying instead of backing changes the risk, never the value. The largest
              prize is backing E with five players and two in a row: {fmtMult(MAX_MULTIPLIER)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
