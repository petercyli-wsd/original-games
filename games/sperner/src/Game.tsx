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
import { useMemo, useRef, useState } from 'react';
import Triangle from './Board';
import Odds from './Odds';
import {
  BETS,
  RTP,
  SIZES,
  betPhrase,
  betShort,
  chances,
  countColumns,
  decided,
  finalDistribution,
  freshColours,
  geometry,
  isOffered,
  nearestBet,
  nextSwing,
  nextVertex,
  paint,
  prizeFor,
  rainbows,
  rowRest,
  startChance,
  volatilityOf,
  type Bet,
  type Size,
} from './math';

type Phase = 'idle' | 'colouring' | 'checkpoint' | 'over';
type Outcome = 'won' | 'lost' | 'cashed';

interface Round {
  size: Size;
  bet: Bet;
  stake: number;
  prize: number;
  /** The true colours so far (the board catches up as the animation lands). */
  colours: number[];
  cash: number;
  outcome: Outcome | null;
  title: string;
}

const ACCENT = '#ff4fa3';
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** The headline for a finished round. */
function resultTitle(r: Round, colours: number[], outcome: Outcome): string {
  if (outcome === 'cashed') return 'Cashed out';
  const found = rainbows(r.size, colours).length;
  const full = nextVertex(r.size, colours) === null;
  if (outcome === 'won') {
    if (full) return r.bet === 1 ? 'One lone rainbow' : `${found} rainbows`;
    if (r.bet === 1) return 'No more rainbows can form';
    if (found >= r.bet) return `${found} rainbows found`;
    if (found === r.bet - 1) return `Parity forces a ${ordinal(r.bet)}`;
    return `${r.bet} rainbows guaranteed`;
  }
  if (r.bet === 1) return found === 2 ? 'Two rainbows force a third' : found > 2 ? `${found} rainbows` : 'More rainbows guaranteed';
  if (full) return `Only ${plural(found, 'rainbow')}`;
  return `${r.bet} rainbows out of reach`;
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [size, setSize] = useState<Size>(4);
  const [target, setTarget] = useState<Bet>(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [shown, setShown] = useState<number[] | null>(null);
  const [spinning, setSpinning] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // The open bet's fair value. A reveal is decided the moment it starts and
  // this is updated right then, so leaving mid-animation settles at the real
  // result, never at the pre-reveal value.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  const speed = turbo.turbo ? 0.25 : 1;
  const live = phase === 'colouring' || phase === 'checkpoint';

  function finish(r: Round, colours: number[], outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, colours, cash, outcome, title: resultTitle(r, colours, outcome) });
    setShown(colours);
    setSpinning(null);
    setPhase('over');
  }

  /** Colours the given vertices one after another (a burst stops once the bet is decided). */
  function colour(r: Round, targets: number[]) {
    let colours = r.colours;
    const seq: [number, number][] = [];
    let ch = chances(r.size, r.bet, colours);
    for (const v of targets) {
      const allowed = geometry(r.size).vertices[v].allowed;
      const c = allowed[rng.int(allowed.length)];
      colours = paint(colours, v, c);
      seq.push([v, c]);
      ch = chances(r.size, r.bet, colours);
      if (decided(ch)) break;
    }
    const d = decided(ch);
    const cash = d === 'won' ? r.prize : d === 'lost' ? 0 : r.prize * ch.p;
    resolved.current = cash;
    setPhase('colouring');

    const burst = seq.length > 1;
    const spinMs = (burst ? 300 : 460) * speed;
    const gapMs = 50 * speed;
    const settleMs = 180 * speed;
    const step = (k: number, before: number[]) => {
      setSpinning(seq[k][0]);
      timers.after(spinMs, () => {
        const after = paint(before, seq[k][0], seq[k][1]);
        setShown(after);
        setSpinning(null);
        if (k + 1 < seq.length) return timers.after(gapMs, () => step(k + 1, after));
        timers.after(settleMs, () => {
          const next = { ...r, colours, cash };
          if (d) return finish(next, colours, d, cash);
          setRound(next);
          setPhase('checkpoint');
          track({ type: 'checkpoint', multiplier: cash, winChance: ch.p });
        });
      });
    };
    step(0, r.colours);
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const colours = freshColours(size);
    const r: Round = { size, bet: target, stake: bet.value, prize: prizeFor(size, target), colours, cash: RTP, outcome: null, title: '' };
    resolved.current = RTP;
    setRound(r);
    setShown(colours);
    colour(r, [nextVertex(size, colours)!]);
  }

  function colourNext() {
    if (phase !== 'checkpoint' || !round) return;
    const v = nextVertex(round.size, round.colours);
    if (v !== null) colour(round, [v]);
  }

  function colourRow() {
    if (phase !== 'checkpoint' || !round) return;
    const rest = rowRest(round.size, round.colours);
    if (rest.length) colour(round, rest);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, round.colours, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setShown(null);
    setSpinning(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' ? colourNext() : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const m = round?.size ?? size;
  const b = round?.bet ?? target;
  const blank = useMemo(() => freshColours(m), [m]);
  const colours = shown ?? blank;
  const truth = round?.colours ?? colours;
  const prize = round?.prize ?? prizeFor(size, target);
  const stake = round?.stake ?? bet.value;
  const p0 = startChance(size, target);
  const vol = volatilityOf(p0);
  const total = geometry(m).order.length;
  const coloured = geometry(m).order.filter((v) => colours[v] >= 0).length;

  // The odds drawn are those of the board as shown, so they move as each vertex lands.
  const dist = useMemo(() => finalDistribution(m, colours), [m, colours]);
  const columns = countColumns(m, b, dist);
  const pShown = chances(m, b, colours).p;
  // While live, the cash-out follows the board as shown (it equals the round's value at every checkpoint).
  const cash = live ? prize * pShown : (round?.cash ?? RTP);
  const found = rainbows(m, colours).length;
  const swing = phase === 'checkpoint' ? nextSwing(m, b, truth)?.options ?? null : null;
  const rest = phase === 'checkpoint' && round ? rowRest(m, round.colours).length : 0;
  const nextV = phase === 'checkpoint' ? nextVertex(m, truth) : null;
  const bandRow = live ? (spinning !== null ? geometry(m).vertices[spinning].i : nextV !== null ? geometry(m).vertices[nextV].i : null) : null;

  let status = `Ready · ${m * m} triangles · ${b === 1 ? 'exactly 1 rainbow' : `${b}+ rainbows`}`;
  if (phase === 'colouring') status = `Colouring vertex ${Math.min(total, coloured + 1)} of ${total}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${coloured} of ${total} coloured`;
  if (phase === 'over' && round) status = round.title;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Sperner"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Small triangles</Label>
          <Chips
            label="Small triangles"
            options={SIZES.map((v) => ({ value: v, label: `${v * v}`, title: `Sides cut into ${v}` }))}
            value={size}
            disabled={live}
            onChange={(v) =>
              change(() => {
                setSize(v);
                setTarget((t) => nearestBet(v, t));
              })
            }
          />

          <Label hint="exactly 1, or at least k">Rainbows</Label>
          <Chips
            label="Rainbows to bet on"
            options={BETS.map((v) => ({
              value: v,
              label: betShort(v),
              disabled: !isOffered(size, v),
              title: isOffered(size, v) ? `${betPhrase(v)}: ${fmtChance(startChance(size, v))}` : 'Not offered on this grid',
            }))}
            value={target}
            disabled={live}
            onChange={(v) => change(() => setTarget(v))}
          />
          <dl className="og-stats">
            <dt>You win with</dt>
            <dd>{target === 1 ? 'exactly 1' : `${target} or more`}</dd>
            <dt>Chance to win</dt>
            <dd>{fmtChance(p0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(size, target))}</dd>
          </dl>

          {live ? (
            <>
              <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <div className={'sp-actions' + (rest > 1 || phase !== 'checkpoint' ? '' : ' one')}>
                <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={colourNext}>
                  Colour next
                </ActionButton>
                {(rest > 1 || phase !== 'checkpoint') && (
                  <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={colourRow}>
                    Colour row{rest > 1 ? ` ×${rest}` : ''}
                  </ActionButton>
                )}
              </div>
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
            label: 'Win chance',
            value: fmtChance(live || phase === 'over' ? pShown : p0),
            sub: live || phase === 'over' ? plural(found, 'rainbow') + ' found' : 'before any colour',
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: formatAmount(stake * cash, 2), tone: 'cash' },
          { label: 'Prize', value: fmtMult(prize), sub: `if ${betPhrase(b)}`, tone: 'prize' },
        ]}
      />

      <Board className="sp-board">
        <div className="sp-wrap">
          <div className="sp-grid">
            <Triangle m={m} colours={colours} spinning={spinning} next={nextV} row={bandRow} speed={speed} />
            <Odds columns={columns} p={pShown} found={found} swing={swing} idle={phase === 'idle'} over={phase === 'over'}>
              {phase === 'over' && round?.outcome && (
                <RoundOver
                  key={history[0]?.id}
                  title={round.title}
                  multiplier={round.cash}
                  stake={round.stake}
                  nextBet={bet.value}
                  blocked={bet.blocked}
                  onBetAgain={() => void start()}
                  onClear={clear}
                  placement="center"
                />
              )}
            </Odds>
          </div>
        </div>
      </Board>

      {live ? (
        <ChanceBar
          p={pShown}
          label={`Chance of ${betPhrase(b)}`}
          note="Exact over every way the rest of the triangle can be coloured. The green bars add up to it."
        />
      ) : (
        <Caption>
          Sperner’s lemma: however the vertices fall, the number of rainbow triangles is odd. With {m * m} triangles, {betPhrase(b)} happens{' '}
          {fmtChance(startChance(m, b))} of the time. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Sperner" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A big triangle is cut into small ones and its corners are coloured one by one. A small triangle whose three corners show all three colours is a{' '}
              <b>rainbow</b>. Bet on how many rainbows the finished picture will have: <b>exactly 1</b>, or <b>at least 3, 5, 7, 9 or 11</b>.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the number of small triangles (9, 16 or 25) and your rainbow bet, then bet. The first vertex is coloured straight away.</li>
              <li>
                The big corners are fixed: <b>A</b> on top, <b>B</b> bottom-left, <b>C</b> bottom-right. A vertex on a side takes one of that side’s two corner
                colours (50/50). A vertex inside takes any of the three (⅓ each). Each vertex still to come is ringed by the colours it can take.
              </li>
              <li>
                Vertices are coloured row by row from the top. At every checkpoint you can cash out, <b>Colour next</b> (Space), or <b>Colour row</b> to finish the
                row in one go. The round ends by itself as soon as your bet is decided.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The bars beside the triangle are the exact chances of each final count. Their heights are literal: a bar at 40% is 40% tall.{' '}
              <b style={{ color: 'var(--green)' }}>Green bars</b> win your bet and <b style={{ color: 'var(--red)' }}>red bars</b> lose it, so the green total is
              your win chance. Under them, the <b>Next vertex</b> chips show where your chance goes for each colour the next vertex can take; they always average
              to the chance now.
            </p>
            <p>
              Rainbows found never go away. Two found force a third (see below), so “exactly 1” is lost at the second rainbow, and “5 or more” is won the moment
              the fourth appears.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              <b>Sperner’s lemma (1928):</b> under these colouring rules the number of rainbow triangles is always odd. Call an edge with colours B–C a door. A
              rainbow has exactly one door; every other small triangle has none or two. Count doors triangle by triangle: inner doors are counted twice, doors on
              the bottom side once, so the rainbow count has the parity of the bottom doors. Walking the bottom side from B to C the colour must switch an odd
              number of times, so the count is odd.
            </p>
            <p>
              Sharper still: rainbows whose colours run A → B → C the same way round as the big corners outnumber the reversed ones by exactly one. So the count is
              1 + 2 × (reversed rainbows): “exactly 1” means no reversed rainbow at all.
            </p>
            <p>
              The live odds are exact. Rows are coloured independently, and the rainbows between two rows depend only on those rows, so a row-by-row dynamic
              programme sums over every possible completion (up to 2¹²·3⁶ ≈ 3 million colourings for 25 triangles). With 9 triangles the counts 1, 3, 5 come up
              9/16, 6/16 and 1/16 of the time.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays prize = {(RTP * 100).toFixed(0)}% ÷ P(win) at the start. Cashing out pays prize × your current win chance. That chance is a conditional
              probability, so each reveal is a fair bet: on average it stays where it is. Colouring one vertex or a whole row, stopping early or playing on all
              leave the round worth exactly {(RTP * 100).toFixed(0)}% of your stake. The largest prize is 16 triangles with 9 or more rainbows: 24 of the 13,824
              colourings, paying {fmtMult(RTP * 576)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
