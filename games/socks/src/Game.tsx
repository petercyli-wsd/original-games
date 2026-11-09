import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
  ActionButton,
  BetField,
  Board,
  Caption,
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
  eventMs,
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

const ACCENT = ACCENTS.pink;
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

  // `resolved` is the open bet's value right now, set synchronously at every
  // transition (RTP once the stake is accepted, the drawn result the moment a
  // token is drawn). The ticket reads only this ref: a value derived from
  // rendered state can be one render stale if the game unmounts before the
  // next render (the last round's payout just after Bet again, or the safer
  // pre-draw cash-out just after Draw).
  const resolved = useRef<number>(0);
  const ticket = useTicket(() => resolved.current);

  // Risky draws get a pause in the hand; free draws (room on the table) flow quickly.
  const tb = turbo.turbo;
  const T = {
    move: eventMs(tb, 300),
    risky: { lift: eventMs(tb, 600), meet: eventMs(tb, 300), settle: eventMs(tb, 300) },
    free: tb ? { lift: 70, meet: 50, settle: 30 } : { lift: 260, meet: 200, settle: 110 },
  };
  const timing = useRef(T);
  timing.current = T;
  const live = phase === 'drawing' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    timers.clearAll();
    resolved.current = cash;
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
    resolved.current = RTP;
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
  const { left } = counts(deal);
  const q = risk(deal);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
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
            <dt>Max prize</dt>
            <dd>{fmtMult(maxMultiplier(pairs, slots))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={next}>
                Draw next
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
                  tone: 'chance',
                },
                {
                  label: live && q === 0 ? 'After this draw' : 'If it is a twin',
                  value: live ? fmtMult(afterSafeDraw(cash, q)) : '—',
                  tone: 'prize',
                },
              ]
            : [
                { label: 'Chance to match all', value: fmtChance(pickWin), tone: 'chance' },
                { label: 'Typical full prize', value: fmtMult(RTP / pickWin), tone: 'prize' },
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

      <Caption>Match every token with its twin before the table runs out of room.</Caption>

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
              Every token left in the pile is equally likely to come next. When the table is full, the tokens in the pile with a <b>green</b> outline
              are the twins of the tokens on the table: drawing one clears a pair. The tokens with a <b>red</b> outline belong to
              pairs not yet started, and there is nowhere to put them. So the chance the next draw is safe is simply green tokens ÷ tokens in the pile, shown
              as the thin bar above the pile. Pairs are told apart by their letter.
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
