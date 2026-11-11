import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  Caption,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  Label,
  ModeTabs,
  PanelFoot,
  Readouts,
  RoundOver,
  StageTop,
  VolBadge,
  eventMs,
  fmtChance,
  fmtMult,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import { PlayingCard, Paytable, type Slot } from './Cards';
import { ACCENT } from './manifest';
import {
  FULL_HOUSE,
  MAX_MULTIPLIER,
  NOTHING,
  PAYTABLES,
  PAYTABLE_IDS,
  QUADS,
  ROYAL,
  analyse,
  categoryOf,
  deal,
  draw,
  handName,
  holdDist,
  holdValue,
  payingChance,
  popcount5,
  scoringMask,
  solve,
  warmUp,
  type Analysis,
  type Card,
  type PaytableId,
  type Solution,
} from './math';

type Phase = 'idle' | 'dealing' | 'holding' | 'drawing' | 'over';

interface Round {
  table: PaytableId;
  stake: number;
  dealt: Card[];
  analysis: Analysis;
  solution: Solution;
  final: Card[] | null;
  cat: number | null;
  multiplier: number;
  /** The hold the draw was made with. */
  drawnHold: number | null;
}

type StopOn = 'off' | 'full' | 'quads' | 'royal';
const STOP_LABEL: Record<StopOn, string> = { off: 'Off', full: 'Full house +', quads: 'Four of a kind +', royal: 'Royal flush' };
const stopHit = (stop: StopOn, cat: number) =>
  stop === 'full' ? cat >= FULL_HOUSE : stop === 'quads' ? cat >= QUADS : stop === 'royal' ? cat === ROYAL : false;

const TABLE_CHIP: Record<PaytableId, string> = { classic: 'Classic 9/6', bonus: 'Bonus 8/5', double: 'Double Bonus', kicker: 'Kicker Bonus' };

const backs = (): Slot[] => Array.from({ length: 5 }, (_, i) => ({ card: null, v: -1 - i, delay: 0 }));

/** Ignore shortcuts while typing in a field. */
function typing(e: KeyboardEvent) {
  const t = e.composedPath()[0] as HTMLElement | undefined;
  if (!t || !t.tagName) return false;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true;
  return t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type);
}

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [table, setTable] = useState<PaytableId>('classic');
  const [hint, setHint] = useState(false);
  const [stopOn, setStopOn] = useState<StopOn>('off');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [hold, setHold] = useState(0);
  const [slots, setSlots] = useState<Slot[]>(backs);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // Leaving mid-hand settles at the best hold's exact value (what Auto would
  // play), or at the drawn result once the draw has started.
  const fair = useRef(0);
  const ticket = useTicket(() => fair.current);

  // The solver's shared tables (~20 ms) are filled once, off the first paint.
  useEffect(() => {
    const id = window.setTimeout(warmUp, 50);
    return () => window.clearTimeout(id);
  }, []);

  const t = turbo.turbo;
  const stagger = t ? 25 : 70;
  const tuckMs = t ? 40 : 120;
  const autoHoldMs = t ? 100 : 280;

  const live = phase === 'dealing' || phase === 'holding' || phase === 'drawing';
  const pt = PAYTABLES[round?.table ?? table];

  /** Places the bet, deals five cards and animates them in. Returns the round, or null if refused/cancelled. */
  async function begin(stake: number): Promise<Round | null> {
    if (!(await ticket.place(stake))) return null;
    timers.clearAll();
    const tbl = PAYTABLES[table];
    const dealt = deal(rng);
    const analysis = analyse(dealt);
    const solution = solve(analysis, tbl.pays);
    fair.current = solution.bestValue;
    const r: Round = { table, stake, dealt, analysis, solution, final: null, cat: null, multiplier: 0, drawnHold: null };
    setRound(r);
    setHold(0);
    setPhase('dealing');
    const hadCards = slots.some((s) => s.card !== null);
    if (hadCards) {
      setSlots(backs());
      if (!(await timers.wait(tuckMs))) return null;
    }
    setSlots(dealt.map((card, i) => ({ card, v: ++seq.current, delay: i * stagger })));
    if (!(await timers.wait(flipMs + 4 * stagger + 40))) return null;
    setPhase('holding');
    return r;
  }

  /** Draws with the given hold, animates the replacements, settles. Resolves to the final category and multiplier. */
  async function drawWith(r: Round, h: number): Promise<{ cat: number; multiplier: number } | null> {
    const final = draw(r.dealt, h, rng);
    const cat = categoryOf(final);
    const multiplier = PAYTABLES[r.table].pays[cat];
    fair.current = multiplier; // decided now: leaving mid-flip settles at the real result
    setHold(h);
    setPhase('drawing');
    const replaced = [0, 1, 2, 3, 4].filter((i) => !(h & (1 << i)));
    if (replaced.length) {
      setSlots((s) => s.map((x, i) => (h & (1 << i) ? x : { card: null, v: x.v, delay: 0 })));
      if (!(await timers.wait(tuckMs))) return null;
      setSlots((s) => s.map((x, i) => (h & (1 << i) ? x : { card: final[i], v: ++seq.current, delay: replaced.indexOf(i) * stagger })));
      if (!(await timers.wait(flipMs + (replaced.length - 1) * stagger + 60))) return null;
    }
    ticket.settle(multiplier);
    fair.current = 0;
    pushHistory(multiplier);
    setRound({ ...r, final, cat, multiplier, drawnHold: h });
    setPhase('over');
    return { cat, multiplier };
  }

  async function start() {
    if (live || bet.blocked || auto.running) return;
    await begin(bet.value);
  }

  function drawNow() {
    if (phase !== 'holding' || !round) return;
    void drawWith(round, hold);
  }

  function toggle(i: number) {
    if (phase !== 'holding' || auto.mode !== 'manual') return;
    setHold((h) => h ^ (1 << i));
  }

  function holdBest() {
    if (phase !== 'holding' || !round || auto.mode !== 'manual') return;
    setHold(round.solution.best);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setHold(0);
    setSlots(backs());
    setPhase('idle');
  }

  const stopRef = useRef(stopOn);
  stopRef.current = stopOn;
  const autoRef = useRef<{ stop(): void } | null>(null);

  async function playAuto(stake: number): Promise<number | null> {
    const r = await begin(stake);
    if (!r) return null;
    setHold(r.solution.best);
    if (!(await timers.wait(autoHoldMs))) return null;
    const res = await drawWith(r, r.solution.best);
    if (!res) return null;
    if (stopHit(stopRef.current, res.cat)) autoRef.current?.stop();
    return res.multiplier;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: t });
  autoRef.current = auto;
  // A manual flip takes a full event; Auto keeps its quicker pace. (Read when a round runs, after this line.)
  const flipMs = auto.mode === 'manual' ? eventMs(t) : t ? eventMs(true) : 300;
  const busy = live || auto.running;

  // Changing a setting after a round clears the finished board.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  const manual = auto.mode === 'manual';
  useHotkeys(
    {
      space: () => {
        if (!manual || auto.running) return;
        if (phase === 'holding') drawNow();
        else if (!live) void start();
      },
    },
    !infoOpen,
  );

  // 1–5 hold, H holds the best cards.
  const keyRef = useRef({ toggle, holdBest });
  keyRef.current = { toggle, holdBest };
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const n = e.key >= '1' && e.key <= '5' ? Number(e.key) : 0;
      if (n) {
        e.preventDefault();
        keyRef.current.toggle(n - 1);
      } else if (e.key === 'h' || e.key === 'H') keyRef.current.holdBest();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  // ---------------------------------------------------------------- view model

  const a = round?.analysis ?? null;
  const shownHold = phase === 'over' ? round?.drawnHold ?? 0 : hold;
  const inHand = phase === 'holding' || phase === 'drawing' || phase === 'over';
  const holdVal = a && inHand ? holdValue(a, shownHold, pt.pays) : 0;
  const best = round?.solution ?? null;
  const onBest = !!best && best.ties.includes(shownHold);
  const pay = a && inHand ? payingChance(a, shownHold, pt.pays) : 0;
  const idlePaying = pt.dist.reduce((s, p, c) => s + (pt.pays[c] > 0 ? p : 0), 0);
  const madeCat = round && inHand && phase !== 'over' ? categoryOf(round.dealt) : null;
  const madeName = madeCat !== null ? handName(pt, madeCat) : null;
  const scoring = phase === 'over' && round?.final && round.cat !== null ? scoringMask(round.final, round.cat) : 0;
  const showBest = hint && best && (phase === 'holding' || phase === 'dealing') && manual;

  let status = `Ready · ${pt.name} ${pt.schedule.split(' ')[0]}`;
  if (phase === 'dealing') status = 'Dealing…';
  if (phase === 'holding')
    status = !manual
      ? 'Auto · holding the best cards'
      : madeCat && madeCat !== NOTHING
        ? `Dealt ${madeName} · choose holds`
        : 'Choose cards to hold';
  if (phase === 'drawing') status = 'Drawing…';
  if (phase === 'over' && round) status = round.cat ? `${handName(pt, round.cat)} · ${fmtMult(round.multiplier)}` : 'No win';
  const tone = phase === 'over' ? (round && round.multiplier >= 1 ? 'won' : 'lost') : live ? 'live' : 'idle';

  // One chance and one payout.
  const readouts =
    inHand && round
      ? [
          { label: 'Paying hand', value: fmtChance(pay), tone: 'chance' as const },
          phase === 'over'
            ? { label: 'Paid', value: fmtMult(round.multiplier), tone: round.multiplier > 0 ? ('prize' as const) : ('neutral' as const) }
            : { label: 'Hold value', value: fmtMult(holdVal), tone: 'prize' as const },
        ]
      : [
          { label: 'Paying hand', value: fmtChance(idlePaying), tone: 'chance' as const },
          { label: 'Royal flush', value: fmtMult(MAX_MULTIPLIER), tone: 'prize' as const },
        ];

  return (
    <GameLayout
      name="Video Poker"
      accent={ACCENT}
      className="vp-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={PAYTABLES[table].volatility} />}>Paytable</Label>
          <div className="vp-chips2">
          <Chips
            label="Paytable"
            wrap
            options={PAYTABLE_IDS.map((id) => ({ value: id, label: TABLE_CHIP[id], title: `${PAYTABLES[id].schedule} · ${(PAYTABLES[id].rtp * 100).toFixed(2)}% RTP` }))}
            value={table}
            disabled={busy}
            onChange={(v) => change(() => setTable(v))}
          />
          </div>

          {manual ? (
            <>
              <label className="og-toggle vp-hint-toggle">
                <input type="checkbox" checked={hint} onChange={(e) => setHint(e.target.checked)} />
                <span>Show best hold</span>
              </label>
              {phase === 'holding' ? (
                <>
                  <ActionButton onClick={drawNow}>
                    {popcount5(hold) === 5 ? 'Stand pat' : `Draw ${5 - popcount5(hold)} card${5 - popcount5(hold) > 1 ? 's' : ''}`}
                  </ActionButton>
                  <ActionButton kind="secondary" onClick={holdBest} disabled={onBest}>
                    {onBest ? 'Holding the best cards' : 'Hold best'}
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                  {phase === 'dealing' ? 'Dealing…' : phase === 'drawing' ? 'Drawing…' : phase === 'over' ? 'Bet again' : 'Deal'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || (live && !auto.running)}>
              <Label hint="holds: best play">Stop on hand</Label>
              <div className="vp-select">
                <select aria-label="Stop on hand" value={stopOn} disabled={auto.running} onChange={(e) => setStopOn(e.target.value as StopOn)}>
                  {(Object.keys(STOP_LABEL) as StopOn[]).map((k) => (
                    <option key={k} value={k}>
                      {STOP_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
            </AutoBetControls>
          )}
          {bet.blocked && !busy && <p className="vp-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className="vp-board">
        <div className="vp-table">
          <Paytable
            table={pt}
            made={madeCat && madeCat !== NOTHING ? madeCat : null}
            hit={phase === 'over' && round?.cat ? round.cat : null}
            dist={a && inHand ? holdDist(a, shownHold) : pt.dist}
          />

          <div className={'vp-hand' + (phase === 'over' ? ' over' : '') + (phase === 'over' && round && round.multiplier === 0 ? ' lost' : '')}>
            {slots.map((s, i) => {
              const held = inHand && !!(shownHold & (1 << i));
              const isBest = showBest && !!(best!.best & (1 << i));
              const cls =
                'vp-slot' +
                (held ? ' held' : '') +
                (isBest ? ' best' : '') +
                (phase === 'over' && scoring & (1 << i) ? ' score' : '') +
                (phase === 'over' && round?.cat && !(scoring & (1 << i)) ? ' dim' : '');
              return (
                <div key={i} className={cls}>
                  <button
                    type="button"
                    className="vp-slot-btn"
                    disabled={phase !== 'holding' || !manual}
                    onClick={() => toggle(i)}
                    aria-pressed={held}
                    aria-label={`${s.card === null ? 'Card' : 'Hold'} ${i + 1}`}
                  >
                    {isBest && <span className="vp-best-tag">best</span>}
                    <PlayingCard slot={s} ms={flipMs} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="vp-foot">
            {phase === 'over' && round && manual ? (
              <RoundOver
                key={history[0]?.id}
                title={round.cat ? handName(pt, round.cat) : 'No win'}
                multiplier={round.multiplier}
                stake={round.stake}
                nextBet={bet.value}
                blocked={bet.blocked}
                onBetAgain={() => void start()}
                onClear={clear}
                placement="inline"
              />
            ) : (
              <div className="vp-holds">
                {[0, 1, 2, 3, 4].map((i) => {
                  const held = inHand && !!(shownHold & (1 << i));
                  return (
                    <button
                      key={i}
                      type="button"
                      className={'vp-hold' + (held ? ' on' : '')}
                      disabled={phase !== 'holding' || !manual}
                      onClick={() => toggle(i)}
                      aria-pressed={held}
                    >
                      {held ? 'Held' : 'Hold'}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Board>

      <Caption>Hold the cards you want, draw once, and the final hand is paid by the paytable.</Caption>

      {infoOpen && (
        <InfoModal title="Video Poker" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Make the best five-card poker hand you can from one deal and one draw. The paytable on the board says what each hand returns.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a paytable and your bet, then press Deal (Space).</li>
              <li>Click the cards you want to keep, or press 1–5. H holds the best cards for you.</li>
              <li>Press Draw (Space). Every card you did not hold is replaced from the rest of the deck, and the final hand is paid.</li>
              <li>Auto plays the best hold every hand. Set the number of bets, stake changes on win/loss, stop rules, and optionally stop on a big hand.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Before you bet, “Paying hand” is how often a hand finishes paying under best play. Once dealt, it is the exact chance that the cards you are
              holding finish as a paying hand, counted over every possible draw, and “Hold value” is that hold's expected return. The hand you were dealt is
              highlighted in the paytable, and the final paying hand is marked green. “Show best hold” outlines the best cards on the deal. Keys: 1–5 hold a
              card, H holds the best cards, Space deals and draws.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Holding H out of your five leaves C(47, 5 − |H|) equally likely draws. Inclusion–exclusion counts them exactly: N(H) = Σ<sub>T ⊆ D</sub> (−1)
              <sup>|T|</sup> S(H ∪ T), where D are the discards and S(X) counts the hands of the full deck that contain X. All 32 holds come out of one
              Möbius transform over the subsets of your hand, a few thousand operations instead of 2.6 million draws. Averaging the best hold over all
              2,598,960 deals gives each table's exact return.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Pays are total returns per unit staked (“9 for 1”): a pair of jacks or better gives your stake back. One 52-card deck is shuffled for every hand.
              With best play: Classic 9/6 {(PAYTABLES.classic.rtp * 100).toFixed(2)}%, Bonus 8/5 {(PAYTABLES.bonus.rtp * 100).toFixed(2)}%, Double Bonus{' '}
              {(PAYTABLES.double.rtp * 100).toFixed(2)}%, Kicker Bonus {(PAYTABLES.kicker.rtp * 100).toFixed(2)}%. The bonus tables pay more for four of a kind
              (most for aces, and on Kicker Bonus for the right fifth card) and less for two pair and flushes, so they swing harder. Holding anything other
              than the best cards lowers your return. The royal flush pays {MAX_MULTIPLIER}× on every table, the top prize.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
