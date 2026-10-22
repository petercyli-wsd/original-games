import { formatAmount, type Volatility } from '@originals/game-sdk';
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
import { CallButton, Deck, Ladder, PlayingCard, Trail, type Shown, type TrailItem } from './Cards';
import {
  MAX_WIN,
  RANKS,
  RANK_LABEL,
  RTP,
  SUIT_GLYPH,
  afterWin,
  autoRound,
  available,
  chance,
  drawCard,
  factor,
  guessLabel,
  likelier,
  mainPair,
  maxWinReached,
  streakChance,
  wins,
  withinCap,
  type AutoPick,
  type AutoStop,
  type Calls,
  type Card,
  type Guess,
  type SkipRule,
} from './math';

type Phase = 'idle' | 'live' | 'dealing' | 'over';
type Outcome = 'bust' | 'cashed' | 'max';
type StartPref = 'random' | number;

interface Round {
  stake: number;
  cash: number;
  /** Correct calls so far. */
  won: number;
  outcome: Outcome | null;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
  outcome: Outcome;
}

const OUTCOME_TITLE: Record<Outcome, string> = { bust: 'Wrong call', cashed: 'Cashed out', max: 'Max win reached' };
const PICK_LABEL: Record<AutoPick, string> = { likelier: 'Likelier', higher: 'Higher', lower: 'Lower', random: 'Random' };
const SKIP_LABEL: Record<SkipRule, string> = { off: 'Off', '7': '7', '6-8': '6–8', '5-9': '5–9' };
const PICKS: AutoPick[] = ['likelier', 'higher', 'lower', 'random'];
const SKIPS: SkipRule[] = ['off', '7', '6-8', '5-9'];

const RANK_NAME = ['', 'Ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King'];
const cardName = (c: Card) => `${RANK_LABEL[c.rank]}${SUIT_GLYPH[c.suit]}`;

function volatilityOf(p: number): Volatility {
  return p > 0.3 ? 'low' : p > 0.08 ? 'medium' : p > 0.01 ? 'high' : 'extreme';
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const cardSeq = useRef(0);
  const shown = (card: Card): Shown => ({ id: ++cardSeq.current, card });

  const [startPref, setStartPref] = useState<StartPref>('random');
  const [calls, setCalls] = useState<Calls>('classic');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [card, setCard] = useState<Shown>(() => shown(drawCard(rng)));
  const [incoming, setIncoming] = useState<Shown | null>(null);
  const [trail, setTrail] = useState<TrailItem[]>([]);
  const [flash, setFlash] = useState<{ tone: 'win' | 'lose'; key: number } | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // Auto settings.
  const [pick, setPick] = useState<AutoPick>('likelier');
  const [skipRule, setSkipRule] = useState<SkipRule>('off');
  const [stopKind, setStopKind] = useState<AutoStop['kind']>('target');
  const [target, setTarget] = useState(2);
  const [targetText, setTargetText] = useState('2.00');
  const [streak, setStreak] = useState(3);
  const [streakText, setStreakText] = useState('3');
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const lastSeq = useRef(0);

  // A call is decided the moment it is made, so leaving mid-flip settles at
  // its real result. At a checkpoint the fair value is the cash-out itself.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'dealing' || autoBusy ? resolved.current : phase === 'live' && round ? round.cash : 0));

  const dealMs = turbo.turbo ? 130 : 520;
  const live = phase === 'live' || phase === 'dealing';
  const dealing = incoming !== null;

  const fixedCard = (pref: StartPref) => (pref === 'random' ? null : { rank: pref, suit: rng.int(4) });

  function showFlash(tone: 'win' | 'lose') {
    setFlash({ tone, key: Date.now() });
  }

  /** Slides `next` in from the deck, flips it, then makes it the current card. */
  function deal(next: Card, ms: number, after: (s: Shown) => void) {
    const s = shown(next);
    setIncoming(s);
    timers.after(ms, () => {
      setCard(s);
      setIncoming(null);
      after(s);
    });
  }

  const trailItem = (s: Shown, action: TrailItem['action'], won: boolean | null, cash: number): TrailItem => ({ id: s.id, card: s.card, action, won, cash });

  // ---------- Manual ----------

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  async function start() {
    if (live || autoBusy || dealing || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setFlash(null);
    setLast(null);
    // A fixed start card is dealt fresh; a random start continues from the card showing (as at the table).
    const fixed = fixedCard(startPref);
    const c = fixed ? shown(fixed) : card;
    setCard(c);
    setIncoming(null);
    setTrail([trailItem(c, 'start', null, RTP)]);
    setRound({ stake: bet.value, cash: RTP, won: 0, outcome: null });
    setPhase('live');
  }

  function call(g: Guess) {
    if (phase !== 'live' || !round || dealing) return;
    const from = card.card;
    if (!available(g, from.rank, calls) || !withinCap(round.cash, g, from.rank)) return;
    const next = drawCard(rng);
    const ok = wins(g, from, next);
    const cash = ok ? afterWin(round.cash, g, from.rank) : 0;
    resolved.current = cash;
    setPhase('dealing');
    setFlash(null);
    deal(next, dealMs, (s) => {
      setTrail((t) => [...t, trailItem(s, g, ok, cash)]);
      showFlash(ok ? 'win' : 'lose');
      if (!ok) return finish(round, 'bust', 0);
      const nr = { ...round, cash, won: round.won + 1 };
      if (maxWinReached(cash)) return finish(nr, 'max', cash);
      setRound(nr);
      setPhase('live');
      track({ type: 'checkpoint', multiplier: cash, winChance: chance(likelier(next.rank), next.rank) });
    });
  }

  function skip() {
    if (dealing || autoBusy) return;
    if (phase === 'live' && round) {
      resolved.current = round.cash;
      setPhase('dealing');
      setFlash(null);
      deal(drawCard(rng), dealMs, (s) => {
        setTrail((t) => [...t, trailItem(s, 'skip', null, round.cash)]);
        setPhase('live');
      });
    } else if (phase !== 'dealing' && startPref === 'random') {
      // Before betting: a free look at another start card.
      if (phase === 'over') clear();
      setFlash(null);
      deal(drawCard(rng), dealMs, () => {});
    }
  }

  function cashOut() {
    if (phase !== 'live' || !round || round.won === 0 || dealing) return;
    finish(round, 'cashed', round.cash);
  }

  function clear(pref: StartPref = startPref) {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setTrail([]);
    setIncoming(null);
    setFlash(null);
    setLast(null);
    setPhase('idle');
    const fixed = fixedCard(pref);
    if (fixed) setCard(shown(fixed));
  }

  // Changing a setting after a round clears the board to a preview of the new settings.
  function changeStart(pref: StartPref) {
    if (live || autoBusy) return;
    setStartPref(pref);
    if (phase === 'over' || last) clear(pref);
    else if (pref !== 'random') setCard(shown({ rank: pref, suit: rng.int(4) }));
  }

  function changeCalls(c: Calls) {
    setCalls(c);
    if (phase === 'over') clear();
  }

  // ---------- Auto ----------

  const stop: AutoStop = stopKind === 'target' ? { kind: 'target', value: target } : { kind: 'streak', value: streak };

  async function playAuto(stake: number): Promise<number | null> {
    if (!(await ticket.place(stake))) return null;
    const res = autoRound({ pick, skip: skipRule, stop, start: fixedCard(startPref) }, rng);
    resolved.current = res.multiplier;
    setAutoBusy(true);
    setRound(null);
    setPhase('idle');
    setLast(null);
    setFlash(null);
    const first = shown(res.frames[0].card);
    setCard(first);
    setIncoming(null);
    setTrail([trailItem(first, 'start', null, RTP)]);
    // Long rounds play faster, so a round never drags.
    const n = res.frames.length - 1;
    const step = Math.max(turbo.turbo ? 40 : 90, Math.min(turbo.turbo ? 90 : 300, 3600 / Math.max(1, n)));
    let ok = await timers.wait(Math.min(step, 160));
    for (let i = 1; i <= n && ok; i++) {
      const f = res.frames[i];
      const s = shown(f.card);
      setIncoming(s);
      ok = await timers.wait(step);
      setCard(s);
      setIncoming(null);
      setTrail((t) => [...t, trailItem(s, f.action, f.won, f.cash)]);
      if (f.won !== null) showFlash(f.won ? 'win' : 'lose');
    }
    ticket.settle(res.multiplier);
    pushHistory(res.multiplier);
    setLast({ id: ++lastSeq.current, multiplier: res.multiplier, stake, outcome: res.outcome });
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
    setTrail([]);
    setIncoming(null);
    setFlash(null);
    setLast(null);
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  // Clear the win / lose glow shortly after it shows.
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash((f) => (f && f.key === flash.key ? null : f)), 900);
    return () => window.clearTimeout(id);
  }, [flash]);

  // ---------- Keys ----------

  const rank = card.card.rank;
  const [up, down] = mainPair(rank);

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'live') call(likelier(rank));
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (isAuto) return;
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'h') call(up);
    else if (k === 'arrowdown' || k === 'l') call(down);
    else if (k === 'arrowright' || k === 's') skip();
    else if (k === 'e') call('same');
    else if (k === 'r') call('red');
    else if (k === 'b') call('black');
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t?.tagName === 'SELECT' || t?.tagName === 'TEXTAREA' || (t?.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type))) return;
      keyRef.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  // ---------- What the board shows ----------

  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const won = round?.won ?? 0;
  const base = phase === 'live' || phase === 'dealing' ? cash : RTP;
  const canCall = (g: Guess) => phase === 'live' && !dealing && available(g, rank, calls) && withinCap(base, g, rank);
  const pUp = chance(up, rank);
  const pDown = chance(down, rank);
  const best = likelier(rank);
  // The next round's first card: the fixed start card, or (random) the card showing.
  const nextRank = !live && typeof startPref === 'number' ? startPref : rank;
  const nextBest = likelier(nextRank);

  const autoP = stopKind === 'streak' ? streakChance(pick, skipRule, streak, startPref === 'random' ? null : startPref) : Math.min(1, RTP / target);
  const autoVol = volatilityOf(autoP);

  let status = `Ready · start card ${cardName(card.card)}`;
  let tone: 'idle' | 'live' | 'won' | 'lost' = 'idle';
  if (isAuto) {
    if (auto.running || autoBusy) {
      status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ' · running'}`;
      tone = 'live';
    } else if (last) {
      status = last.outcome === 'bust' ? 'Wrong call' : `${OUTCOME_TITLE[last.outcome]} · ${fmtMult(last.multiplier)}`;
      tone = last.multiplier > 0 ? 'won' : 'lost';
    } else status = `Auto · ${PICK_LABEL[pick].toLowerCase()} call, ${stopKind === 'target' ? `cash out at ${fmtMult(target)}` : `${streak} right in a row`}`;
  } else if (phase === 'dealing') {
    status = 'Dealing…';
    tone = 'live';
  } else if (phase === 'live') {
    status = won === 0 ? 'Make your first call' : `${won} right · ${fmtMult(cash)}`;
    tone = 'live';
  } else if (phase === 'over' && round?.outcome) {
    status = `${OUTCOME_TITLE[round.outcome]} · ${won} right`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  const readouts: ReadoutItem[] = isAuto
    ? [
        {
          label: 'Win chance',
          value: stopKind === 'streak' ? fmtChance(autoP) : `≤ ${fmtChance(autoP)}`,
          sub: stopKind === 'streak' ? `${streak} right in a row` : `reach ${fmtMult(target)}`,
          tone: 'chance',
        },
        {
          label: stopKind === 'streak' ? 'Average payout' : 'Payout',
          value: stopKind === 'streak' ? fmtMult(RTP / autoP) : `≥ ${fmtMult(target)}`,
          sub: formatAmount(bet.value * (stopKind === 'streak' ? RTP / autoP : target), 2),
          tone: 'cash',
        },
        { label: 'Rule', value: PICK_LABEL[pick], sub: skipRule === 'off' ? 'no skips' : `skips ${SKIP_LABEL[skipRule]}`, tone: 'prize' },
      ]
    : [
        { label: `▲ ${guessLabel(up, rank)}`, value: fmtChance(pUp), sub: `wins ${fmtMult(base * factor(up, rank))}`, tone: 'chance' },
        {
          label: phase === 'over' ? 'Result' : 'Cash out now',
          value: (live && won > 0) || phase === 'over' ? fmtMult(cash) : '—',
          sub: (live && won > 0) || phase === 'over' ? formatAmount(stake * cash, 2) : live ? 'after a right call' : `round starts at ${fmtMult(RTP)}`,
          tone: 'cash',
        },
        { label: `▼ ${guessLabel(down, rank)}`, value: fmtChance(pDown), sub: `wins ${fmtMult(base * factor(down, rank))}`, tone: 'chance' },
      ];

  const overCap = (g: Guess) => phase === 'live' && available(g, rank, calls) && !withinCap(base, g, rank);
  const capTitle = (g: Guess) => (overCap(g) ? `Would pass the ${MAX_WIN.toLocaleString('en-US')}× max win` : undefined);

  const startPicker = (
    <>
      <Label hint={startPref === 'random' ? 'Skip for a free redraw' : 'every round starts here'}>Start card</Label>
      <div className="hl-stepper">
        <button
          type="button"
          aria-label="Lower start card"
          disabled={live || autoLocked || startPref === 'random'}
          onClick={() => typeof startPref === 'number' && changeStart(startPref === 1 ? 'random' : startPref - 1)}
        >
          −
        </button>
        <select
          aria-label="Start card"
          value={String(startPref)}
          disabled={live || autoLocked}
          onChange={(e) => changeStart(e.target.value === 'random' ? 'random' : Number(e.target.value))}
        >
          <option value="random">Random card</option>
          {Array.from({ length: RANKS }, (_, i) => i + 1).map((r) => (
            <option key={r} value={r}>
              Start on {RANK_NAME[r]}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Higher start card"
          disabled={live || autoLocked || startPref === RANKS}
          onClick={() => changeStart(startPref === 'random' ? 1 : Math.min(RANKS, startPref + 1))}
        >
          +
        </button>
      </div>
    </>
  );

  const manualPanel = (
    <>
      <Label hint={calls === 'extended' ? 'adds Same, Red, Black' : 'Higher / Lower'}>Calls</Label>
      <Chips
        label="Calls"
        options={[
          { value: 'classic' as Calls, label: 'Classic' },
          { value: 'extended' as Calls, label: 'Extended' },
        ]}
        value={calls}
        disabled={live}
        onChange={changeCalls}
      />

      {live ? (
        <>
          <Label hint={fmtMult(won > 0 ? cash : 0)}>Total profit</Label>
          <div className={'hl-profit' + (won > 0 ? ' up' : '')}>
            {won > 0 ? '+' : ''}
            {formatAmount(won > 0 ? stake * cash - stake : 0, 2)}
          </div>
        </>
      ) : (
        <dl className="og-stats">
          <dt>Likelier first call</dt>
          <dd>
            {nextBest === mainPair(nextRank)[0] ? '▲' : '▼'} {fmtChance(chance(nextBest, nextRank))}
          </dd>
          <dt>It pays</dt>
          <dd>{fmtMult(RTP * factor(nextBest, nextRank))}</dd>
          <dt>Max win</dt>
          <dd>{fmtMult(MAX_WIN)}</dd>
        </dl>
      )}

      {live ? (
        <ActionButton kind="cash" disabled={phase !== 'live' || won === 0} onClick={cashOut}>
          {won === 0 ? 'Cash out after a right call' : <>Cash out <span>{formatAmount(stake * cash, 2)}</span></>}
        </ActionButton>
      ) : (
        <ActionButton disabled={!!bet.blocked || dealing} onClick={() => void start()}>
          {phase === 'over' ? 'Bet again' : 'Bet'}
        </ActionButton>
      )}

      <div className="hl-calls">
        <CallButton dir="up" guess={up} rank={rank} pays={base * factor(up, rank)} p={pUp} disabled={!canCall(up)} keyHint="↑" onClick={() => call(up)} title={capTitle(up)} />
        <CallButton dir="down" guess={down} rank={rank} pays={base * factor(down, rank)} p={pDown} disabled={!canCall(down)} keyHint="↓" onClick={() => call(down)} title={capTitle(down)} />
      </div>
      {calls === 'extended' && (
        <div className="hl-calls three">
          {rank !== 1 && rank !== RANKS && (
            <CallButton dir="same" guess="same" rank={rank} pays={base * factor('same', rank)} p={chance('same', rank)} disabled={!canCall('same')} keyHint="E" onClick={() => call('same')} title={capTitle('same')} compact />
          )}
          <CallButton dir="red" guess="red" rank={rank} pays={base * 2} p={0.5} disabled={!canCall('red')} keyHint="R" onClick={() => call('red')} title={capTitle('red')} compact />
          <CallButton dir="black" guess="black" rank={rank} pays={base * 2} p={0.5} disabled={!canCall('black')} keyHint="B" onClick={() => call('black')} title={capTitle('black')} compact />
        </div>
      )}
      <button
        type="button"
        className="og-ghost hl-skip"
        disabled={dealing || autoLocked || (phase === 'live' ? false : startPref !== 'random')}
        onClick={skip}
        title="Skip this card for free"
      >
        ↷ Skip card <kbd>S</kbd>
      </button>
    </>
  );

  const autoChoices = (
    <>
      <Label hint="each card">Call</Label>
      <Chips label="Auto call" options={PICKS.map((v) => ({ value: v, label: PICK_LABEL[v] }))} value={pick} disabled={autoLocked} onChange={(v) => setPick(v)} />
      <Label hint="free redraws">Skip middle cards</Label>
      <Chips label="Skip middle cards" options={SKIPS.map((v) => ({ value: v, label: SKIP_LABEL[v] }))} value={skipRule} disabled={autoLocked} onChange={(v) => setSkipRule(v)} />
      <Label hint={<VolBadge level={autoVol} />}>Cash out</Label>
      <div className="hl-stop">
        <Chips
          label="Cash out rule"
          options={[
            { value: 'target' as const, label: 'At ×' },
            { value: 'streak' as const, label: 'Streak' },
          ]}
          value={stopKind}
          disabled={autoLocked}
          onChange={(v) => setStopKind(v)}
        />
        {stopKind === 'target' ? (
          <div className="hl-num">
            <input
              aria-label="Cash out at multiplier"
              value={targetText}
              inputMode="decimal"
              disabled={autoLocked}
              onChange={(e) => setTargetText(e.target.value)}
              onBlur={() => {
                const v = parseFloat(targetText);
                const t = Number.isFinite(v) ? Math.min(MAX_WIN, Math.max(1.01, Math.round(v * 100) / 100)) : target;
                setTarget(t);
                setTargetText(t.toFixed(2));
              }}
            />
            <b>×</b>
          </div>
        ) : (
          <div className="hl-num">
            <input
              aria-label="Right calls in a row"
              value={streakText}
              inputMode="numeric"
              disabled={autoLocked}
              onChange={(e) => setStreakText(e.target.value)}
              onBlur={() => {
                const v = parseInt(streakText, 10);
                const n = Number.isFinite(v) ? Math.min(50, Math.max(1, v)) : streak;
                setStreak(n);
                setStreakText(String(n));
              }}
            />
            <b>in a row</b>
          </div>
        )}
      </div>
    </>
  );

  return (
    <GameLayout
      name="HiLo"
      accent="#f43f5e"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy || dealing} />
          <BetField bet={bet} disabled={live || autoLocked} />
          {startPicker}
          {isAuto ? (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              {autoChoices}
            </AutoBetControls>
          ) : (
            manualPanel
          )}
          {bet.blocked && <p className="hl-blocked">{bet.blocked}</p>}
          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <div className={'hl-readouts' + (isAuto ? ' auto' : ' manual')}>
        <Readouts items={readouts} />
      </div>

      <Board className={'hl-board' + (isAuto ? ' auto' : '')}>
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <div className="hl-table">
          <Deck onSkip={skip} disabled={isAuto || dealing || autoLocked || (phase !== 'live' && startPref !== 'random')} />
          <div className={'hl-slot' + (flash ? ` ${flash.tone}` : '')}>
            <PlayingCard key={card.id} card={card.card} />
            {incoming && <PlayingCard key={incoming.id} card={incoming.card} deal ms={isAuto ? Math.max(60, Math.min(dealMs, 260)) : dealMs} />}
          </div>
          <Ladder rank={rank} show={!dealing} />
        </div>
        <p className="hl-scale-note">
          <span>K high · A low</span>
          <span>
            Lit ranks win: <b className="u">▲ {Math.round(pUp * 13)}</b> / <b className="d">▼ {Math.round(pDown * 13)}</b> of 13
          </span>
        </p>
      </Board>

      <Trail items={trail} />

      {!isAuto && phase === 'over' && round?.outcome ? (
        <RoundOver
          key={history[0]?.id}
          title={OUTCOME_TITLE[round.outcome]}
          multiplier={round.cash}
          stake={round.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={() => clear()}
          placement="inline"
        />
      ) : !isAuto && live ? (
        <ChanceBar
          p={chance(best, rank)}
          label={`Likelier call: ${guessLabel(best, rank)}`}
          note={`${Math.round(chance(best, rank) * 13)} of the 13 ranks win it. Every call pays 1 ÷ its chance, so none is better value than another.`}
        />
      ) : (
        <Caption>
          {isAuto
            ? `Each bet deals a card and calls ${PICK_LABEL[pick].toLowerCase()} until it ${stopKind === 'target' ? `reaches ${fmtMult(target)}` : `gets ${streak} right in a row`} or misses. RTP ${(RTP * 100).toFixed(0)}%.`
            : `Call the next card higher or lower. Every right call multiplies your cash-out by 1 ÷ its chance. Skips are free. RTP ${(RTP * 100).toFixed(0)}%.`}
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="HiLo" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>A card is showing. Call whether the next card will be higher or lower, string together right calls to grow your cash-out, and cash out before a miss.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a start card (or keep it random and skip until you like it), then press Bet. The round starts at {fmtMult(RTP)} of your stake.</li>
              <li>
                Call <b>Higher or same</b> or <b>Lower or same</b>. On an Ace the calls are Higher / Same; on a King, Same / Lower. Extended calls add Same rank,
                Red and Black.
              </li>
              <li>Skip any card for free, as often as you like. Cash out after any right call; a wrong call loses the bet.</li>
              <li>Auto: choose a call rule, which middle cards to skip, and when to cash out (a multiplier or a streak), then Start autobet.</li>
              <li>Keys: Space bets (during a round it makes the likelier call), ↑ / H top call, ↓ / L bottom call, S / → skip, E same, R red, B black, C cash out, Esc clears.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The scale beside the card runs from K (top) to A (bottom). The left column lights the ranks that win the ▲ call, the right column the ranks that win
              the ▼ call. Lit cells ÷ 13 is exactly each call's chance, because every rank is equally likely on every draw (an endless deck, so past cards change
              nothing).
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              From rank r (A = 1 … K = 13): Higher or same wins with P = (14 − r) / 13, Lower or same with P = r / 13; Same is 1/13, Red and Black ½. A right
              call multiplies your cash-out by exactly 1 / P, so its expected value after the call equals the value before: the cash-out is a martingale. By the
              optional stopping theorem, no pattern of calls, skips or cash-out points can beat it.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The 1% edge is applied once, at the start (the round opens at {fmtMult(RTP)}), so every strategy returns exactly {(RTP * 100).toFixed(0)}%. Max win{' '}
              {fmtMult(MAX_WIN)}: calls that would pass it are disabled, and the round cashes out once none could fit. Payouts per right call:
            </p>
            <div className="hl-paytable">
              <div className="h">
                <span>Card</span>
                <span>▲ call</span>
                <span>▼ call</span>
              </div>
              {Array.from({ length: RANKS }, (_, i) => i + 1).map((r) => {
                const [u, d] = mainPair(r);
                return (
                  <div key={r}>
                    <span>{RANK_LABEL[r]}</span>
                    <span>
                      {guessLabel(u, r)} <b>{fmtMult(factor(u, r))}</b> <small>{fmtChance(chance(u, r))}</small>
                    </span>
                    <span>
                      {guessLabel(d, r)} <b>{fmtMult(factor(d, r))}</b> <small>{fmtChance(chance(d, r))}</small>
                    </span>
                  </div>
                );
              })}
            </div>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
