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
import Field, { type Drop, type Outcome } from './Board';
import { LENGTHS, MAX_MULTIPLIER, RTP, headline, nextDir, prizeFor, stepSafe, survives, volatilityOf, winChance, type Length, type Settings } from './math';

type Phase = 'idle' | 'dropping' | 'checkpoint' | 'over';
type First = 'up' | 'either';

interface Round {
  settings: Settings;
  stake: number;
  /** Locked at bet time: RTP / P₀. */
  prize: number;
  bars: number[];
  cash: number;
  outcome: Outcome | null;
  bustBar: number | null;
}

const ACCENT = '#f7aef8';
const OUTCOME_TITLE: Record<Outcome, string> = { bust: 'Pattern broken', cashed: 'Cashed out', full: 'Zigzag!' };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [n, setN] = useState<Length>(6);
  const [first, setFirst] = useState<First>('up');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // A bar is decided the moment it starts growing, so leaving mid-animation
  // settles at its real result, never at the pre-bar value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'dropping' ? resolved.current : round?.cash ?? 0));

  const growMs = turbo.turbo ? 180 : 700;
  const live = phase === 'dropping' || phase === 'checkpoint';
  const chosen: Settings = { n, either: first === 'either' };

  function finish(r: Round, outcome: Outcome, cash: number, bustBar: number | null = null) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash, bustBar });
    setDrop(null);
    setPhase('over');
  }

  function next(r: Round) {
    const y = rng.next();
    const safe = survives(r.bars, y, r.settings.either);
    const bars = [...r.bars, y];
    const full = safe && bars.length >= r.settings.n;
    const cash = !safe ? 0 : full ? r.prize : r.prize * winChance(bars, r.settings);
    resolved.current = cash;
    setPhase('dropping');
    setDrop({ y, safe });
    timers.after(growMs + 120, () => {
      if (!safe) return finish(r, 'bust', 0, y);
      const landed = { ...r, bars, cash };
      if (full) return finish(landed, 'full', cash);
      setRound(landed);
      setDrop(null);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: winChance(bars, r.settings) });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { settings: chosen, stake: bet.value, prize: prizeFor(chosen), bars: [], cash: RTP, outcome: null, bustBar: null };
    setRound(r);
    next(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setDrop(null);
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
      space: () => (phase === 'checkpoint' && round ? next(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const s = round?.settings ?? chosen;
  const bars = round?.bars ?? [];
  const k = bars.length;
  const p0 = headline(chosen);
  const pNow = round?.outcome === 'full' ? 1 : round?.outcome === 'bust' ? 0 : round ? winChance(bars, s) : headline(s);
  const prize = round?.prize ?? prizeFor(chosen);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const safe = k > 0 ? stepSafe(bars, s.either) : 1;
  const dir = nextDir(bars, s.either);
  const dirWord = dir === 'up' ? 'above' : dir === 'down' ? 'below' : 'anywhere';

  let status = `Ready · ${plural(s.n, 'bar')}, ${s.either ? 'either way first' : 'up first'}`;
  if (phase === 'dropping') status = `Bar ${k + 1} of ${s.n} rising`;
  if (phase === 'checkpoint') status = `Checkpoint · ${k} of ${s.n} bars`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${plural(k, 'bar')}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Zigzag"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={volatilityOf(chosen)} />}>Bars to fill</Label>
          <Chips
            label="Bars to fill"
            wrap
            options={LENGTHS.map((v) => ({ value: v, label: v }))}
            value={n}
            disabled={live}
            onChange={(v) => change(() => setN(v))}
          />

          <Label hint="either way doubles the chance">First turn</Label>
          <Chips
            label="First turn"
            options={[
              { value: 'up' as First, label: 'Up first' },
              { value: 'either' as First, label: 'Either way' },
            ]}
            value={first}
            disabled={live}
            onChange={(v) => change(() => setFirst(v))}
          />
          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(p0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(chosen))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && next(round)}>
                {dir === 'either' ? 'Next bar · free' : `Next bar · ${fmtChance(safe)} safe`}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'dropping' ? 'Rising…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            value: fmtChance(pNow),
            sub: live ? `${plural(s.n - k, 'bar')} to go` : phase === 'over' ? `after ${plural(k, 'bar')}` : `${s.n} bars alternate`,
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'after each bar', tone: 'cash' },
          { label: 'Prize', value: fmtMult(prize), sub: formatAmount(stake * prize, 2), tone: 'prize' },
        ]}
      />

      <Board className="zz-board">
        <Field settings={s} bars={bars} drop={drop} growMs={growMs} bustBar={round?.bustBar ?? null} outcome={phase === 'over' ? round?.outcome ?? null : null} live={live} />
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
          p={pNow}
          label="Chance to fill the board"
          note={
            k === 0
              ? 'The first bar can land anywhere. Then each bar must turn the other way.'
              : dir === 'either'
              ? 'The next bar can go either way and sets the pattern. Brighter green marks landings that leave better odds.'
              : `The next bar must land ${dirWord} the last one: the green zone, ${fmtChance(safe)} of the column. Brighter green leaves better odds after.`
          }
        />
      ) : (
        <Caption>
          {plural(chosen.n, 'random bar')} must zigzag {chosen.either ? 'either way first' : 'up first'}. André: that happens{' '}
          {chosen.either ? '2·' : ''}Eₙ/n! = {fmtChance(p0)} of the time. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Zigzag" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Bars of random height (anywhere from 0 to 1, all equally likely) rise one at a time. They must alternate: <b>up, down, up, down</b>. Fill every
              slot and win the prize.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose how many bars fill the board (4 to 12) and whether the first turn must go up or may go either way. Then bet: the first bar rises.</li>
              <li>After each bar you can cash out (C), or raise the next one (Space).</li>
              <li>A bar that goes the wrong way ends the round. Fill the board and the prize pays automatically.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The arrows under the slots show which way each bar must go. In the next slot, the <b style={{ color: 'var(--green)' }}>green zone</b> is where
              the bar must land: above the last bar when an up is due (chance 1 − x), below it when a down is due (chance x). Its height is that bar's
              chance, and the <b style={{ color: 'var(--red)' }}>red</b> part is the risk.
            </p>
            <p>
              Inside the green zone, brighter green means a landing that leaves you better odds afterwards: a high bar makes the next down easy, a low bar
              makes the next up easy. The win chance readout and the bar under the board give the exact chance to fill the whole board from here.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              André's theorem (1879): n random numbers alternate starting with an up with probability <b>Eₙ / n!</b>, where Eₙ are the Euler zigzag numbers
              1, 1, 1, 2, 5, 16, 61, 272, 1385, … the Taylor coefficients of sec x + tan x. For 6 bars that is 61/720 ≈ 8.5%.
            </p>
            <p>
              Mid-round, if the last bar is x, an up is due and m bars are left, the chance is a polynomial uₘ(x) built by uₘ(x) = ∫ₓ¹ uₘ₋₁(1 − y) dy (by
              symmetry a down from x has chance uₘ(1 − x)). These are the Entringer (boustrophedon) polynomials; the game computes them exactly with
              fractions. With "either way" the second bar sets the pattern and cannot bust, which exactly doubles the chance.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is locked when you bet, at {(RTP * 100).toFixed(0)}% ÷ (chance for your settings). Cashing out pays prize × your chance now. The
              recursion above says the chance now is exactly the average of the chance after the next bar, so every bar is a fair bet and the round is worth{' '}
              {(RTP * 100).toFixed(0)}% of your stake whenever you cash out. The settings only trade chance for prize. The largest prize is{' '}
              {fmtMult(MAX_MULTIPLIER)} (12 bars, up first).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
