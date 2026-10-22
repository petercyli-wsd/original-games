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
import { useEffect, useRef, useState } from 'react';
import Field, { type Outcome, type Reveal } from './Board';
import { DECKS, RTP, afterTurn, cashOut, dealsRed, deckByKey, deckKey, prizeFor, settled, share, volatilityOf, type Deck } from './math';

type Phase = 'idle' | 'turning' | 'calling' | 'checkpoint' | 'over';

interface Round {
  deck: Deck;
  stake: number;
  /** Locked at bet time: RTP / (red share of the full deck). */
  prize: number;
  red: number;
  black: number;
  turned: boolean[];
  called: boolean | null;
  cash: number;
  outcome: Outcome | null;
}

const ACCENT = '#ffc6ff';
const OUTCOME_TITLE: Record<Outcome, string> = {
  hit: 'Red! Called it',
  miss: 'Black. Missed',
  cashed: 'Cashed out',
  allred: 'Only reds left',
  nored: 'No reds left',
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [deckId, setDeckId] = useState(deckKey(DECKS[2]));
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const flips = useRef(0);

  // A card's colour is decided the moment it starts to flip, so leaving
  // mid-animation settles at its real result, never at the pre-flip value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'turning' || phase === 'calling' ? resolved.current : round?.cash ?? 0));

  const speed = turbo.turbo ? 0.25 : 1;
  const flipMs = Math.round(420 * speed);
  const holdMs = Math.round(380 * speed);
  const live = phase === 'turning' || phase === 'calling' || phase === 'checkpoint';
  const busy = phase === 'turning' || phase === 'calling';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setReveal(null);
    setPhase('over');
  }

  function turn(r: Round) {
    const isRed = dealsRed(r.red, r.black, rng.next());
    const d = afterTurn(r.red, r.black, isRed);
    const done = settled(d.red, d.black);
    const cash = done === 'won' ? r.prize : done === 'lost' ? 0 : cashOut(r.prize, d.red, d.black);
    resolved.current = cash;
    setPhase('turning');
    setReveal({ red: isRed, id: ++flips.current, call: false });
    timers.after(flipMs + holdMs, () => {
      const next: Round = { ...r, ...d, turned: [...r.turned, isRed], cash };
      if (done) return finish(next, done === 'won' ? 'allred' : 'nored', cash);
      setRound(next);
      setReveal(null);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: share(d.red, d.black) });
    });
  }

  function call(r: Round) {
    const isRed = dealsRed(r.red, r.black, rng.next());
    const cash = isRed ? r.prize : 0;
    resolved.current = cash;
    setPhase('calling');
    setReveal({ red: isRed, id: ++flips.current, call: true });
    timers.after(flipMs + holdMs, () => {
      const d = afterTurn(r.red, r.black, isRed);
      finish({ ...r, ...d, turned: [...r.turned, isRed], called: isRed }, isRed ? 'hit' : 'miss', cash);
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const deck = deckByKey(deckId);
    const prize = prizeFor(deck);
    setRound({ deck, stake: bet.value, prize, red: deck.red, black: deck.black, turned: [], called: null, cash: RTP, outcome: null });
    setReveal(null);
    setPhase('checkpoint');
  }

  function cashOutNow() {
    if (phase !== 'checkpoint' || !round || round.turned.length === 0) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setReveal(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (live) return;
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? turn(round) : !live ? void start() : undefined),
      cashOut: cashOutNow,
    },
    !infoOpen,
  );

  // R calls red (Space turns, C cashes out).
  const callRef = useRef<() => void>(() => {});
  callRef.current = () => phase === 'checkpoint' && round && call(round);
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t?.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text') return;
      if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) callRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  // What the board shows: the live or finished round, else a preview of the settings.
  const chosen = deckByKey(deckId);
  const deck = round?.deck ?? chosen;
  const red = round?.red ?? deck.red;
  const black = round?.black ?? deck.black;
  const turned = round?.turned ?? [];
  const n = red + black;
  const p = share(red, black);
  const prize = round?.prize ?? prizeFor(deck);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const p0 = share(chosen.red, chosen.black);

  let status = `Ready · ${deck.red} red, ${deck.black} black`;
  if (phase === 'checkpoint') status = turned.length ? `Checkpoint · ${plural(turned.length, 'card')} turned` : 'Live · full deck, call or turn';
  if (phase === 'turning') status = `Turning card ${turned.length + 1} of ${deck.red + deck.black}`;
  if (phase === 'calling') status = 'Calling red…';
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${plural(turned.length, 'card')}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Call It"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={volatilityOf(chosen)} />}>Deck (red : black)</Label>
          <Chips
            label="Deck"
            options={DECKS.map((d) => ({
              value: deckKey(d),
              label: (
                <span className="ci-chip">
                  <i className="r">{d.red}</i>:<i>{d.black}</i>
                </span>
              ),
              title: `${d.red} red, ${d.black} black`,
            }))}
            value={deckId}
            disabled={live}
            onChange={(v) => change(() => setDeckId(v))}
          />
          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(p0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(chosen))}</dd>
          </dl>

          {phase === 'checkpoint' || phase === 'turning' || phase === 'calling' ? (
            <>
              {turned.length > 0 && (
                <ActionButton kind="cash" disabled={busy} onClick={cashOutNow}>
                  Cash out <span>{formatAmount(stake * cash, 2)}</span>
                </ActionButton>
              )}
              <ActionButton disabled={busy} onClick={() => round && call(round)}>
                Call red · {fmtChance(p)} to win
              </ActionButton>
              <ActionButton kind="secondary" disabled={busy} onClick={() => round && turn(round)}>
                {busy ? 'Turning…' : 'Turn a card'}
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
          {
            label: 'Next card red',
            value: phase === 'over' ? '—' : fmtChance(p),
            sub: `${red} red of ${n} left`,
            tone: 'chance',
          },
          {
            label: 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'prize × red share',
            tone: 'cash',
          },
          { label: 'Prize if right', value: fmtMult(prize), sub: formatAmount(stake * prize, 2), tone: 'prize' },
        ]}
      />

      <Board className="ci-stage">
        <Field
          deck={deck}
          red={red}
          black={black}
          turned={turned}
          reveal={reveal}
          called={round?.called ?? null}
          outcome={phase === 'over' ? round?.outcome ?? null : null}
          flipMs={flipMs}
          live={live}
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
          p={p}
          label="Next card is red"
          note="The red share of the deck bar. Turning a card moves it up or down, but on average it stays exactly where it is."
        />
      ) : (
        <Caption>
          Call &ldquo;next is red&rdquo; whenever you like. The prize is locked at {fmtMult(prizeFor(chosen))} and you win {fmtChance(p0)} of the time
          however long you wait. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Call It" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A shuffled deck of red and black cards is turned over one card at a time. Pick your moment and call <b>&ldquo;the next card is red&rdquo;</b>. If
              it is, you win the prize.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose a deck (more black cards: longer odds, bigger prize) and bet. The prize is locked now.</li>
              <li>Turn cards over (Space) to watch the deck change, call red (R) when you like, or cash out (C) after any card.</li>
              <li>If the reds run out the round is lost. If only reds are left, your call is certain and the prize is paid.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The <b>deck bar</b> holds every card still face-down, reds first. Its <b style={{ color: 'var(--green)' }}>red share</b> (the bracket) is
              exactly the chance the next card is red, and the big fraction spells it out: red cards left / cards left. The grid below shows every card turned
              so far, in order.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The red-card martingale (Winkler&apos;s puzzle). With r red cards among n left, the next card is red with chance p = r / n. Turning one card
              over moves p to (r − 1)/(n − 1) with chance r/n, or to r/(n − 1) with chance (n − r)/n. On average that is
            </p>
            <p>
              <b>(r(r − 1) + (n − r)·r) / (n(n − 1)) = r / n</b>
            </p>
            <p>
              so p is a martingale, and by optional stopping no calling rule (waiting for blacks to go, calling early, calling at the end) can change the
              chance you started with. Calling at once, or letting the last card decide, wins r₀/n₀ of the time.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is {(RTP * 100).toFixed(0)}% ÷ (red share of the full deck), so 13 : 13 pays {fmtMult(prizeFor(DECKS[0]))} and 1 : 49 pays{' '}
              {fmtMult(prizeFor(DECKS[4]))}, the largest payout in the game. Cashing out pays prize × the red share now, exactly what a call is worth. Every
              card turned is a fair bet, so the round is worth {(RTP * 100).toFixed(0)}% of your stake whatever you do and whenever you do it.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
