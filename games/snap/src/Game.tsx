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
  Slider,
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
import Field, { type Blade, type Outcome } from './Board';
import { BREAK_MAX, BREAK_MIN, CUTS, RTP, headline, longPiece, prizeFor, snapBreak, volatilityOf, winChance, type Cuts } from './math';

type Phase = 'idle' | 'cutting' | 'checkpoint' | 'over';

interface Round {
  /** Your break, in percent. */
  brk: number;
  total: Cuts;
  stake: number;
  /** Locked at bet time: RTP / P₀. */
  prize: number;
  cuts: number[];
  cash: number;
  outcome: Outcome | null;
}

const ACCENT = '#ff9f43';
const OUTCOME_TITLE: Record<Outcome, string> = { polygon: 'Polygon!', stuck: 'No polygon', cashed: 'Cashed out' };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Narrow boards get the result card inline, below the stick, so it never covers it. */
function useNarrow(threshold: number) {
  const [el, setEl] = useState<SVGSVGElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < threshold));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, threshold]);
  return [narrow, setEl] as const;
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();
  const [narrow, svgRef] = useNarrow(470);

  const [brk, setBrk] = useState(20);
  const [cuts, setCuts] = useState<Cuts>(3);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [landing, setLanding] = useState<{ u: number; p: number } | null>(null);
  const [blade, setBlade] = useState<Blade>({ x: 0.5, down: false, on: false });
  const [infoOpen, setInfoOpen] = useState(false);

  // A cut is decided the moment it starts falling, so leaving mid-animation
  // settles at its real result, never at the pre-cut value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'cutting' ? resolved.current : round?.cash ?? 0));

  const speed = turbo.turbo ? 0.25 : 1;
  const slideMs = Math.round(460 * speed);
  const dropMs = Math.round(140 * speed);
  const holdMs = Math.round(480 * speed);
  const foldMs = Math.round(650 * speed);
  const live = phase === 'cutting' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setLanding(null);
    setBlade((b) => ({ ...b, on: false, down: false }));
    setPhase('over');
  }

  function cut(r: Round) {
    const u = rng.next();
    const next = [...r.cuts, u];
    const long = longPiece([r.brk / 100, ...next]);
    const left = r.total - next.length;
    const p = winChance(long?.length ?? null, left);
    const cash = r.prize * p;
    resolved.current = cash;

    setPhase('cutting');
    setLanding(null);
    setBlade((b) => ({ ...b, x: u, on: true, down: false }));
    timers.after(slideMs, () => setBlade((b) => ({ ...b, down: true })));
    // The stick snaps; the old chart stays up for a beat with the landing height marked.
    timers.after(slideMs + dropMs, () => setLanding({ u, p }));
    timers.after(slideMs + dropMs + holdMs, () => {
      const landed = { ...r, cuts: next, cash };
      setBlade((b) => ({ ...b, on: false, down: false }));
      if (!long) return finish(landed, 'polygon', r.prize);
      if (left === 0) return finish(landed, 'stuck', 0);
      setRound(landed);
      setLanding(null);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: p });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { brk, total: cuts, stake: bet.value, prize: prizeFor(brk / 100, cuts), cuts: [], cash: RTP, outcome: null };
    setRound(r);
    cut(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setLanding(null);
    setBlade((b) => ({ ...b, on: false, down: false }));
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (live) return;
    apply();
    if (phase === 'over') clear();
  };
  const setBreak = (raw: number) => change(() => setBrk((prev) => snapBreak(raw, prev)));

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? cut(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const b = round?.brk ?? brk;
  const total = round?.total ?? cuts;
  const fallen = round?.cuts ?? [];
  const left = total - fallen.length;
  const long = longPiece([b / 100, ...fallen]);
  const pNow = round?.outcome === 'polygon' ? 1 : round?.outcome === 'stuck' ? 0 : winChance(long?.length ?? null, left);
  const prize = round?.prize ?? prizeFor(brk / 100, cuts);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const p0 = headline(brk / 100, cuts);
  const long0 = Math.max(brk, 100 - brk);
  const instant = long ? 1 - long.length : 1;

  let status = `Ready · break at ${b}%, ${plural(total, 'cut')}`;
  if (phase === 'cutting') status = `Cut ${fallen.length + 1} of ${total} falling`;
  if (phase === 'checkpoint') status = `Checkpoint · ${fallen.length} of ${total} cuts`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${plural(fallen.length, 'cut')}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Snap"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={volatilityOf(brk, cuts)} />}>
            Your break <b className="snap-brk">{brk}%</b>
          </Label>
          <Slider label="Your break" min={BREAK_MIN} max={BREAK_MAX} value={brk} disabled={live} onChange={setBreak} />
          <div className="snap-hint">
            <span>edge: long odds</span>
            <span>long piece {long0}%</span>
            <span>centre: safe</span>
          </div>

          <Label hint="more cuts, safer">Random cuts</Label>
          <Chips
            label="Random cuts"
            options={CUTS.map((v) => ({ value: v, label: v }))}
            value={cuts}
            disabled={live}
            onChange={(v) => change(() => setCuts(v))}
          />
          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(p0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(brk / 100, cuts))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && cut(round)}>
                {left === 1 ? `Last cut · ${fmtChance(pNow)} to win` : `Next cut · ${fmtChance(instant)} instant win`}
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
            label: 'Polygon chance',
            value: fmtChance(pNow),
            sub: live ? `${plural(left, 'cut')} to fall` : phase === 'over' ? `after ${plural(fallen.length, 'cut')}` : `long piece ${long0}%`,
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'after each cut', tone: 'cash' },
          { label: 'Polygon prize', value: fmtMult(prize), sub: formatAmount(stake * prize, 2), tone: 'prize' },
        ]}
      />

      <Board className={'snap-board' + (narrow ? ' narrow' : '')}>
        <Field
          svgRef={svgRef}
          brk={b}
          cuts={fallen}
          landing={landing}
          total={total}
          blade={blade}
          slideMs={slideMs}
          dropMs={dropMs}
          foldMs={foldMs}
          outcome={phase === 'over' ? round?.outcome ?? null : null}
          live={live}
          onDrag={setBreak}
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
            placement={narrow ? 'inline' : 'bottom'}
          />
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={pNow}
          label="Chance the pieces make a polygon"
          note="It is the green share of the box above the stick. Wherever the next cut lands, the green height there becomes your new chance."
        />
      ) : (
        <Caption>
          Break the stick at {brk}%, then {plural(cuts, 'random cut')} fall. If every piece ends shorter than half the stick, the pieces close into a
          polygon: {fmtChance(p0)} for these settings. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Snap" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Break a stick, let random cuts fall on it, and finish with pieces that can be laid out as a polygon. That happens exactly when{' '}
              <b>every piece is shorter than half the stick</b>.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>
                Choose where you break the stick (slider, or drag the handle on the board) and how many random cuts follow. Then bet: your break snaps and
                the first cut falls.
              </li>
              <li>After each cut you can cash out (C), or let the next cut fall (Space).</li>
              <li>The moment no piece is half the stick or longer, the polygon closes and pays the prize. If a long piece survives the last cut, the round is lost.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              At most one piece can be half the stick or longer: the <b style={{ color: ACCENT }}>long piece</b>. Two ½ rulers hang from its ends. A cut
              inside both of them (the <b style={{ color: 'var(--green)' }}>green column</b>) splits it into two short pieces at once. A cut near one of its
              ends trims it, and your chance goes up. A cut in any other piece is wasted, and your chance goes down.
            </p>
            <p>
              The box above the stick shows all of this at once. For each spot on the stick, the green height is your chance if the next cut lands there. The
              <b style={{ color: 'var(--green)' }}> green share of the box</b> (the dashed level) is your chance right now. On the last cut, only the green
              column is left, so its width is your chance.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Broken stick: pieces of total length 1 form a polygon if and only if every piece is shorter than ½, because each side must be shorter than all
              the others together. With a long piece of length ℓ and m random cuts still to come,
            </p>
            <p>
              <b>P(polygon) = 1 − (1 + m(2ℓ − 1)) / 2^m</b>
            </p>
            <p>
              The number of cuts that land in the long piece is binomial, and the spacing formula for those cuts collapses to this straight line in ℓ. A whole
              stick cut twice makes a triangle a quarter of the time. In general, m random cuts fail with chance (m + 1)/2^m. That is Wendel's theorem from
              Half Moon seen from the other side: the pieces of a stick are the gaps between points on a circle, and "a piece of at least half" means "all the
              points fit in a half circle".
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is locked when you bet, at {(RTP * 100).toFixed(0)}% ÷ (chance for your settings). Cashing out pays prize × your chance now. The green
              area is the average of your chances after the next cut, so every cut is a fair bet. By optional stopping, the round is worth{' '}
              {(RTP * 100).toFixed(0)}% of your stake whenever you cash out. Where you break only trades chance for prize, never value. The largest prize is
              99× (a 1% break with one cut).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
