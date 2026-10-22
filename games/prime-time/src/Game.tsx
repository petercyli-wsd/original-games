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
import { formatAmount, type Volatility } from '@originals/game-sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import Field, { type TileView } from './Board';
import {
  BETS,
  BET_LABEL,
  BET_PHRASE,
  BET_PLURAL,
  DIGITS,
  RTP,
  allHidden,
  candidates,
  cashOut as cashValue,
  decided,
  describe,
  digitAt,
  fanStat,
  focusView,
  gridView,
  hiddenPositions,
  highest,
  hits,
  lowest,
  nextHidden,
  placeName,
  prize,
  rangeSize,
  regrids,
  reveal,
  startChance,
  winChance,
  wins,
  type Bet,
  type Digits,
  type FanStat,
  type Revealed,
} from './math';

type Phase = 'idle' | 'revealing' | 'checkpoint' | 'over';
type Outcome = 'won' | 'lost' | 'cashed';

interface Round {
  bet: Bet;
  digits: Digits;
  stake: number;
  /** The hidden number, drawn when the bet is placed. */
  n: number;
  shown: Revealed;
  cash: number;
  outcome: Outcome | null;
  /** The reveal that ended the round, to replay its slice when every digit is out. */
  last: { before: Revealed; pos: number; value: number } | null;
}

interface Anim {
  pos: number;
  value: number;
  /** roll: the tile spins to its digit; focus: the candidates outside its slice fade. */
  stage: 'roll' | 'focus';
}

const title = (bet: Bet, outcome: Outcome) => (outcome === 'won' ? `${BET_LABEL[bet]}!` : outcome === 'lost' ? `No ${BET_PLURAL[bet]} left` : 'Cashed out');

function volatilityOf(bet: Bet, digits: Digits): Volatility {
  const p = startChance(bet, digits);
  return p > 0.3 ? 'low' : p > 0.08 ? 'medium' : p > 0.01 ? 'high' : 'extreme';
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const riskNote = (f: FanStat | undefined) => (!f ? '' : f.bust > 0 ? `${pct(f.bust)} bust` : f.sure > 0 ? `${pct(f.sure)} instant win` : 'no bust');

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [backing, setBacking] = useState<Bet>('prime');
  const [digits, setDigits] = useState<Digits>(3);
  /** Which digit opens first, counted from the right (0 = units). Past the left end means the leading digit. */
  const [firstPlace, setFirstPlace] = useState(9);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [anim, setAnim] = useState<Anim | null>(null);
  const [pointer, setPointer] = useState(0);
  const [enter, setEnter] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);

  // The reveal in flight is decided the moment it starts, so leaving mid-spin
  // settles at its real result, never at the pre-reveal value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'revealing' ? resolved.current : (round?.cash ?? 0)));

  const rollMs = turbo.turbo ? 160 : 560;
  const focusMs = turbo.turbo ? 110 : 380;
  const moveMs = turbo.turbo ? 110 : 420;
  const live = phase === 'revealing' || phase === 'checkpoint';

  const firstPos = (d: number) => Math.max(0, d - 1 - Math.min(firstPlace, d - 1));

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setAnim(null);
    setPhase('over');
  }

  function open(r: Round, pos: number) {
    if (r.shown[pos] !== null) return;
    const value = digitAt(r.n, r.digits, pos);
    const shown = reveal(r.shown, pos, value);
    const end = decided(r.bet, shown);
    const cash = end === 'won' ? prize(r.bet, r.digits) : end === 'lost' ? 0 : cashValue(r.bet, shown);
    resolved.current = cash;
    const regrid = regrids(r.shown, pos);
    setPhase('revealing');
    setAnim({ pos, value, stage: 'roll' });
    timers.after(rollMs, () => {
      setAnim({ pos, value, stage: 'focus' });
      timers.after(focusMs, () => {
        const next = { ...r, shown, cash, last: { before: r.shown, pos, value } };
        setAnim(null);
        setEnter(regrid);
        if (end) return finish(next, end, cash);
        setRound(next);
        setPointer(nextHidden(shown, pos) ?? 0);
        setPhase('checkpoint');
        track({ type: 'checkpoint', multiplier: cash, winChance: winChance(r.bet, shown) });
      });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const n = lowest(digits) + rng.int(rangeSize(digits));
    const r: Round = { bet: backing, digits, stake: bet.value, n, shown: allHidden(digits), cash: RTP, outcome: null, last: null };
    setEnter(true);
    setRound(r);
    open(r, firstPos(digits));
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setAnim(null);
    setEnter(true);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  // What the board shows: the live or finished round, else a preview of the settings.
  const b = round?.bet ?? backing;
  const d = round?.digits ?? digits;
  const shown = useMemo(() => round?.shown ?? allHidden(d), [round, d]);
  const chance = winChance(b, shown);
  const cands = candidates(shown);
  const winners = hits(b, shown);
  // A round decided by its last digit ends on that digit's row, the landed number lit or not among its neighbours.
  const lastSlice = phase === 'over' && round?.last && candidates(round.shown) === 1 ? round.last : null;
  const view = useMemo(
    () =>
      anim?.stage === 'focus'
        ? focusView(b, shown, anim.pos, anim.value)
        : lastSlice
          ? focusView(b, lastSlice.before, lastSlice.pos, lastSlice.value)
          : gridView(b, shown),
    [b, shown, anim, lastSlice],
  );
  const fans = useMemo(() => (phase === 'over' ? [] : hiddenPositions(shown).map((p) => fanStat(b, shown, p))), [b, shown, phase]);
  const visibleFans = anim ? fans.filter((f) => f.pos !== anim.pos) : fans;
  const pointerPos = phase === 'checkpoint' ? pointer : phase === 'idle' ? firstPos(d) : null;
  const pointerFan = fans.find((f) => f.pos === pointerPos);

  const tiles: TileView[] = shown.map((v, pos) => {
    if (anim && anim.pos === pos) return { pos, value: anim.value, state: anim.stage === 'roll' ? 'rolling' : 'shown' };
    if (v !== null) return { pos, value: v, state: 'shown' };
    if (phase === 'over' && round) return { pos, value: digitAt(round.n, d, pos), state: 'auto' };
    return { pos, value: null, state: 'hidden' };
  });

  function onTile(pos: number) {
    if (phase === 'checkpoint' && round) open(round, pos);
    else if (phase === 'idle') setFirstPlace(d - 1 - pos);
  }

  // ← / → move the "next" marker between hidden digits.
  const arrows = useRef<(dir: number) => void>(() => {});
  arrows.current = (dir) => {
    const hidden = hiddenPositions(shown);
    if (pointerPos === null || hidden.length < 2 || (phase !== 'checkpoint' && phase !== 'idle')) return;
    const at = hidden.indexOf(pointerPos);
    const to = hidden[(at + dir + hidden.length) % hidden.length];
    if (phase === 'checkpoint') setPointer(to);
    else setFirstPlace(d - 1 - to);
  };
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t?.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        arrows.current(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? open(round, pointer) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const fullPrize = prize(b, d);
  const vol = volatilityOf(backing, digits);
  const opened = shown.filter((v) => v !== null).length;

  let status = `Ready · ${d}-digit N · ${BET_LABEL[b]}`;
  if (phase === 'revealing' && anim) status = `Revealing the ${placeName(d, anim.pos)} digit`;
  if (phase === 'checkpoint') status = `Checkpoint · ${opened} of ${d} digits open`;
  if (phase === 'over' && round?.outcome) status = `${title(b, round.outcome)} · N = ${round.n}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Prime Time"
      accent="#ffb4a2"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Bet that N is</Label>
          <Chips
            label="Bet that N is"
            options={BETS.map((v) => ({ value: v, label: BET_LABEL[v] }))}
            value={backing}
            disabled={live}
            onChange={(v) => change(() => setBacking(v))}
          />

          <Label hint={`N from ${lowest(digits)} to ${highest(digits)}`}>Digits in N</Label>
          <Chips
            label="Digits in N"
            options={DIGITS.map((v) => ({ value: v, label: v }))}
            value={digits}
            disabled={live}
            onChange={(v) => change(() => setDigits(v))}
          />
          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(startChance(backing, digits))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prize(backing, digits))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && open(round, pointer)}>
                Reveal {placeName(d, pointer)} · {riskNote(pointerFan)}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'revealing' ? 'Revealing…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            value: fmtChance(chance),
            sub: `${winners.toLocaleString('en-US')} of ${cands.toLocaleString('en-US')} lit`,
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: formatAmount(stake * cash, 2), tone: 'cash' },
          { label: 'Prize', value: fmtMult(fullPrize), sub: `if N is ${BET_PHRASE[b]}`, tone: 'prize' },
        ]}
      />

      <Board>
        <Field
          digits={d}
          bet={b}
          tiles={tiles}
          pointer={pointerPos}
          pointerLabel={phase === 'idle' ? 'first' : 'next'}
          onTile={phase === 'idle' || phase === 'checkpoint' ? onTile : undefined}
          fans={visibleFans}
          chance={chance}
          view={view}
          enter={enter}
          settled={!!lastSlice}
          target={phase === 'over' && round ? round.n : null}
          targetWins={!!round && wins(b, round.n)}
          verdict={phase === 'over' && round ? describe(round.n) : null}
          candidates={cands}
          winners={winners}
          rollMs={rollMs}
          moveMs={moveMs}
          overlay={
            phase === 'over' && round?.outcome
              ? (wide) => (
                  <RoundOver
                    key={history[0]?.id}
                    title={title(round.bet, round.outcome!)}
                    multiplier={round.cash}
                    stake={round.stake}
                    nextBet={bet.value}
                    blocked={bet.blocked}
                    onBetAgain={() => void start()}
                    onClear={clear}
                    placement={wide ? 'center' : 'bottom'}
                  />
                )
              : undefined
          }
        />
      </Board>

      {live ? (
        <ChanceBar
          p={chance}
          label={`Chance N is ${BET_PHRASE[b]}`}
          note="Exactly the lit share of the candidate dots. The bars under each ? show where its reveal could move it."
        />
      ) : (
        <Caption>
          N is a random {d}-digit number. {startChanceText(b, d)} Tap a ? to choose which digit opens first. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Prime Time" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A whole number N with the number of digits you chose is hidden behind the tiles. Bet that it is <b>prime</b>, <b>not prime</b>, or a{' '}
              <b>perfect square</b>, then open its digits one at a time.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick what N is, and how many digits it has. Tap a ? to choose which digit opens first, then bet.</li>
              <li>After each digit you can cash out, or open another digit: tap its tile, use the Reveal button or press Space (← and → move the marker).</li>
              <li>If no winning number is left among the candidates the round is lost. If every candidate wins, you're paid the prize at once.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The dots are every number still consistent with the digits shown, laid out like a hundred chart (blocks, rows and columns are the hidden digits).
              Winning numbers are <b style={{ color: 'var(--accent)' }}>lit</b>, so the lit share of the dots is exactly your chance. When there are too many
              candidates, each dot holds 10 or 100 numbers and its lit area is the share of them that win; a thin ring marks a dot whose few winners are too
              small to see.
            </p>
            <p>
              Under each hidden digit, one bar per value it could show gives your chance after that reveal. <b style={{ color: 'var(--red)' }}>Red</b> ticks end
              the round, <b style={{ color: 'var(--green)' }}>green</b> bars win it outright, and the dashed line is your chance now.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The counts are exact, from a sieve of Eratosthenes. The prime number theorem says primes near x have density about 1/ln x, so they thin out
              slowly: 21 of the 90 two-digit numbers are prime, 8,363 of the 90,000 five-digit ones. Squares thin out much faster: there are only ⌊√(10
              <sup>d</sup>−1)⌋ − ⌈√10<sup>d−1</sup>⌉ + 1 of them.
            </p>
            <p>
              Every hidden digit is equally likely to be each of its values, and each value keeps the same number of candidates. So the bars under a tile always
              average to the dashed line (the law of total probability): which digit you open changes how far the odds jump, never what the round is worth.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays prize = {(RTP * 100).toFixed(0)}% ÷ P(win), fixed when you bet. Cashing out pays prize × (lit share now). That value is a martingale:
              on average a reveal leaves it where it was. By optional stopping, every strategy (any order, any moment to stop) returns exactly{' '}
              {(RTP * 100).toFixed(0)}% of your stake.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}

function startChanceText(bet: Bet, d: Digits) {
  const all = allHidden(d);
  return `${hits(bet, all).toLocaleString('en-US')} of the ${candidates(all).toLocaleString('en-US')} are ${BET_PLURAL[bet]}, so you win ${fmtChance(startChance(bet, d))} of the time.`;
}
