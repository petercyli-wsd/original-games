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
  fmtMult,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
  type ReadoutItem,
  type StatusTone,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import Field, { COLOURS, fmtChance } from './Board';
import { DECK, NO_TOP, RTP, ifNext, startChances, startPrize, turn, valueAfter, volatilityOf, winChances } from './math';

const ACCENT = '#e8a23a';
const RULE = 'Cards are turned from a deck of four colours; the first colour to come up twice in a row wins; back a colour.';
const AUTO_TARGETS = [0, 1.5, 2, 3, 5, 10];

type Phase = 'idle' | 'drawing' | 'checkpoint' | 'over';
type Outcome = 'won' | 'lost' | 'cashed' | 'out';

interface Round {
  me: number;
  stake: number;
  prize: number;
  counts: number[];
  top: number;
  prev: number;
  pile: number[];
  outcome: Outcome | null;
  winner: number | null;
  cash: number;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const lc = (i: number) => COLOURS[i].name.toLowerCase();

function fresh(me: number, stake: number): Round {
  return { me, stake, prize: startPrize(me), counts: [...DECK], top: NO_TOP, prev: NO_TOP, pile: [], outcome: null, winner: null, cash: RTP };
}

function title(r: Round): string {
  switch (r.outcome) {
    case 'won':
      return `${COLOURS[r.me].name} snaps: you win`;
    case 'lost':
      return `${COLOURS[r.winner ?? 0].name} snaps first`;
    case 'cashed':
      return 'Cashed out';
    case 'out':
      return `${COLOURS[r.me].name} can no longer snap`;
    default:
      return '';
  }
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [pick, setPick] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [drawing, setDrawing] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const [target, setTarget] = useState(0);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoRound, setAutoRound] = useState<Round | null>(null);
  const [last, setLast] = useState<Last | null>(null);
  const seq = useRef(0);

  // The open ticket's value right now, set synchronously when the bet is placed
  // (RTP x the start value) and again as each card is drawn. The ticket reads only
  // this ref, never rendered state, so leaving mid-turn settles at the drawn result.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);
  // Guards against a second press in the same tick.
  const busy = useRef(false);
  // The checkpoint round while one is waiting for cash out / next card.
  const checkpoint = useRef<Round | null>(null);

  const cardMs = turbo.turbo ? 220 : 1100;
  const autoMs = turbo.turbo ? 28 : 130;
  const live = phase === 'drawing' || phase === 'checkpoint';

  /** Draws one card, decided now; the board shows it after `ms`. Null if the board was left. */
  async function turnCard(r: Round, ms: number) {
    const t = turn(r.counts, r.top, rng.next());
    const value = valueAfter(t, r.me, r.prize);
    resolved.current = value;
    setDrawing(t.colour);
    const ok = await timers.wait(ms);
    setDrawing(null);
    if (!ok) return null;
    const next: Round = { ...r, counts: t.counts, top: t.colour, prev: r.top, pile: [...r.pile, t.colour] };
    return { next, value, t };
  }

  function finish(r: Round, outcome: Outcome, cash: number, winner: number | null = null) {
    checkpoint.current = null;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash, winner });
    setPhase('over');
    busy.current = false;
  }

  /** One manual turn; the caller holds `busy`. */
  async function draw(r: Round) {
    checkpoint.current = null;
    setPhase('drawing');
    const res = await turnCard(r, cardMs);
    if (!res) {
      busy.current = false;
      return;
    }
    const { next, value, t } = res;
    if (t.snap) return finish(next, t.colour === r.me ? 'won' : 'lost', value, t.colour);
    if (value === 0) return finish(next, 'out', 0);
    setRound(next);
    checkpoint.current = next;
    setPhase('checkpoint');
    busy.current = false;
    track({ type: 'checkpoint', multiplier: value, winChance: winChances(next.counts, next.top)[r.me] });
  }

  async function start() {
    if (busy.current || checkpoint.current || bet.blocked) return;
    busy.current = true;
    if (!(await ticket.place(bet.value))) {
      busy.current = false;
      return;
    }
    resolved.current = RTP;
    timers.clearAll();
    setLast(null);
    setAutoRound(null);
    const r = fresh(pick, bet.value);
    setRound(r);
    await draw(r);
  }

  function nextCard() {
    const r = checkpoint.current;
    if (!r || busy.current) return;
    busy.current = true;
    void draw(r);
  }

  function cashOut() {
    const r = checkpoint.current;
    if (!r || busy.current) return;
    busy.current = true;
    finish(r, 'cashed', r.prize * winChances(r.counts, r.top)[r.me]);
  }

  function clear() {
    if (live || busy.current) return;
    timers.clearAll();
    setRound(null);
    setAutoRound(null);
    setLast(null);
    setPhase('idle');
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    if (busy.current) return null;
    busy.current = true;
    const me = pick;
    const goal = target;
    if (!(await ticket.place(stake))) {
      busy.current = false;
      return null;
    }
    resolved.current = RTP;
    setAutoBusy(true);
    setRound(null);
    setPhase('idle');
    setLast(null);
    let r = fresh(me, stake);
    setAutoRound(r);
    let mult = 0;
    for (;;) {
      const res = await turnCard(r, autoMs);
      if (!res) {
        // The game was left mid-round; the ticket settles at the drawn value.
        busy.current = false;
        return null;
      }
      const { next, value, t } = res;
      r = next;
      setAutoRound(r);
      if (t.snap) {
        mult = value;
        r.outcome = t.colour === me ? 'won' : 'lost';
        r.winner = t.colour;
        break;
      }
      if (value === 0) {
        r.outcome = 'out';
        break;
      }
      if (goal > 0 && value >= goal) {
        mult = value;
        r.outcome = 'cashed';
        break;
      }
    }
    r.cash = mult;
    setAutoRound({ ...r });
    ticket.settle(mult);
    pushHistory(mult);
    setLast({ id: ++seq.current, multiplier: mult, stake });
    setAutoBusy(false);
    busy.current = false;
    return mult;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  const autoLocked = auto.running || autoBusy;

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    if (busy.current) return;
    timers.clearAll();
    setRound(null);
    setAutoRound(null);
    setLast(null);
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  function choose(i: number) {
    if (autoLocked || live || busy.current) return;
    setPick(i);
    if (phase === 'over' || autoRound || last) {
      timers.clearAll();
      setRound(null);
      setAutoRound(null);
      setLast(null);
      setPhase('idle');
    }
  }

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (checkpoint.current) nextCard();
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const shown = isAuto ? autoRound : round;
  const me = shown?.me ?? pick;
  const counts = shown?.counts ?? DECK;
  const top = shown?.top ?? NO_TOP;
  const chances = winChances(counts, top);
  const ghosts = ifNext(counts, top, me);
  const outcome = shown?.outcome ?? null;
  const boardLive = !outcome && (live || (isAuto && autoBusy));
  const prize = shown?.prize ?? startPrize(pick);
  const stake = shown?.stake ?? bet.value;
  const value = outcome ? shown!.cash : shown ? prize * chances[me] : RTP;
  const startP = startChances()[pick];
  const vol = volatilityOf(startP);
  const snapped = outcome === 'won' || outcome === 'lost';
  const cards = shown?.pile.length ?? 0;

  let status = `Ready · ${COLOURS[pick].name} snaps first ${fmtChance(startP)} of the time`;
  let tone: StatusTone = 'idle';
  if (isAuto) {
    if (auto.running || autoBusy) {
      status = `Autobet · ${COLOURS[me].name}${auto.remaining !== null ? ` · ${auto.remaining} left` : ''}`;
      tone = 'live';
    } else if (last && autoRound) {
      status = `${title(autoRound)} · ${fmtMult(last.multiplier)}`;
      tone = last.multiplier > 0 ? 'won' : 'lost';
    } else status = `Auto · ${COLOURS[pick].name} · ${target ? `cash out at ${fmtMult(target)}` : 'ride to the snap'}`;
  } else if (phase === 'drawing' && round) {
    status = `Turning card ${cards + 1}`;
    tone = 'live';
  } else if (phase === 'checkpoint' && round) {
    status = `Card ${cards} · ${lc(round.top)} on top · cash out or turn on`;
    tone = 'live';
  } else if (phase === 'over' && round?.outcome) {
    status = `${title(round)} · ${cards} card${cards === 1 ? '' : 's'}`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  const readouts: ReadoutItem[] = [
    {
      label: `${COLOURS[me].name} snaps first`,
      value: fmtChance(outcome ? (outcome === 'won' ? 1 : 0) : chances[me]),
      sub: !shown ? 'before the first card' : outcome ? 'round over' : `${counts.reduce((a, b) => a + b, 0)} cards left`,
      tone: 'chance',
    },
    {
      label: outcome ? 'Paid' : shown ? 'Cash out now' : 'Cash out now',
      value: shown ? fmtMult(value) : '—',
      sub: shown ? formatAmount(stake * value, 2) : 'after each card',
      tone: 'cash',
    },
    { label: `If ${lc(me)} snaps`, value: fmtMult(prize), sub: `pays ${formatAmount(stake * prize, 2)}`, tone: 'prize' },
  ];

  const pickerChances = shown && !outcome ? chances : startChances();
  const picker = (
    <>
      <Label hint={live ? 'locked for this round' : <VolBadge level={vol} />}>Back a colour</Label>
      <div className="b2b-pick" role="radiogroup" aria-label="Colour">
        {COLOURS.map((c, i) => {
          const on = i === (live || (isAuto && autoBusy) ? me : pick);
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={on}
              className={'b2b-colour' + (on ? ' on' : '')}
              disabled={live || autoLocked}
              onClick={() => choose(i)}
            >
              <i style={{ background: c.fill }} />
              <span>{c.name}</span>
              <b>{fmtChance(pickerChances[i])}</b>
            </button>
          );
        })}
      </div>
    </>
  );

  const ms = isAuto ? autoMs : cardMs;

  return (
    <GameLayout
      name="Back to Back"
      accent={ACCENT}
      className="b2b-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={live || autoLocked} />
          {picker}

          {!isAuto ? (
            <>
              <dl className="og-stats">
                <dt>Chance to win</dt>
                <dd>{fmtChance(live ? chances[me] : startP)}</dd>
                <dt>Prize</dt>
                <dd>{fmtMult(phase === 'checkpoint' || phase === 'drawing' ? prize : startPrize(pick))}</dd>
              </dl>
              {phase === 'checkpoint' ? (
                <>
                  <ActionButton kind="cash" onClick={cashOut}>
                    Cash out <span>{formatAmount(stake * value, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" onClick={nextCard}>
                    Turn next card
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={phase === 'drawing' || !!bet.blocked} onClick={() => void start()}>
                  {phase === 'drawing' ? 'Turning…' : phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint="checked after every card">Cash out at</Label>
              <Chips
                label="Auto cash-out"
                wrap
                options={AUTO_TARGETS.map((v) => ({ value: v, label: v === 0 ? 'Snap' : fmtMult(v) }))}
                value={target}
                disabled={autoLocked}
                onChange={(v) => {
                  setTarget(v);
                  if (!autoLocked) {
                    setAutoRound(null);
                    setLast(null);
                  }
                }}
              />
              <dl className="og-stats">
                <dt>Chance to win</dt>
                <dd>{fmtChance(startP)}</dd>
                <dt>Prize at the snap</dt>
                <dd>{fmtMult(startPrize(pick))}</dd>
              </dl>
            </AutoBetControls>
          )}
          {bet.blocked && <p className="b2b-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className={'b2b-board' + (isAuto ? ' auto' : '')}>
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Field
          counts={counts}
          top={top}
          prev={shown?.prev ?? NO_TOP}
          drawing={drawing}
          pile={shown?.pile ?? []}
          me={me}
          chances={outcome === 'won' || outcome === 'lost' ? chances.map((_, j) => (j === shown!.winner ? 1 : 0)) : chances}
          ghosts={outcome ? null : ghosts}
          snapped={snapped}
          mine={outcome ? 0 : chances[me]}
          live={boardLive || !!outcome}
          ms={ms}
        />
      </Board>

      {!isAuto && phase === 'over' && round?.outcome ? (
        <RoundOver
          key={history[0]?.id}
          title={title(round)}
          multiplier={round.cash}
          stake={round.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={clear}
          placement="inline"
        />
      ) : !isAuto && live ? (
        <ChanceBar
          p={chances[me]}
          label={`${COLOURS[me].name} snaps first`}
          note={phase === 'checkpoint' ? 'Space turns the next card, C cashes out. Your colour is fixed for this round.' : 'The deck bar above is the next card’s exact chance.'}
        />
      ) : (
        <Caption>
          <b className="b2b-rule">{RULE}</b>
          <br />
          {isAuto
            ? `Each bet backs ${lc(pick)} and ${target ? `cashes out once the value reaches ${fmtMult(target)}` : 'rides to the snap'}. RTP ${(RTP * 100).toFixed(0)}%.`
            : `Pick a colour, then Bet. The deck bar shows the next card exactly. RTP ${(RTP * 100).toFixed(0)}%.`}
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Back to Back" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{RULE} Your colour pays its prize if it is the first to be turned twice running.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Back one of four colours. Rarer colours pay more and snap less often.</li>
              <li>Press Bet. A card is turned from the shuffled 22-card deck (12 red, 5 blue, 3 green, 2 yellow).</li>
              <li>If it matches the card turned just before, that colour snaps and the round ends. Otherwise cash out (C) or turn the next card (Space).</li>
              <li>Auto: pick a colour and a cash-out target (or ride to the snap), then Start autobet. Turbo speeds every turn up.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The <b>deck bar</b> is the next card: each colour's width is its share of the cards left, so it is exactly that colour's chance. The outlined
              segment is the colour on top: if the next card is that colour it snaps. The percentage under each segment is your chance of winning if that colour
              comes next; they average to your chance now. The <b>title bar</b> splits the round between the four colours: each width is that colour's chance to
              snap first, with yours marked.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              A snap is certain: the 12 reds cannot all be kept apart by only 10 other cards (pigeonhole), so there is never a round with no winner. The state is the
              cards left and the top colour; P(i first) = Σ<sub>j</sub> (c<sub>j</sub>/N) · [j = top ? 1(j = i) : P(i first | c − e<sub>j</sub>, j)], solved
              exactly by dynamic programming.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Backing a colour with chance p pays {(RTP * 100).toFixed(0)}% ÷ p if it snaps first. The cash-out is always prize × its current chance, a martingale,
              so by the optional stopping theorem no timing of cash-outs changes the expected return of {(RTP * 100).toFixed(0)}%.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
