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
import RootsBoard, { Steps, fmtRange, type Anim } from './Board';
import {
  HIDDEN,
  RANGES,
  RTP,
  SIDE_LABEL,
  cashOut,
  draw,
  isReal,
  pWin,
  prize,
  stageOf,
  volatilityOf,
  type Coeffs,
  type Range,
  type Side,
  type Stage,
} from './math';

type Phase = 'idle' | 'revealing' | 'checkpoint' | 'over';
type Outcome = 'won' | 'lost' | 'cashed';

interface Round {
  side: Side;
  range: Range;
  stake: number;
  k: Coeffs;
  cash: number;
  outcome: Outcome | null;
  /** The c reveal already settled the bet (b is still shown, for the picture). */
  early: boolean;
}

/** Reveal times in ms (turbo runs them at a quarter). */
const MS = { a: 1000, c: 900, b: 1300 };
const COEF: Record<Stage, string> = { 0: 'a', 1: 'c', 2: 'b', 3: 'b' };

const upTo = (k: Coeffs, stage: Stage): Coeffs => ({
  a: stage >= 1 ? k.a : null,
  c: stage >= 2 ? k.c : null,
  b: stage >= 3 ? k.b : null,
});

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [side, setSide] = useState<Side>('real');
  const [range, setRange] = useState<Range>(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [anim, setAnim] = useState<Anim>({ from: 0, to: 0, key: 0, ms: 0 });
  const [infoOpen, setInfoOpen] = useState(false);

  // The open bet's fair value. A reveal is decided the moment it starts, so
  // this jumps to the revealed result straight away: leaving mid-animation
  // settles at the real outcome, never at the pre-reveal value.
  const fair = useRef(0);
  const ticket = useTicket(() => fair.current);

  const live = phase === 'revealing' || phase === 'checkpoint';
  const dur = (ms: number) => Math.round(turbo.turbo ? ms * 0.25 : ms);

  function animate(from: Stage, to: Stage, ms: number) {
    setAnim((a) => ({ from, to, ms, key: a.key + 1 }));
  }

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  function checkpoint(r: Round) {
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: r.cash, winChance: pWin(r.side, r.k, r.range) });
  }

  /** Reveals b. `forced` is the already-settled result when c decided the bet. */
  function revealB(r: Round, forced: boolean | null = null) {
    const b = draw(rng.next(), r.range);
    const k = { ...r.k, b };
    const real = isReal(k.a!, b, k.c!);
    const win = forced ?? (r.side === 'real' ? real : !real);
    const cash = win ? prize(r.side, r.range) : 0;
    fair.current = cash;
    const next = { ...r, k, cash, early: forced !== null };
    setRound(next);
    setPhase('revealing');
    const ms = dur(forced !== null ? MS.b * 0.7 : MS.b);
    animate(2, 3, ms);
    timers.after(ms + 60, () => finish(next, win ? 'won' : 'lost', cash));
  }

  function revealC(r: Round) {
    const c = draw(rng.next(), 1);
    const k = { ...r.k, c };
    const p = pWin(r.side, k, r.range);
    const cash = cashOut(r.side, k, r.range);
    fair.current = cash;
    const next = { ...r, k, cash };
    setRound(next);
    setPhase('revealing');
    const ms = dur(MS.c);
    animate(1, 2, ms);
    timers.after(ms + 60, () => {
      // Certain either way: no step is offered, b just completes the picture.
      if (p === 0 || p === 1) return revealB(next, p === 1);
      checkpoint(next);
    });
  }

  function next() {
    if (phase !== 'checkpoint' || !round) return;
    if (stageOf(round.k) === 1) revealC(round);
    else revealB(round);
  }

  async function start() {
    if (live || bet.blocked) return;
    // a is drawn first; the bet then opens already worth its post-reveal value.
    const k: Coeffs = { a: draw(rng.next(), 1), c: null, b: null };
    const cash = cashOut(side, k, range);
    fair.current = cash;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { side, range, stake: bet.value, k, cash, outcome: null, early: false };
    setRound(r);
    setPhase('revealing');
    const ms = dur(MS.a);
    animate(0, 1, ms);
    timers.after(ms + 60, () => checkpoint(r));
  }

  function cashOutNow() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setPhase('idle');
    animate(0, 0, 0);
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys({ space: () => (phase === 'checkpoint' ? next() : !live ? void start() : undefined), cashOut: cashOutNow }, !infoOpen);

  // What the board shows: the live or finished round, else a preview of the settings.
  const s = round?.side ?? side;
  const B = round?.range ?? range;
  const stake = round?.stake ?? bet.value;
  // Mid-reveal, the numbers still describe the state before the reveal.
  const shown = round ? (phase === 'revealing' ? upTo(round.k, anim.from) : round.k) : HIDDEN;
  const stage = stageOf(shown);
  const pNow = pWin(s, shown, B);
  const full = prize(s, B);
  const cashNow = round ? (phase === 'revealing' ? full * pNow : round.cash) : RTP;
  const vol = volatilityOf(side, range);
  const sideWord = SIDE_LABEL[s].toLowerCase();

  const final = round && round.k.b !== null ? isReal(round.k.a!, round.k.b, round.k.c!) : null;
  // The chance after each reveal so far, for the progress strip.
  const chances: (number | null)[] = [0, 1, 2, 3].map((i) => (i <= stage ? pWin(s, upTo(shown, i as Stage), B) : null));
  const won = round?.outcome && round.outcome !== 'cashed' && final !== null ? (s === 'real' ? final : !final) : null;

  let status = `Ready · ${SIDE_LABEL[side]} · b on ±${fmtRange(range)}`;
  if (phase === 'revealing') status = `Revealing ${COEF[anim.from]}`;
  if (phase === 'checkpoint') status = stage === 1 ? 'Checkpoint 1 of 2 · a is known' : 'Checkpoint 2 of 2 · a and c are known';
  let title = 'Cashed out';
  if (round?.outcome && round.outcome !== 'cashed') title = final ? 'Crossed the line · real roots' : 'Missed the line · no real roots';
  if (phase === 'over') status = round?.early ? `${title} · settled by c` : title;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  let note = 'Every point of the box is equally likely: the green share is your chance.';
  if (stage === 1) note = 'Green share of the box. c will pick one row of it: the b-ruler.';
  if (stage === 2) note = 'Green share of the b-ruler. b lands uniformly on it.';

  const winCond = s === 'real' ? 'b² ≥ 4ac' : 'b² < 4ac';
  const nextLabel = stage === 1 ? 'Reveal c' : 'Reveal b';

  return (
    <GameLayout
      name="Roots"
      accent="#c77dff"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Back</Label>
          <Chips
            label="Back real roots or no real roots"
            options={[
              { value: 'real', label: 'Real roots', title: 'The curve crosses the line: b² ≥ 4ac' },
              { value: 'none', label: 'No real roots', title: 'The curve misses the line: b² < 4ac' },
            ]}
            value={side}
            disabled={live}
            onChange={(v) => change(() => setSide(v as Side))}
          />

          <Label hint="b is uniform on ±B">Range of b</Label>
          <Chips
            label="Range of b"
            options={RANGES.map((v) => ({ value: v, label: fmtRange(v), title: `b uniform on −${v} … ${v}` }))}
            value={range}
            disabled={live}
            onChange={(v) => change(() => setRange(v as Range))}
          />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(pWin(side, HIDDEN, range))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prize(side, range))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOutNow}>
                Cash out <span>{formatAmount(stake * cashNow, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={next}>
                {nextLabel}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'revealing' ? `Revealing ${COEF[anim.from]}…` : phase === 'over' ? 'Bet again' : 'Bet'}
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
            value: phase === 'over' && round?.outcome !== 'cashed' ? (won ? '100%' : '0%') : fmtChance(pNow),
            sub: live ? 'the green share' : `if ${winCond}`,
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cashNow) : '—', sub: formatAmount(stake * cashNow, 2), tone: 'cash' },
          { label: 'Prize', value: fmtMult(full), sub: `if ${sideWord}`, tone: 'prize' },
        ]}
      />

      <Board className="roots-stage">
        <RootsBoard side={s} range={B} k={round?.k ?? HIDDEN} anim={anim} won={won} />
        {phase === 'over' && round?.outcome ? (
          <RoundOver
            key={history[0]?.id}
            title={title}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement="inline"
          />
        ) : (
          <Steps chances={chances} stage={stage} busy={phase === 'revealing'} />
        )}
      </Board>

      {live ? (
        <ChanceBar p={pNow} label={`Chance of ${sideWord}`} note={note} />
      ) : (
        <Caption>
          Back {sideWord}: the curve must {s === 'real' ? 'cross' : 'miss'} the line y = 0 ({winCond}). With a, c on ±1 and b on ±{fmtRange(B)} that happens{' '}
          {fmtChance(pWin(s, HIDDEN, B))} of the time
          {B === 1 ? (s === 'real' ? ' — (41 + 6 ln 2)/72' : ' — (31 − 6 ln 2)/72') : ''}. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Roots" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A random parabola y = ax² + bx + c is built one coefficient at a time. Back <b>real roots</b> (the curve crosses the line y = 0) or{' '}
              <b>no real roots</b> (it misses the line).
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a side and the range of b, then bet. a is revealed straight away (uniform on −1 … 1).</li>
              <li>Checkpoint 1: cash out, or reveal c (also uniform on −1 … 1).</li>
              <li>Checkpoint 2: cash out, or reveal b (uniform on −B … B). The curve is then complete and the bet settles.</li>
              <li>If a and c have opposite signs, the curve must cross the line, so the bet settles at once and b is shown just to finish the picture.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The right-hand box plots b across and a·c up. The curve b² = 4ac is a fixed cup: inside it the quadratic has no real roots, outside it has
              real roots. Every point of the box is equally likely, so the <b style={{ color: 'var(--green)' }}>green share</b> is exactly your chance and
              the <b style={{ color: 'var(--red)' }}>red share</b> is the risk.
            </p>
            <p>
              Before a, the rows are stretched so equal heights are equally likely (a·c bunches near 0). Revealing a narrows the box to a·c in ±|a| and
              zooms in. Revealing c picks a single row: the b-ruler, where only |b| &lt; 2√(ac) misses the line. Revealing b drops a point on it.
            </p>
            <p>On the curve, b slides the turning point along the dotted track; where that track is on the curve's own side of the line, the curve misses.</p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              A quadratic has real roots exactly when its discriminant b² − 4ac ≥ 0. With a, c uniform on ±1 and b on ±B:
            </p>
            <ul>
              <li>after a and c: P(real) = 1 if ac ≤ 0, else max(0, 1 − 2√(ac)/B);</li>
              <li>after a: P(real) = 1 − 2√|a|/(3B) when |a| ≤ B²/4, else ½ + B²/(24|a|);</li>
              <li>
                before a: P(real) = ½ + ½∫₀<sup>T</sup>(1 − 2√t/B)(−ln t) dt with T = min(1, B²/4). For B = 1 this is the classic (41 + 6 ln 2)/72 ≈
                62.7%; for B ≥ 2 it is 1 − 4/(9B).
              </li>
            </ul>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays {(RTP * 100).toFixed(0)}% ÷ P(your side) (from {fmtMult(prize('real', 32))} to {fmtMult(prize('none', 32))}). Cashing out pays
              that prize × your chance right now. Each reveal leaves the expected chance unchanged, so every cash-out is a fair price and the round is worth{' '}
              {(RTP * 100).toFixed(0)}% of your stake however and whenever you cash out.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
