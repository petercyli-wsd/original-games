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
import Table, { type BoardProps, type Hand } from './Board';
import {
  MAX_WIN,
  PAIRS,
  RTP,
  SLOTS,
  afterSafeDraw,
  counts,
  dealWinChance,
  draw,
  hitsCap,
  maxMultiplier,
  newDeal,
  risk,
  slotsAllowed,
  volatilityOf,
  winChance,
  type Deal,
} from './math';

type Phase = 'idle' | 'drawing' | 'checkpoint' | 'over';
type Outcome = 'bust' | 'cashed' | 'full' | 'max';

interface Round {
  stake: number;
  deal: Deal;
  cash: number;
  outcome: Outcome | null;
}

const ACCENT = '#ff99c8';
const OUTCOME_TITLE: Record<Outcome, string> = { bust: 'No room on the table', cashed: 'Cashed out', full: 'All pairs matched', max: 'Max win reached' };

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [pairs, setPairs] = useState(8);
  const [slots, setSlots] = useState(4);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [hand, setHand] = useState<Hand | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // The token in flight is decided the moment it is drawn, so leaving
  // mid-draw settles at its real result, never at the safer pre-draw value.
  const resolved = useRef<number>(0);
  const ticket = useTicket(() => (phase === 'drawing' ? resolved.current : round?.cash ?? 0));

  // Risky draws get a pause in the hand; free draws (room on the table) flow quickly.
  const T = turbo.turbo
    ? { move: 70, risky: { lift: 170, meet: 80, settle: 90 }, free: { lift: 70, meet: 50, settle: 30 } }
    : { move: 240, risky: { lift: 650, meet: 320, settle: 360 }, free: { lift: 260, meet: 200, settle: 110 } };
  const timing = useRef(T);
  timing.current = T;
  const live = phase === 'drawing' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    timers.clearAll();
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  /** After a safe draw: run free draws by themselves, stop at a full table. */
  function continueFrom(r: Round) {
    if (r.deal.pile.length === 0) return finish(r, 'full', r.cash);
    const q = risk(r.deal);
    if (q === 0) return drawNext(r);
    if (hitsCap(r.cash, q)) return finish(r, 'max', r.cash);
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: r.cash, winChance: dealWinChance(r.deal) });
  }

  function drawNext(r: Round) {
    timers.clearAll();
    const q = risk(r.deal);
    const res = draw(r.deal, rng.int(r.deal.pile.length));
    const cash = res.kind === 'bust' ? 0 : afterSafeDraw(r.cash, q);
    resolved.current = cash;
    setPhase('drawing');
    const step = q > 0 ? timing.current.risky : timing.current.free;
    setHand({ token: res.token, at: 'hand', slot: res.slot, bust: res.kind === 'bust' });

    const commit = () => {
      const next: Round = { ...r, deal: res.deal, cash };
      setRound(next);
      setHand(null);
      timers.after(timing.current[q > 0 ? 'risky' : 'free'].settle, () => continueFrom(next));
    };
    timers.after(step.lift, () => {
      if (res.kind === 'bust') return finish(r, 'bust', 0);
      if (res.kind === 'new') return commit();
      setHand({ token: res.token, at: 'slot', slot: res.slot, bust: false });
      timers.after(step.meet, commit);
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { stake: bet.value, deal: newDeal(pairs, slots), cash: RTP, outcome: null };
    setRound(r);
    setHand(null);
    drawNext(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function next() {
    if (phase === 'checkpoint' && round) drawNext(round);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setHand(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  function choosePairs(n: number) {
    change(() => {
      setPairs(n);
      if (!slotsAllowed(n, slots)) setSlots(Math.max(...SLOTS.filter((k) => slotsAllowed(n, k))));
    });
  }

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' ? next() : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const deal = round?.deal ?? newDeal(pairs, slots);
  const n = deal.pairs;
  const k = deal.slots;
  const { u, t, left } = counts(deal);
  const q = risk(deal);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const fromHere = dealWinChance(deal);
  const drawn = 2 * n - left;
  const started = !!round;

  const pickWin = winChance(pairs, slots);
  const vol = volatilityOf(pairs, slots);

  let status = `Ready · ${pairs} pairs, ${slots} slots`;
  if (phase === 'drawing') status = `Drawing token ${drawn + 1} of ${2 * n}`;
  if (phase === 'checkpoint') status = `Table full · ${drawn} of ${2 * n} drawn`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${deal.matched.length} of ${n} pairs`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  let message: BoardProps['message'] = { text: `${n} pairs · ${k} table slots`, tone: 'neutral' };
  if (live) message = q > 0 ? { text: 'Table full · only a twin is safe', tone: 'risk' } : { text: 'Room on the table · free draw', tone: 'safe' };
  if (phase === 'over' && round?.outcome) {
    message =
      round.outcome === 'full'
        ? { text: `All ${n} pairs matched`, tone: 'win' }
        : round.outcome === 'bust'
          ? { text: '', tone: 'risk' }
          : { text: `${OUTCOME_TITLE[round.outcome]} at ${fmtMult(round.cash)}`, tone: 'win' };
  }

  return (
    <GameLayout
      name="Socks"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Pairs</Label>
          <Chips
            label="Pairs"
            wrap
            options={PAIRS.map((v) => ({ value: v, label: v, title: `${v} pairs, ${2 * v} tokens` }))}
            value={pairs}
            disabled={live}
            onChange={choosePairs}
          />

          <Label hint="a full table is the only risk">Table slots</Label>
          <Chips
            label="Table slots"
            options={SLOTS.map((v) => ({ value: v, label: v, disabled: !slotsAllowed(pairs, v), title: `Room for ${v} unmatched tokens` }))}
            value={slots}
            disabled={live}
            onChange={(v) => change(() => setSlots(v))}
          />

          <dl className="og-stats">
            <dt>Chance to match all</dt>
            <dd>{fmtChance(pickWin)}</dd>
            <dt>Typical full prize</dt>
            <dd>{fmtMult(RTP / pickWin)}</dd>
            <dt>Max prize</dt>
            <dd>{fmtMult(maxMultiplier(pairs, slots))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={next}>
                Draw · {fmtChance(1 - q)} safe
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'drawing' ? 'Drawing…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={
          started
            ? [
                {
                  label: 'Next draw safe',
                  value: live ? fmtChance(1 - q) : '—',
                  sub: live ? (q === 0 ? 'room on the table' : `${t} twins of ${left} tokens`) : `${deal.matched.length} of ${n} pairs`,
                  tone: 'chance',
                },
                { label: 'Cash out now', value: fmtMult(cash), sub: formatAmount(stake * cash, 2), tone: 'cash' },
                {
                  label: live && q === 0 ? 'After this draw' : 'If it is a twin',
                  value: live ? fmtMult(afterSafeDraw(cash, q)) : '—',
                  sub: live ? `clear all from here ${fmtChance(fromHere)}` : 'round over',
                  tone: 'prize',
                },
              ]
            : [
                { label: 'Chance to match all', value: fmtChance(pickWin), sub: `${pairs} pairs, ${slots} slots`, tone: 'chance' },
                { label: 'Cash out now', value: '—', sub: `bet ${formatAmount(stake, 2)}`, tone: 'cash' },
                { label: 'Typical full prize', value: fmtMult(RTP / pickWin), sub: `${2 * pairs} tokens to draw`, tone: 'prize' },
              ]
        }
      />

      <Board className="socks-board">
        <Table
          deal={deal}
          hand={hand}
          live={live}
          checkpoint={phase === 'checkpoint'}
          message={message}
          moveMs={T.move}
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
          p={1 - q}
          label="Next draw is safe"
          note={
            q === 0
              ? 'The table has room, so any token fits: this draw is free.'
              : `Only the ${t} green twins clear a slot; the ${2 * u} red tokens have no twin on the table and would bust. Chance to clear all from here: ${fmtChance(fromHere)}.`
          }
        />
      ) : (
        <Caption>
          Each new colour waits on the table until its twin turns up. With {n} pairs and {k} slots, all {2 * n} tokens come out safely{' '}
          {fmtChance(winChance(n, k))} of the time. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Socks" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A pile holds pairs of coloured tokens in random order. Draw them all. A token whose twin hasn't come out yet must wait on a small table; when
              its twin is drawn, the pair clears. If a token arrives with no twin on the table and no free slot, the round is lost.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many pairs are in the pile and how many slots the table has, then bet.</li>
              <li>While the table has a free slot nothing can go wrong, so tokens are drawn by themselves.</li>
              <li>When the table is full the round pauses: cash out (C), or draw the next token (Space).</li>
              <li>Draw every token and the round pays out automatically.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Every token left in the pile is equally likely to come next. When the table is full, the <b style={{ color: 'var(--green)' }}>green</b> tokens
              in the pile are the twins of the tokens on the table: drawing one clears a pair. The <b style={{ color: 'var(--red)' }}>red</b> tokens belong to
              pairs not yet started, and there is nowhere to put them. So the chance the next draw is safe is simply green tokens ÷ tokens in the pile, shown
              as the thin bar above the pile.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Only two numbers matter: u, the pairs not yet started, and t, the tokens on the table. The pile holds 2u + t tokens, so the next one is a twin
              with chance t / (2u + t). The chance to clear everything satisfies W(0, t) = 1 and
            </p>
            <p>
              W(u, t) = t/(2u+t) · W(u, t−1) + [t &lt; k] · 2u/(2u+t) · W(u−1, t+1),
            </p>
            <p>
              an exact recursion over a few dozen states. With a single slot every pair has to come out back to back, which happens with chance n! 2
              <sup>n</sup> / (2n)!.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Surviving a draw from a full table with t twins among L tokens multiplies your cash-out by L / t; free draws leave it unchanged. Every draw is
              therefore a fair bet, and the round is worth {(RTP * 100).toFixed(0)}% of your stake however and whenever you cash out. If one more twin would
              lift the cash-out above {fmtMult(MAX_WIN)}, the round cashes out automatically at its current value (Max win reached).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
