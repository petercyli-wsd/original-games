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
import Field from './Board';
import {
  BALLOTS,
  ELECTIONS,
  MAX_MULTIPLIER,
  PICKS,
  PICK_NAME,
  RTP,
  VOTERS,
  ZERO,
  addBallot,
  cashValue,
  electionChance,
  finalChances,
  newSeries,
  perElection,
  plan,
  prizeFor,
  resultOf,
  startChance,
  volatilityOf,
  winChance,
  type Elections,
  type Margins,
  type Mode,
  type Pick,
  type Series,
  type Voters,
} from './math';

const ACCENT = '#bde0fe';

type Phase = 'idle' | 'counting' | 'checkpoint' | 'over';
type Outcome = 'won' | 'cashed' | 'lost';

interface Round {
  stake: number;
  series: Series;
  cash: number;
  outcome: Outcome | null;
}

interface View {
  /** The election on screen (a finished one lingers before the next starts). */
  ballots: number[];
  margins: Margins;
  skipped: number;
  fresh: number | null;
  ended: boolean;
}

const BLANK: View = { ballots: [], margins: ZERO, skipped: 0, fresh: null, ended: false };

const resultName = (p: Pick) => (p === 'cycle' ? 'a cycle' : `${p} as Condorcet winner`);

function outcomeTitle(r: Round, v: View): string {
  const s = r.series;
  if (r.outcome === 'cashed') return 'Cashed out';
  if (r.outcome === 'won') return s.elections > 1 ? `${s.elections} in a row` : s.pick === 'cycle' ? 'Condorcet paradox' : `${s.pick} wins`;
  if (v.skipped > 0) return s.pick === 'cycle' ? 'No cycle possible' : `${s.pick} can't win now`;
  const res = resultOf(v.margins);
  return res === 'cycle' ? 'A cycle' : res ? `${res} wins` : 'Lost';
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [pick, setPick] = useState<Pick>('A');
  const [voters, setVoters] = useState<Voters>(9);
  const [elections, setElections] = useState<Elections>(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [view, setView] = useState<View>(BLANK);
  const [infoOpen, setInfoOpen] = useState(false);

  // An action's ballots are all drawn the moment it starts, so leaving
  // mid-count settles at the real result, never at the earlier value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'counting' ? resolved.current : round ? cashValue(round.series) : 0));

  const live = phase === 'counting' || phase === 'checkpoint';
  const speed = turbo.turbo ? 0.25 : 1;
  const ms = (t: number) => Math.max(16, Math.round(t * speed));

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setView((v) => ({ ...v, fresh: null }));
    setPhase('over');
  }

  function settle(r: Round) {
    const s = r.series;
    if (s.status === 'won') return finish(r, 'won', prizeFor(s.pick, s.voters, s.elections));
    if (s.status === 'lost') return finish(r, 'lost', 0);
    setRound(r);
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: cashValue(s), winChance: winChance(s) });
  }

  /** Counts one ballot, or the rest of the election. */
  async function run(r: Round, mode: Mode) {
    const counts = plan(r.series, mode, rng);
    resolved.current = cashValue(counts[counts.length - 1].next);
    setPhase('counting');
    let cur = r;
    for (const c of counts) {
      setView({ ballots: c.ballots, margins: c.margins, skipped: c.skipped, fresh: c.ballots.length - 1, ended: c.ended });
      cur = { ...cur, series: c.next };
      setRound(cur);
      if (!(await timers.wait(ms(mode === 'rest' ? 150 : 420)))) return;
      if (c.ended && c.next.status === 'live') {
        // An election won on the way: let it sink in, then a fresh count.
        if (!(await timers.wait(ms(1000)))) return;
        setView(BLANK);
      } else if (c.ended) {
        if (!(await timers.wait(ms(300)))) return;
      }
    }
    settle(cur);
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { stake: bet.value, series: newSeries(pick, voters, elections), cash: RTP, outcome: null };
    setRound(r);
    setView(BLANK);
    void run(r, 'one');
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
      space: () => (phase === 'checkpoint' ? step('one') : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const over = phase === 'over';
  const s = round?.series ?? newSeries(pick, voters, elections);
  const pk = s.pick;
  const n = s.voters;
  const k = s.elections;
  const left = n - view.ballots.length;
  const shown = finalChances(view.margins, view.ended ? view.skipped : left);
  const tiles = over || view.ended ? null : BALLOTS.map((_, b) => finalChances(addBallot(view.margins, b), left - 1)[pk]);
  const atBoundary = phase === 'checkpoint' && s.won > 0 && s.ballots.length === 0;
  // A won election lingers on screen after the series has moved on to the next one.
  const lingering = view.ended && s.status === 'live' && s.won > 0 && s.ballots.length === 0;
  const current = Math.min(lingering ? s.won - 1 : s.won, k - 1);

  const p = round ? (over ? (round.outcome === 'won' ? 1 : round.outcome === 'cashed' ? winChance(s) : 0) : winChance(s)) : startChance(pk, n, k);
  const cash = round ? (over ? round.cash : cashValue(s)) : RTP;
  const stake = round?.stake ?? bet.value;
  const prize = prizeFor(pk, n, k);
  const per = perElection(pk, n);
  const vol = volatilityOf(pick, voters, elections);

  let note: string | null = null;
  if (view.ended) {
    const res = resultOf(view.margins);
    const sure = (Object.keys(shown) as Pick[]).find((q) => shown[q] === 1);
    if (view.skipped > 0 && sure === pk) note = `${PICK_NAME[pk]} is certain with ${view.skipped} ballot${view.skipped === 1 ? '' : 's'} left`;
    else if (view.skipped > 0) note = `${pk === 'cycle' ? 'A cycle' : `${pk} winning`} is impossible now`;
    else if (res) note = `Final count: ${res === 'cycle' ? 'a cycle, no Condorcet winner' : `${res} beats both rivals`}`;
  }

  const prefix = k > 1 ? `Election ${Math.min(s.won + 1, k)} of ${k} · ` : '';
  let status = `Ready · back ${resultName(pk)}${k > 1 ? `, ${k} in a row` : ''}`;
  if (phase === 'counting') status = view.ended ? (note ?? 'Counted') : `${prefix}Counting ballot ${view.ballots.length} of ${n}…`;
  if (phase === 'checkpoint')
    status = atBoundary ? `Election ${s.won} won · checkpoint` : `${prefix}Checkpoint · ${s.ballots.length} of ${n} counted`;
  if (over && round) status = `${outcomeTitle(round, view)} · ${fmtMult(round.cash)}`;
  const tone = over ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const after = k - s.won - 1;
  const restNote = after <= 0 ? '' : ` × ${fmtChance(per)} for ${after === 1 ? 'the election' : `each of the ${after} elections`} after it`;

  return (
    <GameLayout
      name="Condorcet"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Back</Label>
          <Chips
            label="Result to back"
            options={PICKS.map((v) => ({ value: v, label: v === 'cycle' ? 'Cycle' : v, title: `${PICK_NAME[v]}: ${fmtChance(perElection(v, voters))} per election` }))}
            value={pick}
            disabled={live}
            onChange={(v) => change(() => setPick(v))}
          />

          <Label hint="odd, so no pair ties">Voters</Label>
          <Chips
            label="Voters"
            options={VOTERS.map((v) => ({ value: v, label: v }))}
            value={voters}
            disabled={live}
            onChange={(v) => change(() => setVoters(v))}
          />

          <Label hint="all must go your way">Elections in a row</Label>
          <Chips
            label="Elections in a row"
            options={ELECTIONS.map((v) => ({ value: v, label: v }))}
            value={elections}
            disabled={live}
            onChange={(v) => change(() => setElections(v))}
          />
          <dl className="og-stats">
            {elections > 1 && (
              <>
                <dt>Each election</dt>
                <dd>{fmtChance(perElection(pick, voters))}</dd>
              </>
            )}
            <dt>Chance to win</dt>
            <dd>{fmtChance(startChance(pick, voters, elections))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(pick, voters, elections))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => step('one')}>
                {atBoundary ? `Start election ${s.won + 1}` : 'Next ballot'}
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => step('rest')}>
                {atBoundary ? `Count election ${s.won + 1}` : 'Count the rest'}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'counting' ? 'Counting…' : over ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Win chance', value: fmtChance(p), sub: k > 1 ? `election ${Math.min(s.won + 1, k)} of ${k}` : resultName(pk), tone: 'chance' },
          { label: 'Cash out now', value: live || over ? fmtMult(cash) : '—', sub: formatAmount(stake * cash, 2), tone: 'cash' },
          { label: 'Prize', value: fmtMult(prize), sub: k > 1 ? `${PICK_NAME[pk]}, ${k} in a row` : `if ${PICK_NAME[pk]}`, tone: 'prize' },
        ]}
      />

      <Board className="cd-stage">
        <Field
          pick={pk}
          voters={n}
          ballots={view.ballots}
          margins={view.margins}
          skipped={view.skipped}
          fresh={view.fresh}
          chances={shown}
          tiles={tiles}
          series={{ elections: k, won: s.won, current, lost: s.status === 'lost' }}
          note={over ? null : note}
          barTitle={over && round?.outcome === 'cashed' ? 'ODDS WHEN YOU CASHED OUT' : view.ended ? 'HOW THIS ELECTION ENDED' : 'HOW THIS ELECTION ENDS · exact odds'}
          revealMs={ms(300)}
        />
        {over && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={outcomeTitle(round, view)}
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
        <ChanceBar
          p={p}
          label="Chance to win"
          note={
            atBoundary
              ? `A fresh election: ${fmtChance(per)} each, ${k - s.won} still to go.`
              : `This election ${fmtChance(electionChance(s))}${restNote}. The six tiles are the six possible next ballots; they average to this election's chance.`
          }
        />
      ) : (
        <Caption>
          Every voter ranks A, B and C in one of the 6 orders at random. With {n} voters a cycle happens {fmtChance(perElection('cycle', n))} of the time and each
          candidate is the Condorcet winner {fmtChance(perElection('A', n))}. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Condorcet" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Three candidates, A, B and C, face an odd number of voters, and every voter ranks them in one of the six possible orders, uniformly at random. Each pair
              of candidates is decided by majority. Back a candidate to beat both rivals (the Condorcet winner), or back a <b>Cycle</b>: A beats B, B beats C and
              C beats A (or the reverse), so the majority has no favourite at all.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick what you back, the number of voters and how many elections in a row it must happen, then bet. The first ballot is counted at once.</li>
              <li>After every ballot you can cash out, count the next ballot (Space), or count the rest of the election.</li>
              <li>
                If your result becomes impossible, the round is lost. If it becomes certain, the election stops there (the remaining ballots can't change it) and
                the next election starts, or the prize pays.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The triangle shows the three head-to-head races. An arrow points from the leader to the trailer, labelled with the lead (votes for minus votes
              against). Three arrows chasing each other round the triangle is a cycle.
            </p>
            <p>
              The bar splits the four ways this election can end, with lengths equal to their exact chances; your result is outlined. The six tiles are the six
              possible next ballots (top dot = first choice). Each shows your chance this election if that ballot comes next. Each is drawn with chance 1 in 6,
              so your chance now is exactly their average. <b style={{ color: 'var(--green)' }}>Green</b> tiles help you, <b style={{ color: 'var(--red)' }}>red</b> ones
              hurt.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The Condorcet paradox: individually transitive rankings can add up to a cyclic majority. For three voters the chance of a cycle is 1/18; for five it is
              5/72; and as the electorate grows it rises to Guilbaud's limit 1/4 − (3/2π)·arcsin(1/3) ≈ 8.77%. Each ballot moves the three pairwise margins by ±1
              each, never all in the same direction. The odds come from the exact distribution of the sum of the remaining ballots, built by convolution: no
              sampling.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is {(RTP * 100).toFixed(0)}% ÷ your chance to win (the per-election chance raised to the number of elections). The cash-out is always prize
              × your chance to win from here. The next ballot is a uniform pick of the six, so your chance now is the average of your chances after it, and the
              cash-out is a martingale: by the optional stopping theorem, any cash-out rule is worth exactly {(RTP * 100).toFixed(0)}% of your stake. Backing a
              candidate or a cycle only changes the volatility. The biggest prize is a cycle three times in a row with five voters: {fmtMult(MAX_MULTIPLIER)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
