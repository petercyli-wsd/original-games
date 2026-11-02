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
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import Field, { VIEW, type Anim, type Landed, type LayoutName, type Outcome, type Phase } from './Board';
import {
  BETS,
  MAX_MULTIPLIER,
  N,
  RTP,
  betDef,
  decided,
  derangements,
  drawNext,
  drawToEnd,
  emptyBoard,
  factorial,
  headline,
  isOpen,
  nextSlot,
  place,
  prizeFor,
  tally,
  volatilityOf,
  winChance,
  type BetDef,
  type BetId,
  type Draw,
  type Placed,
} from './math';

const ACCENT = '#ffcad4';

interface Round {
  id: number;
  bet: BetId;
  stake: number;
  /** Locked at bet time: RTP / P(win). */
  prize: number;
  placed: Placed;
  /** The cash-out after the latest committed draw (or the settled value). */
  cash: number;
  outcome: Outcome | null;
}

const plural = (x: number, one: string, many = one + 's') => `${x} ${x === 1 ? one : many}`;

function outcomeTitle(r: Round): string {
  const bet = betDef(r.bet);
  const { m, r: left } = tally(r.placed);
  if (r.outcome === 'cashed') return 'Cashed out';
  // Won early: the bet holds however the last slots are dealt.
  if (r.outcome === 'won') return left > 0 ? 'Win locked in' : r.bet === 'none' ? 'No matches!' : 'Bet won';
  // Lost: either too many matches already, or too few slots left that can match.
  return !bet.wins(m) && bet.wins(m - 1) ? (r.bet === 'none' ? 'A token matched' : 'Too many matches') : 'Too few slots can match';
}

/** Small frames get a stacked board and the result card inline below it. */
function useLayout(threshold: number) {
  const [el, setEl] = useState<SVGSVGElement | null>(null);
  const [layout, setLayout] = useState<LayoutName>('wide');
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLayout(e.contentRect.width < threshold ? 'narrow' : 'wide'));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, threshold]);
  return [layout, el, setEl] as const;
}

/** Where the wheel sits inside the board, so the wide-layout result card can cover just the bag. */
function useWheelBox(el: SVGSVGElement | null, layout: LayoutName) {
  const [box, setBox] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      const parent = el.parentElement;
      if (!parent) return;
      const s = el.getBoundingClientRect();
      const p = parent.getBoundingClientRect();
      const V = VIEW;
      const k = Math.min(s.width / V.w, s.height / V.h);
      const ox = s.left - p.left + (s.width - V.w * k) / 2;
      const oy = s.top - p.top + (s.height - V.h * k) / 2;
      const size = 300 * k;
      setBox({ left: ox + V.cx * k - size, top: oy + V.cy * k - size, width: size * 2, height: size * 2 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, layout]);
  return box;
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();
  const [layout, svgEl, svgRef] = useLayout(480);
  const wheelBox = useWheelBox(svgEl, layout);

  const [betId, setBetId] = useState<BetId>('none');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [anim, setAnim] = useState<Anim | null>(null);
  const [landed, setLanded] = useState<Landed | null>(null);
  const [pointer, setPointer] = useState(0);
  const [auto, setAuto] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const busy = useRef(false);
  const pointerRef = useRef(0);

  // A draw (or a run of draws) is decided the moment it starts, so leaving
  // mid-animation settles at its real result, never at the pre-draw value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'drawing' ? resolved.current : round?.cash ?? 0));

  const speed = turbo.turbo ? 0.25 : 1;
  const live = phase === 'drawing' || phase === 'checkpoint';
  const timing = (fast: boolean) => ({
    spin: Math.round((fast ? 300 : 700) * speed),
    fly: Math.round((fast ? 200 : 360) * speed),
    hold: Math.round((fast ? 90 : 120) * speed),
  });
  const [ms, setMs] = useState(timing(false));

  function finish(r: Round, outcome: Outcome, cash: number) {
    busy.current = false;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setAnim(null);
    setAuto(false);
    setPhase('over');
  }

  /** Animate a list of pre-decided draws, then checkpoint or end the round. */
  async function play(r0: Round, draws: Draw[], fast: boolean) {
    const bd = betDef(r0.bet);
    // Resolve everything up front.
    let final = r0.placed;
    for (const d of draws) final = place(final, d.slot, d.token);
    const end = decided(bd, tally(final));
    resolved.current = end === 'won' ? r0.prize : end === 'lost' ? 0 : r0.prize * winChance(bd, tally(final));

    const tm = timing(fast);
    setMs(tm);
    setPhase('drawing');
    let r = r0;
    for (const d of draws) {
      // Spin the pointer forwards to the drawn sector (with a deterministic nudge off its centre).
      const nudge = (((seq.current * 0.618 + r.placed.length * 0.37) % 1) - 0.5) * 0.55;
      const goal = (d.sector + nudge) * (360 / d.of);
      let next = pointerRef.current - (pointerRef.current % 360) + goal;
      while (next < pointerRef.current + (fast ? 140 : 400)) next += 360;
      pointerRef.current = next;
      setPointer(next);
      setAnim({ draw: d, stage: 'spin' });
      if (!(await timers.wait(tm.spin))) return;
      setAnim({ draw: d, stage: 'fly' });
      if (!(await timers.wait(tm.fly))) return;
      const before = r.placed;
      const placed = place(before, d.slot, d.token);
      r = { ...r, placed, cash: r.prize * winChance(bd, tally(placed)) };
      setRound(r);
      setAnim(null);
      setLanded({ draw: d, before, seq: ++seq.current });
      if (!(await timers.wait(tm.hold))) return;
    }
    const t = tally(r.placed);
    const out = decided(bd, t);
    if (out === 'won') return finish(r, 'won', r.prize);
    if (out === 'lost') return finish(r, 'lost', 0);
    busy.current = false;
    setAuto(false);
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: r.cash, winChance: winChance(bd, t) });
  }

  function drawOne() {
    if (busy.current || phase !== 'checkpoint' || !round) return;
    busy.current = true;
    void play(round, [drawNext(round.placed, rng)], false);
  }

  function drawRest() {
    if (busy.current || phase !== 'checkpoint' || !round) return;
    busy.current = true;
    setAuto(true);
    void play(round, drawToEnd(round.placed, betDef(round.bet), rng), true);
  }

  async function start() {
    if (live || busy.current || bet.blocked) return;
    busy.current = true;
    if (!(await ticket.place(bet.value))) {
      busy.current = false;
      return;
    }
    timers.clearAll();
    const bd = betDef(betId);
    const r: Round = {
      id: ++seq.current,
      bet: betId,
      stake: bet.value,
      prize: prizeFor(bd),
      placed: emptyBoard(),
      cash: RTP,
      outcome: null,
    };
    setRound(r);
    setLanded(null);
    void play(r, [drawNext(r.placed, rng)], false);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round || busy.current) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    busy.current = false;
    setRound(null);
    setAnim(null);
    setLanded(null);
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
      space: () => (phase === 'checkpoint' ? drawOne() : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const bd: BetDef = betDef(round?.bet ?? betId);
  const placed = round?.placed ?? emptyBoard();
  const t = tally(placed);
  const prize = round?.prize ?? prizeFor(bd);
  const stake = round?.stake ?? bet.value;
  const pNow = round?.outcome === 'won' ? 1 : round?.outcome === 'lost' ? 0 : winChance(bd, t);
  const cash = round ? (phase === 'over' ? round.cash : prize * pNow) : RTP;
  const chosen = betDef(betId);
  const p0 = headline(chosen);
  const next = nextSlot(placed);
  const target = phase === 'drawing' && anim ? anim.draw.slot : phase === 'over' ? null : next;
  const nextOpen = next >= 0 && isOpen(placed, next);

  let status = `Ready · win with ${bd.name.toLowerCase()}`;
  if (phase === 'drawing') status = auto ? `Drawing to the end · ${t.r} left` : `Drawing into slot ${(anim?.draw.slot ?? 0) + 1}`;
  if (phase === 'checkpoint') status = `${plural(t.m, 'match', 'matches')} so far · ${t.r} slots left`;
  if (phase === 'over' && round) status = `${outcomeTitle(round)} · ${plural(t.m, 'match', 'matches')}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  let chanceSub = `win with ${bd.name.toLowerCase()}`;
  if (live) chanceSub = `${plural(t.m, 'match', 'matches')} · ${t.a} of ${t.r} empty slots can match`;
  if (phase === 'over' && round) chanceSub = round.outcome === 'cashed' ? 'when you cashed out' : `finished with ${plural(t.m, 'match', 'matches')}`;

  return (
    <GameLayout
      name="Mismatch"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={volatilityOf(chosen)} />}>Matches at the end</Label>
          <Chips
            label="Matches at the end"
            options={BETS.map((b) => ({ value: b.id, label: b.chip, title: `${b.name}: ${fmtChance(headline(b))}` }))}
            value={betId}
            disabled={live}
            onChange={(v) => change(() => setBetId(v))}
          />
          <div className="mm-betname">Win with {chosen.name.toLowerCase()}</div>

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(p0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(chosen))}</dd>
          </dl>

          {live && round ? (
            <>
              <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={drawOne}>
                {phase === 'drawing' ? 'Drawing…' : `Draw into slot ${next + 1}`}
              </ActionButton>
              <ActionButton kind="secondary" className="mm-rest" disabled={phase !== 'checkpoint'} onClick={drawRest}>
                Draw to the end
              </ActionButton>
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
          { label: 'Win chance', value: fmtChance(pNow), sub: chanceSub, tone: 'chance' },
          {
            label: 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'after every draw',
            tone: 'cash',
          },
          { label: 'Prize', value: fmtMult(prize), sub: round ? formatAmount(stake * prize, 2) : `for ${bd.name.toLowerCase()}`, tone: 'prize' },
        ]}
      />

      <Board className={'mm-board ' + layout}>
        <Field
          svgRef={svgRef}
          layout={layout}
          n={N}
          placed={placed}
          bet={bd}
          phase={phase}
          target={target}
          anim={anim}
          pointer={pointer}
          spinMs={ms.spin}
          flyMs={ms.fly}
          landed={landed}
        />
        {phase === 'over' && round?.outcome && (
          <div className={'mm-over ' + layout} style={layout === 'wide' && wheelBox ? wheelBox : undefined}>
            <RoundOver
              key={history[0]?.id}
              title={outcomeTitle(round)}
              multiplier={round.cash}
              stake={round.stake}
              nextBet={bet.value}
              blocked={bet.blocked}
              onBetAgain={() => void start()}
              onClear={clear}
              placement={layout === 'wide' ? 'center' : 'inline'}
            />
          </div>
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={pNow}
          label={`Chance to win with ${bd.name.toLowerCase()}`}
          note={
            phase === 'checkpoint' && next >= 0
              ? nextOpen
                ? `Next: slot ${next + 1}. Its token ${next + 1} is one of the ${t.r} slices in the bag, so 1 in ${t.r} to match.`
                : `Next: slot ${next + 1}. Its token ${next + 1} is already in another slot, so it can't match.`
              : `Drawing a token from the bag…`
          }
        />
      ) : (
        <Caption>
          Tokens 1 to {N} are drawn at random into slots 1 to {N} in order; a match is a token landing in its own number. Win with{' '}
          {bd.name.toLowerCase()}.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Mismatch" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              {N} numbered slots sit on a ring and a bag holds {N} tokens with the same numbers and colours. Tokens are drawn from the bag at random into slots 1
              to {N} in order. A token that lands in its own slot (token 3 in slot 3) is a <b style={{ color: ACCENT }}>match</b>. Pick how many matches the full
              board must have: none, at most one, or at least 2, 3 or 4.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick your target and press Bet. The first token drops into slot 1.</li>
              <li>After every draw you can cash out (C), draw into the next slot (Space), or draw to the end.</li>
              <li>The round ends the moment your bet is certain to win (it pays the prize) or certain to lose.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              <b>The bag</b> in the middle holds every token left, as equal slices; the pointer picks one at random. The next slot's own token is the
              highlighted slice: <b style={{ color: 'var(--red)' }}>red</b> when a match would hurt your bet, <b style={{ color: 'var(--green)' }}>green</b> when
              it would help. Its chance is one slice out of all of them, shown in the centre.
            </p>
            <p>
              A slot that says <b>can't match</b> has lost its token to another slot, so it is certain not to match. Every such slot makes a match less likely
              from then on, which is why your win chance jumps after a draw like token 2 into slot 1. The green bar under the board is your overall chance to
              win, exactly.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              A random deal is a random permutation and the matches are its fixed points. Permutations with none are <b>derangements</b>: D(n) = n!·(1 − 1/1! +
              1/2! − … ± 1/n!), so the chance of no match is D({N})/{N}! = {derangements(N).toLocaleString('en-US')}/{factorial(N).toLocaleString('en-US')} ={' '}
              {fmtChance(derangements(N) / factorial(N))}, almost exactly <b>1/e</b>. Exactly k matches happen with chance C(n, k)·D(n−k)/n! ≈ 1/(e·k!), and the
              average is exactly one match.
            </p>
            <p>
              Mid-round, with r tokens left of which a still have their own slot empty, the chance of exactly j more matches comes from inclusion–exclusion:
              Σ<sub>s</sub> (−1)<sup>s−j</sup> C(s, j)·C(a, s)·(r−s)! / r!. Every count is an exact integer.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is locked when you bet at {(RTP * 100).toFixed(0)}% ÷ (chance for your target). Cashing out pays prize × your win chance now. Each draw
              takes a uniformly random token from the bag, so your win chance is a martingale: every draw is a fair bet, and by optional stopping the round is
              worth {(RTP * 100).toFixed(0)}% of your stake however you play. The largest prize on offer is {fmtMult(MAX_MULTIPLIER)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
