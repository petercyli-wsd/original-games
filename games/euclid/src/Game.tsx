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
import { useRef, useState } from 'react';
import { PairsView, RectView } from './Board';
import {
  CUTS,
  NO_CLUES,
  RTP,
  SIZES,
  allClues,
  drawPair,
  nodeAt,
  odds,
  offered,
  prize,
  reveal,
  tree,
  winChance,
  type Bet,
  type BetKind,
  type Clues,
  type Cuts,
  type Pair,
  type Size,
} from './math';

const ACCENT = '#ffd6a5';

type Phase = 'idle' | 'cutting' | 'checkpoint' | 'over';
type Outcome = 'won' | 'lost' | 'cashed';

interface Round {
  size: Size;
  bet: Bet;
  stake: number;
  pair: Pair;
  clues: Clues;
  cash: number;
  outcome: Outcome | null;
}

const KIND_LABEL: Record<BetKind, string> = { coprime: 'Coprime', square: 'Square ≥ 2', cuts: 'Long run' };

const betName = (bet: Bet) => (bet.kind === 'cuts' ? `≥ ${bet.cuts} cuts` : KIND_LABEL[bet.kind]);

function outcomeTitle(r: Round): string {
  const { pair, bet } = r;
  if (r.outcome === 'cashed') return 'Cashed out';
  if (bet.kind === 'cuts') return r.outcome === 'won' ? `Long run · ${bet.cuts}+ cuts` : `Only ${pair.q.length} cut${pair.q.length === 1 ? '' : 's'}`;
  if (r.outcome === 'won') return bet.kind === 'coprime' ? 'Coprime' : `Final square ${pair.g}`;
  return bet.kind === 'coprime' ? `Common factor ${pair.g}` : 'Coprime: square 1';
}

function volatilityOf(p: number): Volatility {
  return p > 0.3 ? 'low' : p > 0.1 ? 'medium' : p > 0.02 ? 'high' : 'extreme';
}

/** The largest offered cut target at or below k for this range. */
function clampCuts(size: Size, k: Cuts): Cuts {
  const ok = CUTS.filter((c) => c <= k && offered(size, { kind: 'cuts', cuts: c }));
  return ok[ok.length - 1] ?? CUTS[0];
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [size, setSize] = useState<Size>(100);
  const [kind, setKind] = useState<BetKind>('coprime');
  const [cuts, setCuts] = useState<Cuts>(5);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  /** The clues being animated in (shown on the rectangle before the odds update). */
  const [incoming, setIncoming] = useState<Clues | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const chosen: Bet = { kind, cuts };

  // A cut in flight is decided the moment it starts, so leaving mid-animation
  // settles at its real result, never at the pre-cut value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'cutting' ? resolved.current : round?.cash ?? 0));

  const ms = turbo.turbo ? 180 : 700;
  const live = phase === 'cutting' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setIncoming(null);
    setPhase('over');
  }

  function step(r: Round) {
    const next = reveal(r.pair, r.clues);
    if (!next) return;
    const full = prize(r.size, r.bet);
    const o = odds(r.size, r.bet, next);
    const cash = o.wins === 0 ? 0 : o.wins === o.total ? full : full * o.p;
    resolved.current = cash;
    setIncoming(next);
    setPhase('cutting');
    timers.after(ms, () => {
      const after = { ...r, clues: next, cash };
      if (o.wins === 0) return finish(after, 'lost', 0);
      if (o.wins === o.total) return finish(after, 'won', full);
      setRound(after);
      setIncoming(null);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: o.p });
    });
  }

  async function start() {
    if (live || bet.blocked || !offered(size, chosen)) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { size, bet: chosen, stake: bet.value, pair: drawPair(size, (n) => rng.int(n)), clues: NO_CLUES, cash: RTP, outcome: null };
    setRound(r);
    step(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setIncoming(null);
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
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const s = round?.size ?? size;
  const b = round?.bet ?? chosen;
  const clues = round?.clues ?? NO_CLUES;
  const node = nodeAt(s, clues) ?? tree(s);
  const o = odds(s, b, clues);
  const full = prize(s, b);
  const o0 = odds(s, b);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const over = phase === 'over' && round?.outcome ? round : null;
  const drawn = over ? allClues(over.pair) : (incoming ?? clues);
  const j = clues.quotients.length;

  const p0 = winChance(size, chosen);
  const vol = volatilityOf(p0);
  const maxCuts = tree(s).byLength.length - 1;

  let status = `Ready · ${betName(b)} · pairs up to ${s}`;
  if (phase === 'cutting') status = incoming?.scale != null ? 'Revealing the scale' : `Cutting · cut ${incoming?.quotients.length ?? j + 1}`;
  if (phase === 'checkpoint') status = clues.done ? 'Checkpoint · run finished, scale hidden' : `Checkpoint · ${j} cut${j === 1 ? '' : 's'}`;
  if (over) status = `${outcomeTitle(over)} · ${over.pair.a} / ${over.pair.b}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const nextLabel = clues.done ? 'Reveal the scale' : `Cut ${j + 1}`;
  const kindHint =
    b.kind === 'coprime' ? 'Coprime: gcd = 1' : b.kind === 'square' ? 'Square: gcd ≥ 2' : `Long run: ${b.cuts}+ cuts`;

  return (
    <GameLayout
      name="Euclid"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Your call</Label>
          <Chips
            label="Your call"
            options={(['coprime', 'square', 'cuts'] as const).map((v) => ({ value: v, label: KIND_LABEL[v] }))}
            value={kind}
            disabled={live}
            onChange={(v) => change(() => setKind(v))}
          />

          {kind === 'cuts' && (
            <>
              <Label hint="Euclid steps">Cuts at least</Label>
              <Chips
                label="Cuts at least"
                options={CUTS.map((v) => ({
                  value: v,
                  label: v,
                  disabled: !offered(size, { kind: 'cuts', cuts: v }),
                  title: offered(size, { kind: 'cuts', cuts: v }) ? undefined : `Too rare for pairs up to ${size}`,
                }))}
                value={cuts}
                disabled={live}
                onChange={(v) => change(() => setCuts(v))}
              />
            </>
          )}

          <Label hint="1 ≤ b < a ≤ N">Pairs up to N</Label>
          <Chips
            label="Pairs up to N"
            options={SIZES.map((v) => ({ value: v, label: v }))}
            value={size}
            disabled={live}
            onChange={(v) =>
              change(() => {
                setSize(v);
                setCuts((c) => clampCuts(v, c));
              })
            }
          />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(p0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prize(size, chosen))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && step(round)}>
                {nextLabel}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'cutting' ? 'Cutting…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            value: fmtChance(over ? (over.outcome === 'lost' ? 0 : over.outcome === 'won' ? 1 : o.p) : o.p),
            sub: `${o.wins.toLocaleString('en-US')} of ${o.total.toLocaleString('en-US')} pairs`,
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || over ? fmtMult(cash) : '—', sub: formatAmount(stake * cash, 2), tone: 'cash' },
          { label: 'Full win', value: fmtMult(full), sub: kindHint, tone: 'prize' },
        ]}
      />

      <Board className="eu-board">
        <div className="eu-views">
          <RectView
            quotients={drawn.quotients}
            done={drawn.done}
            revealed={over ? clues.quotients.length : drawn.quotients.length}
            scale={drawn.scale}
            pair={over ? over.pair : null}
            size={s}
            zoomAll={!!over || drawn.done || drawn.quotients.length === 0}
            fresh={phase === 'cutting' && incoming && incoming.scale === null ? incoming.quotients.length - 1 : null}
            ms={ms}
          />
          <PairsView size={s} bet={b} clues={clues} candidates={node.pairs} winners={o.wins} pair={over ? over.pair : null} />
        </div>
        {over && (
          <RoundOver
            key={history[0]?.id}
            title={outcomeTitle(over)}
            multiplier={over.cash}
            stake={over.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement="bottom"
          />
        )}
      </Board>

      {live ? (
        <ChanceBar p={o.p} label="Win chance: green share of the lit pairs" note="Lit pairs are every (b, a) that fits the cuts so far; the hidden pair is equally likely to be any of them." />
      ) : (
        <Caption>
          {b.kind === 'coprime'
            ? `${o0.wins.toLocaleString('en-US')} of the ${o0.total.toLocaleString('en-US')} pairs up to ${s} are coprime (${fmtChance(o0.p)}); as N grows this tends to 6/π² ≈ 60.8%.`
            : b.kind === 'square'
              ? `${o0.wins.toLocaleString('en-US')} of the ${o0.total.toLocaleString('en-US')} pairs up to ${s} share a factor (${fmtChance(o0.p)}); the limit is 1 − 6/π² ≈ 39.2%.`
              : `${o0.wins.toLocaleString('en-US')} of the ${o0.total.toLocaleString('en-US')} pairs up to ${s} need ${b.cuts}+ cuts (${fmtChance(o0.p)}). Lamé: none needs more than ${maxCuts}.`}{' '}
          RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Euclid" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A hidden pair of whole numbers 1 ≤ b &lt; a ≤ N is an a × b rectangle under fog. Euclid's algorithm cuts it into squares. Call how it ends: the last
              square is 1 × 1 (<b>Coprime</b>), the last square is 2 × 2 or bigger (<b>Square ≥ 2</b>), or the algorithm takes at least k cuts (<b>Long run</b>).
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick your call and the range N, then bet. The first cut is made straight away.</li>
              <li>Each cut removes as many squares of the short side as fit, and shows how many (the next quotient). Cash out, or make the next cut (Space).</li>
              <li>When the rectangle is used up, the shape is known but not its size: the last reveal is the side of the final square.</li>
              <li>The round pays out as soon as your call is certain, and ends as soon as it is impossible.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The triangle on the right has a dot for every pair (b, a). Lit dots are the pairs that would give exactly the cuts you have seen; the hidden pair is
              equally likely to be any of them. <b style={{ color: 'var(--green)' }}>Green</b> dots win, <b style={{ color: 'var(--red)' }}>red</b> dots lose,
              so your chance is green ÷ lit. Each cut fixes a/b to a narrower wedge of slopes between two rays; a finished run leaves one ray, whose dots are
              the multiples (gP, gQ).
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Euclid's algorithm: a = q₁b + r₁, b = q₂r₁ + r₂, … until the remainder is 0. The quotients are the continued fraction a/b = [q₁; q₂, …, qₙ] and the
              last square has side gcd(a, b). Two random integers are coprime with probability 1/ζ(2) = 6/π² ≈ 0.608. The number of cuts averages about
              (12 ln 2 / π²) ln N, and Lamé's theorem caps it: the longest runs come from neighbouring Fibonacci numbers.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A full win pays {(RTP * 100).toFixed(0)}% ÷ (starting chance). Cashing out pays the full prize × your live chance (green ÷ lit), counted exactly
              over every pair. Each cut is a fair bet on average, so the round is worth {(RTP * 100).toFixed(0)}% of your stake however and whenever you cash
              out.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
