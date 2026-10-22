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
import Field, { type Flight } from './Board';
import {
  BETS,
  BET_LABEL,
  BET_PHRASE,
  BET_RULE,
  COUNTS,
  RTP,
  SIZES,
  cashOut,
  chanceOf,
  factorLabel,
  litCount,
  litRows,
  liveChance,
  maxCount,
  nextStep,
  primeFactors,
  prizeOf,
  reveal,
  targetChance,
  volatilityOf,
  winChance,
  type Bet,
  type Count,
  type Settings,
  type Size,
  type Target,
} from './math';

const ACCENT = '#b5e48c';

type Phase = 'idle' | 'revealing' | 'checkpoint' | 'over';
type Outcome = 'lost' | 'cashed' | 'full';

interface Round {
  s: Settings;
  stake: number;
  targets: Target[];
  cash: number;
  outcome: Outcome | null;
}

function outcomeTitle(outcome: Outcome, bet: Bet) {
  if (outcome === 'cashed') return 'Cashed out';
  if (outcome === 'full') return bet === 'sight' ? 'All in sight' : bet === 'shadow' ? 'All in shadow' : 'All in deep shadow';
  return bet === 'sight' ? 'View blocked' : bet === 'shadow' ? 'Caught in sight' : 'Not deep enough';
}

const CHIP_LABEL: Record<Bet, string> = { sight: 'Sight', shadow: 'Shadow', deep: 'Deep' };
/** The share of a big orchard each bet keeps: 6/π², 1 − 6/π², 1 − (1 + ¼)·6/π². */
const LIMIT: Record<Bet, string> = { sight: '6/π² ≈ 60.8%', shadow: '1 − 6/π² ≈ 39.2%', deep: '1 − 7.5/π² ≈ 24.0%' };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [side, setSide] = useState<Bet>('sight');
  const [count, setCount] = useState<Count>(3);
  const [size, setSize] = useState<Size>(20);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // The reveal in flight is decided when it starts, so leaving mid-animation
  // settles at its real result, never at the pre-reveal value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'revealing' ? resolved.current : round?.cash ?? 0));

  const k = turbo.turbo ? 0.25 : 1;
  const colMs = Math.round(720 * k);
  const rowMs = Math.round(620 * k);
  const lineMs = Math.round(560 * k);
  const live = phase === 'revealing' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setFlight(null);
    setPhase('over');
  }

  function step(r: Round) {
    const st = nextStep(r.s, r.targets);
    if (!st) return;
    const N = r.s.size;
    const value = 1 + rng.int(N);
    const targets = reveal(r.s, r.targets, value);
    const cash = cashOut(r.s, targets);
    resolved.current = cash;
    const from = value <= N / 2 ? N : 1;
    const ms = st.kind === 'column' ? colMs : rowMs;
    setPhase('revealing');
    setFlight({ kind: st.kind, index: st.index, value, from, ms, key: ++seq.current, landed: false });

    const commit = () => {
      const next = { ...r, targets, cash };
      const p = liveChance(r.s, targets);
      if (p === 0) return finish(next, 'lost', 0);
      if (!nextStep(r.s, targets)) return finish(next, 'full', cash);
      setRound(next);
      setFlight(null);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: p });
    };
    if (st.kind === 'column') timers.after(colMs, commit);
    else
      timers.after(rowMs, () => {
        setFlight((f) => f && { ...f, landed: true });
        timers.after(lineMs, commit);
      });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { s: { bet: side, size, count }, stake: bet.value, targets: [], cash: RTP, outcome: null };
    setRound(r);
    step(r);
  }

  function cash() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setFlight(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? step(round) : !live ? void start() : undefined),
      cashOut: cash,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const chosen: Settings = { bet: side, size, count };
  const s = round?.s ?? chosen;
  const N = s.size;
  const targets = round?.targets ?? [];
  const phrase = BET_PHRASE[s.bet];
  const p = liveChance(s, targets);
  const p0 = winChance(s);
  const prize = prizeOf(s);
  const value = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const next = nextStep(s, targets);
  const idx = next?.index ?? Math.max(0, targets.length - 1);
  const cur = targets[idx];
  const curChance = chanceOf(s, cur);
  const cleared = targets.filter((t) => t.b != null && chanceOf(s, t) === 1).length;
  const orchardLit = litCount(s.bet, N);

  let status = `Ready · ${plural(s.count, 'target')} · ${N}×${N} orchard`;
  if (phase === 'revealing' && flight) status = `Scanning ${flight.kind} · target ${flight.index + 1} of ${s.count}`;
  if (phase === 'checkpoint') status = `Checkpoint · target ${idx + 1} of ${s.count}`;
  if (phase === 'over' && round?.outcome) status = `${outcomeTitle(round.outcome, s.bet)} · ${cleared} of ${s.count}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  // Under the board: what the next reveal is drawn from.
  let note: string;
  if (next?.kind === 'row' && cur?.a != null) {
    const a = cur.a;
    const lit = litRows(s.bet, a, N);
    const ps = primeFactors(a);
    const hidden = ps.length === 1 ? `multiples of ${ps[0]}` : `rows divisible by ${ps.slice(0, -1).join(', ')} or ${ps[ps.length - 1]}`;
    if (a === 1) note = `Column 1: nothing stands in the way, so every row is in sight.`;
    else if (s.bet === 'deep')
      note =
        a === 2
          ? `Column 2: at most one tree, (1, 1), can block a row here, so no row is in deep shadow.`
          : `${factorLabel(a)}: ${lit} of ${N} rows share a factor of 3 or more with ${a} (gcd ≥ 3), so 2+ trees block them.`;
    else note = `${factorLabel(a)}, so the ${hidden} are hidden behind nearer trees: ${lit} of ${N} rows are ${phrase}.`;
  } else {
    note = `Target ${idx + 1}'s column comes next. ${orchardLit} of ${N * N} trees are ${phrase}.`;
  }

  // Keep the end-of-round card clear of the last target.
  const last = round ? [...round.targets].reverse().find((t) => t.a != null) : undefined;
  const placement = last?.b != null && last.b <= N / 2 ? 'top' : 'bottom';

  const continueLabel =
    next?.kind === 'row' ? `Reveal row · ${fmtChance(curChance)} lit` : `Reveal column · target ${idx + 1}`;

  return (
    <GameLayout
      name="Line of Sight"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={`${BET_RULE[side]} · ${fmtChance(targetChance(side, size))} of trees`}>Bet on</Label>
          <Chips
            label="Bet on"
            options={BETS.map((v) => ({ value: v, label: CHIP_LABEL[v], title: `${BET_LABEL[v]}: ${BET_RULE[v]}` }))}
            value={side}
            disabled={live}
            onChange={(v) =>
              change(() => {
                setSide(v);
                if (count > maxCount(v)) setCount(maxCount(v));
              })
            }
          />

          <Label hint={<VolBadge level={volatilityOf(chosen)} />}>Targets</Label>
          <Chips
            label="Targets"
            options={COUNTS.map((v) => ({
              value: v,
              label: v,
              disabled: v > maxCount(side),
              title: v > maxCount(side) ? `${BET_LABEL[side]} allows up to ${maxCount(side)} targets` : undefined,
            }))}
            value={count}
            disabled={live}
            onChange={(v) => change(() => setCount(v))}
          />

          <Label hint={`${size * size} trees`}>Orchard</Label>
          <Chips
            label="Orchard size"
            options={SIZES.map((v) => ({ value: v, label: `${v}×${v}` }))}
            value={size}
            disabled={live}
            onChange={(v) => change(() => setSize(v))}
          />

          <dl className="og-stats">
            <dt>Per target</dt>
            <dd>{fmtChance(targetChance(side, size))}</dd>
            <dt>Chance to win</dt>
            <dd>{fmtChance(winChance(chosen))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeOf(chosen))}</dd>
          </dl>

          {phase === 'checkpoint' && round ? (
            <>
              <ActionButton kind="cash" onClick={cash}>
                Cash out <span>{formatAmount(stake * value, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => step(round)}>
                {continueLabel}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'revealing' ? 'Scanning…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            value: fmtChance(round ? p : p0),
            sub: round ? `${cleared} of ${s.count} cleared` : `${fmtChance(targetChance(s.bet, N))} per target`,
            tone: 'chance',
          },
          { label: 'Cash out now', value: round ? fmtMult(value) : '—', sub: formatAmount(stake * value, 2), tone: 'cash' },
          { label: 'Prize', value: fmtMult(prize), sub: s.count === 1 ? `target ${phrase}` : `all ${s.count} ${phrase}`, tone: 'prize' },
        ]}
      />

      <Board>
        <Field settings={s} targets={targets} flight={flight} lineMs={lineMs} over={phase === 'over'} />
        {phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={outcomeTitle(round.outcome, s.bet)}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement={placement}
          />
        )}
      </Board>

      {live ? (
        <ChanceBar p={curChance} label={`Target ${idx + 1} ${phrase}`} note={note} />
      ) : (
        <Caption>
          A tree is in sight when no other tree stands on the line from your corner: gcd(a, b) = 1. Here {orchardLit} of {N * N} trees are {phrase}{' '}
          ({fmtChance(orchardLit / (N * N))}); in any big orchard that share tends to {LIMIT[s.bet]}. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Line of Sight" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              You stand at the bottom-left corner of an orchard with a tree at every grid point (a, b). Random target trees are picked one after another. Back{' '}
              <b>Sight</b> and every target must be visible from your corner; back <b>Shadow</b> and every target must be hidden behind a nearer tree;
              back <b>Deep</b> (deep shadow) and every target must have at least two trees in the way (up to 3 targets).
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose what to back, how many targets (1 to 8) and the orchard size, then bet.</li>
              <li>Each target is revealed in two steps: first its column, then its row (Space).</li>
              <li>After every step you can cash out (C) or carry on. A target on the wrong side ends the round; clear every target and the prize pays.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Bright dots are the trees that win your bet. When a column lights up, its <b style={{ color: 'var(--green)' }}>green</b> dots are the rows that
              win and the <b style={{ color: 'var(--red)' }}>red</b> ones lose, so "13 of 20" is exactly this target's chance. Before a column is drawn, the
              chance is the bright share of the whole orchard.
            </p>
            <p>
              The pies along the top are the targets: each green slice is that target's chance, and your win chance is all of them multiplied together.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The trees on the line from (0, 0) to (a, b) are the points k·(a/g, b/g) with g = gcd(a, b), so a tree is in sight exactly when gcd(a, b) = 1,
              and a hidden tree has g − 1 trees in the way. By Möbius inversion the orchard holds Σ μ(d)⌊N/d⌋² visible trees, and their share tends to
              6/π² = 1/ζ(2) ≈ 60.8%, the chance that two random whole numbers are coprime (Euler's Basel problem in disguise).
            </p>
            <p>
              In column a, the hidden rows are the multiples of a's prime factors: column 12 = 2²·3 hides every 2nd and 3rd row. Column 1 hides nothing, and a
              prime column p hides only every p-th row.
            </p>
            <p>
              Exactly V(⌊N/g⌋) trees have gcd g (shrink them by g to get a visible tree), so the trees with gcd 2 are a quarter as common as the visible ones.
              Deep shadow (gcd ≥ 3) keeps 1 − (1 + ¼)·6/π² ≈ 24% of a big orchard; columns 1 and 2 hold none.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A full win pays prize = {(RTP * 100).toFixed(0)}% ÷ P(win), fixed when you bet. Cash-out is always prize × P(win | what you have seen), and
              every reveal splits the chance into equally likely columns or rows whose average is the chance before. So each step is a fair bet, and the
              round returns {(RTP * 100).toFixed(0)}% of your stake whenever you cash out.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
