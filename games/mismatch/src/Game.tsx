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
import Field, { VIEWS, type Anim, type Landed, type LayoutName, type Outcome, type Phase } from './Board';
import {
  BETS,
  MAX_MULTIPLIER,
  RTP,
  SIZES,
  betDef,
  decided,
  derangements,
  drawInto,
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
  type Size,
} from './math';

const ACCENT = '#ffcad4';

interface Round {
  id: number;
  n: Size;
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
  if (r.outcome === 'won') return left > 0 ? 'Win locked in' : r.bet === 'none' ? 'Perfect mismatch' : 'Bet won';
  // Lost: either too many matches already, or too few slots left that can match.
  return !bet.wins(m) && !bet.wins(m + 1) && bet.wins(m - 1) ? (r.bet === 'none' ? 'A token found home' : 'Too many matches') : 'Out of reach';
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
      const V = VIEWS[layout];
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
  const [layout, svgEl, svgRef] = useLayout(640);
  const wheelBox = useWheelBox(svgEl, layout);

  const [size, setSize] = useState<Size>(8);
  const [betId, setBetId] = useState<BetId>('none');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [anim, setAnim] = useState<Anim | null>(null);
  const [landed, setLanded] = useState<Landed | null>(null);
  const [pointer, setPointer] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
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
    setHover(null);
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
    setHover(null);
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

  function drawAt(slot: number) {
    if (busy.current || phase !== 'checkpoint' || !round || round.placed[slot] !== null) return;
    busy.current = true;
    void play(round, [drawInto(round.placed, slot, rng)], false);
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
      n: size,
      bet: betId,
      stake: bet.value,
      prize: prizeFor(size, bd),
      placed: emptyBoard(size),
      cash: RTP,
      outcome: null,
    };
    setRound(r);
    setLanded(null);
    void play(r, [drawInto(r.placed, 0, rng)], false);
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
    setHover(null);
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
      space: () => (phase === 'checkpoint' && round ? drawAt(nextSlot(round.placed)) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const n = round?.n ?? size;
  const bd: BetDef = betDef(round?.bet ?? betId);
  const placed = round?.placed ?? emptyBoard(n);
  const t = tally(placed);
  const prize = round?.prize ?? prizeFor(size, betDef(betId));
  const stake = round?.stake ?? bet.value;
  const pNow = round?.outcome === 'won' ? 1 : round?.outcome === 'lost' ? 0 : winChance(bd, t);
  const cash = round ? (phase === 'over' ? round.cash : prize * pNow) : RTP;
  const p0 = headline(size, betDef(betId));
  const next = nextSlot(placed);
  const target =
    phase === 'drawing' && anim ? anim.draw.slot : phase === 'checkpoint' ? (hover !== null && placed[hover] === null ? hover : next) : phase === 'idle' ? 0 : null;
  const targetOpen = target !== null && isOpen(placed, target);

  let status = `Ready · ${bd.name.toLowerCase()} · ${n} slots`;
  if (phase === 'drawing') status = auto ? `Drawing to the end · ${t.r} left` : `Drawing into slot ${(anim?.draw.slot ?? 0) + 1}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${plural(t.m, 'match', 'matches')} · ${t.r} left`;
  if (phase === 'over' && round) status = `${outcomeTitle(round)} · ${plural(t.m, 'match', 'matches')}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  let chanceSub = `finish with ${bd.phrase}`;
  if (live) chanceSub = `${plural(t.m, 'match', 'matches')} · ${t.a} of ${t.r} slots can match`;
  if (phase === 'over' && round) chanceSub = round.outcome === 'cashed' ? 'when you cashed out' : `finished with ${plural(t.m, 'match', 'matches')}`;

  const pickable = phase === 'checkpoint' && !busy.current;
  const fiveOff = size === 5;

  return (
    <GameLayout
      name="Mismatch"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint="more slots, longer rounds">Slots</Label>
          <Chips
            label="Slots"
            options={SIZES.map((v) => ({ value: v, label: v }))}
            value={size}
            disabled={live}
            onChange={(v) =>
              change(() => {
                setSize(v);
                if (v === 5 && betId === 'five') setBetId('four');
              })
            }
          />

          <Label hint={<VolBadge level={volatilityOf(size, betDef(betId))} />}>Matches at the end</Label>
          <Chips
            label="Matches at the end"
            wrap
            options={BETS.map((b) => ({
              value: b.id,
              label: b.chip,
              title: b.id === 'five' && fiveOff ? 'With 5 slots, 4+ already means all five' : `${b.name}: ${fmtChance(headline(size, b))}`,
              disabled: b.id === 'five' && fiveOff,
            }))}
            value={betId}
            disabled={live}
            onChange={(v) => change(() => setBetId(v))}
          />
          <div className="mm-betname">{betDef(betId).name}</div>

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(p0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(size, betDef(betId)))}</dd>
            <dt>Average matches</dt>
            <dd>1.00</dd>
          </dl>

          {live && round ? (
            <>
              <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={() => drawAt(next)}>
                {phase === 'drawing'
                  ? 'Drawing…'
                  : `Draw into slot ${next + 1} · ${isOpen(placed, next) ? `1/${t.r} match` : "can't match"}`}
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
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'at every checkpoint',
            tone: 'cash',
          },
          { label: 'Prize', value: fmtMult(prize), sub: round ? formatAmount(stake * prize, 2) : `for ${bd.phrase}`, tone: 'prize' },
        ]}
      />

      <Board className={'mm-board ' + layout}>
        <Field
          svgRef={svgRef}
          layout={layout}
          n={n}
          placed={placed}
          bet={bd}
          phase={phase}
          target={target}
          anim={anim}
          pointer={pointer}
          spinMs={ms.spin}
          flyMs={ms.fly}
          landed={landed}
          pickable={pickable}
          onPick={drawAt}
          onHover={setHover}
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
          label={`Chance to finish with ${bd.phrase}`}
          note={
            target !== null && phase === 'checkpoint'
              ? `The green share of the strip. Click any empty slot to draw into it: ${
                  targetOpen ? `slot ${target + 1} matches 1 in ${t.r}` : `slot ${target + 1} can't match`
                }. The slot you pick moves the risk, never the value.`
              : 'The green share of the strip, from the tokens still in the bag.'
          }
        />
      ) : (
        <Caption>
          Deal {n} tokens into their {n} slots at random and none lands home with chance D({n})/{n}! = {derangements(n).toLocaleString('en-US')}/
          {factorial(n).toLocaleString('en-US')} = {fmtChance(derangements(n) / factorial(n))}, which tends to 1/e. {bd.name}: {fmtChance(headline(n, bd))}. RTP{' '}
          {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Mismatch" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A ring of coloured slots and a bag holding one matching token for each. Tokens are drawn from the bag at random, one per slot. A token that
              lands in its own slot (same colour, same number) is a <b style={{ color: ACCENT }}>match</b>. Bet on how many matches the full board will have:
              none at all, exactly one, at most one, or at least 1 to 5.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the number of slots and your bet, then press Bet. The first token drops into slot 1.</li>
              <li>
                At every checkpoint you can cash out (C), draw into the next slot clockwise (Space), click any empty slot to draw into it, or draw to the end.
              </li>
              <li>The round ends the moment your bet is certain to win (it pays the prize) or certain to lose.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              <b>The bag</b> in the middle holds every token left, as equal slices: the pointer picks one slice at random. The slice of the slot you are about
              to fill is lifted, so its match chance is one slice in r, literally. Each empty slot also carries an <b>arc</b> on its rim of that same length,
              1/r of the circle.
            </p>
            <p>
              A <b>dashed</b> slot's token is already sitting somewhere else, so it can never match: drawing into it is match-free. Bright slices are tokens
              whose slot is still empty; faded slices are tokens that can't match anything any more.
            </p>
            <p>
              <b>Where you finish</b> splits every way the rest of the board could be dealt by its final number of matches. The{' '}
              <b style={{ color: 'var(--green)' }}>green share</b> is your win chance, exactly.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              A random deal is a random permutation and the matches are its fixed points. Permutations with none are <b>derangements</b>: D(n) = n!·(1 − 1/1! +
              1/2! − … ± 1/n!), so the chance of no match is that alternating sum, which tends to <b>1/e ≈ 36.79%</b> (already 36.79% at 8 slots). Exactly k
              matches happen with chance C(n, k)·D(n−k)/n! → 1/(e·k!), and the average is exactly one match for every n.
            </p>
            <p>
              Mid-round, with r tokens left of which a still have their own slot empty, the chance of exactly j more matches comes from inclusion–exclusion:
              Σ<sub>s</sub> (−1)<sup>s−j</sup> C(s, j)·C(a, s)·(r−s)! / r!. Every count is an exact integer.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is locked when you bet at {(RTP * 100).toFixed(0)}% ÷ (chance for your settings). Cashing out pays prize × your win chance now. Each
              draw takes a uniformly random token from the bag whichever slot you fill, so your win chance is a martingale: every draw is a fair bet, the slot
              you choose changes the risk of the draw but never its value, and by optional stopping the round is worth {(RTP * 100).toFixed(0)}% of your stake
              however you play. The largest prize on offer is {fmtMult(MAX_MULTIPLIER)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
