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
import { useEffect, useMemo, useRef, useState } from 'react';
import Ring, { type Flight, type TokenPos } from './Board';
import {
  LIMITS,
  LOADS,
  RTP,
  SIZES,
  afterSafeKey,
  distances,
  emptyTable,
  fillChance,
  fillChanceFrom,
  insert,
  keysFor,
  maxMultiplier,
  redCount,
  redSlots,
  volatilityOf,
  type Limit,
  type Load,
  type Size,
} from './math';

type Phase = 'idle' | 'probing' | 'checkpoint' | 'over';
type Outcome = 'bust' | 'cashed' | 'full';

interface Round {
  size: Size;
  limit: Limit;
  target: number;
  stake: number;
  table: boolean[];
  stored: number;
  newest: number | null;
  cash: number;
  outcome: Outcome | null;
}

const ACCENT = '#00bbf9';
const OUTCOME_TITLE: Record<Outcome, string> = { bust: 'Probe overflow', cashed: 'Cashed out', full: 'Table filled' };
const LOAD_LABEL: Record<Load, string> = { 0.5: '½', 0.625: '⅝', 0.75: '¾' };

/** Narrow boards get the result card inline, below the ring, so it never covers the slots. */
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
  const [narrow, svgRef] = useNarrow(470);
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [size, setSize] = useState<Size>(24);
  const [limit, setLimit] = useState<Limit>(2);
  const [load, setLoad] = useState<Load>(0.625);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [token, setToken] = useState<TokenPos>({ turn: 0, ms: 0, ease: 'spin' });
  const [infoOpen, setInfoOpen] = useState(false);

  // The key in flight is decided the moment it is hashed, so leaving
  // mid-probe settles at its real result, never at the safer pre-key value.
  const resolved = useRef<number>(0);
  const ticket = useTicket(() => (phase === 'probing' ? resolved.current : round?.cash ?? 0));

  // Risky keys get a full spin and a visible pause on their probe window;
  // free keys (nothing red, so nothing can overflow) go in quickly.
  const T = turbo.turbo
    ? { spin: 130, pause: 40, hop: 40, settle: 55, free: { spin: 55, pause: 10, hop: 22, settle: 25, gap: 15 } }
    : { spin: 520, pause: 170, hop: 150, settle: 220, free: { spin: 220, pause: 40, hop: 85, settle: 90, gap: 60 } };
  // Scheduled keys read the latest timings, so Turbo applies mid-burst.
  const timing = useRef(T);
  timing.current = T;
  const live = phase === 'probing' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    timers.clearAll();
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  /** Hashes the next key, animates its probe, then settles the step. */
  function insertKey(r: Round) {
    timers.clearAll();
    const m = r.size;
    const red = redCount(r.table, r.limit);
    const free = red === 0;
    const h = rng.int(m);
    const res = insert(r.table, h, r.limit);
    const cash = res.safe ? afterSafeKey(r.cash, red, m) : 0;
    resolved.current = cash;
    setPhase('probing');

    const now = timing.current;
    const { spin, pause, hop, settle } = free ? now.free : now;
    setFlight({ home: h, hop: 0, arrived: false, safe: res.safe, done: false });
    setToken((t) => {
      const goal = (h + 0.5) / m;
      let delta = (((goal - t.turn) % 1) + 1) % 1;
      if (delta < (free ? 0.02 : 0.4)) delta += 1;
      return { turn: t.turn + delta, ms: spin, ease: 'spin' };
    });
    timers.after(spin, () => setFlight((f) => f && { ...f, arrived: true }));
    for (let i = 1; i <= res.hops; i++) {
      const at = spin + pause + (i - 1) * hop;
      timers.after(at, () => setToken((t) => ({ turn: t.turn + 1 / m, ms: hop, ease: 'hop' })));
      timers.after(at + hop * 0.7, () => setFlight((f) => f && { ...f, hop: i }));
    }
    timers.after(spin + pause + res.hops * hop + settle, () => {
      setFlight((f) => f && { ...f, hop: res.hops, arrived: true, done: true });
      if (!res.safe) return finish(r, 'bust', 0);
      const next: Round = { ...r, table: res.table, stored: r.stored + 1, newest: res.slot, cash };
      if (next.stored >= r.target) return finish(next, 'full', cash);
      setRound(next);
      const nextRed = redCount(next.table, r.limit);
      // A key with no red slot can't overflow: it goes in by itself.
      if (nextRed === 0) return timers.after(timing.current.free.gap, () => insertKey(next));
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: 1 - nextRed / m });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = {
      size,
      limit,
      target: keysFor(size, load),
      stake: bet.value,
      table: emptyTable(size),
      stored: 0,
      newest: null,
      cash: RTP,
      outcome: null,
    };
    setRound(r);
    insertKey(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function next() {
    if (phase === 'checkpoint' && round) insertKey(round);
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
      space: () => (phase === 'checkpoint' ? next() : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const m = round?.size ?? size;
  const P = round?.limit ?? limit;
  const K = round?.target ?? keysFor(size, load);
  const table = round?.table ?? emptyTable(m);
  const red = useMemo(() => redSlots(table, P), [table, P]);
  const dist = useMemo(() => distances(table), [table]);
  const redN = red.filter(Boolean).length;
  const q = redN / m;
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const stored = round?.stored ?? 0;
  const fillNow = useMemo(() => (round && phase !== 'over' ? fillChanceFrom(table, K, P) : fillChance(m, K, P)), [round, phase, table, K, P, m]);

  // The panel's settings (always the chosen ones, even mid-round).
  const pickK = keysFor(size, load);
  const pickFill = fillChance(size, pickK, limit);
  const vol = volatilityOf({ size, limit, load });

  let status = `Ready · ${K} keys, probe ≤ ${P}`;
  if (phase === 'probing') status = q === 0 ? `Key ${stored + 1} of ${K} · free` : `Probing key ${stored + 1} of ${K}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${stored} of ${K} keys`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${stored} of ${K}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';
  const started = !!round;

  return (
    <GameLayout
      name="Probe"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={`${pickK} of ${size} filled at the end`}>Table slots</Label>
          <Chips
            label="Table slots"
            options={SIZES.map((v) => ({ value: v, label: v }))}
            value={size}
            disabled={live}
            onChange={(v) => change(() => setSize(v))}
          />

          <Label hint={<VolBadge level={vol} />}>Probe limit</Label>
          <Chips
            label="Probe limit"
            options={LIMITS.map((v) => ({ value: v, label: `≤ ${v}`, title: `A key may slide at most ${v} slot${v === 1 ? '' : 's'} past its home` }))}
            value={limit}
            disabled={live}
            onChange={(v) => change(() => setLimit(v))}
          />

          <Label hint={`load ${LOAD_LABEL[load]}`}>Keys to store</Label>
          <Chips
            label="Keys to store"
            options={LOADS.map((v) => ({ value: v, label: keysFor(size, v), title: `Fill ${LOAD_LABEL[v]} of the table` }))}
            value={load}
            disabled={live}
            onChange={(v) => change(() => setLoad(v))}
          />

          <dl className="og-stats">
            <dt>Chance to fill</dt>
            <dd>{fmtChance(pickFill)}</dd>
            <dt>Typical full prize</dt>
            <dd>{fmtMult(RTP / pickFill)}</dd>
            <dt>Max prize</dt>
            <dd>{fmtMult(maxMultiplier(size, pickK, limit))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={next}>
                Insert key · {fmtChance(1 - q)} safe
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'probing' ? 'Probing…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={
          started
            ? [
                {
                  label: 'Next key safe',
                  value: live ? fmtChance(1 - q) : '—',
                  sub: live ? (redN === 0 ? 'no red slots' : `${m - redN}/${m} slots safe`) : `${stored} of ${K} keys`,
                  tone: 'chance',
                },
                { label: 'Cash out now', value: fmtMult(cash), sub: formatAmount(stake * cash, 2), tone: 'cash' },
                {
                  label: 'If it lands safe',
                  value: live ? fmtMult(cash / (1 - q)) : '—',
                  sub: live ? `key ${stored + 1} of ${K}` : 'round over',
                  tone: 'prize',
                },
              ]
            : [
                { label: 'Chance to fill', value: fmtChance(fillNow), sub: `${K} keys, probe ≤ ${P}`, tone: 'chance' },
                { label: 'Cash out now', value: '—', sub: `bet ${formatAmount(stake, 2)}`, tone: 'cash' },
                { label: 'Typical full prize', value: fmtMult(RTP / fillNow), sub: `${K} of ${m} slots`, tone: 'prize' },
              ]
        }
      />

      <Board className={'probe-board' + (narrow ? ' narrow' : '')}>
        <Ring
          svgRef={svgRef}
          m={m}
          limit={P}
          target={K}
          table={table}
          red={red}
          dist={dist}
          stored={stored}
          newest={round?.newest ?? null}
          flight={flight}
          token={token}
          started={started}
          live={live}
          redCount={redN}
          fillNow={fillNow}
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
            placement={narrow ? 'inline' : 'center'}
          />
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={1 - q}
          label="Next key lands safe"
          note={`A slot's number is how far a key hashed there would slide. Above ${P} it overflows: those slots are red, each 1/${m} of the ring.`}
        />
      ) : (
        <Caption>
          Linear probing: each key takes the first free slot at or after its hash, sliding at most {P}. Counting parking functions, {K} keys
          into {m} slots all fit {fmtChance(fillChance(m, K, P))} of the time. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Probe" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Store every key in a ring-shaped hash table. Each key may slide only a few slots past the slot it hashes to. Store them all and the round pays
              out; one key that can't find room in time loses it.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the table size, the probe limit (how far a key may slide) and how many keys to store, then bet.</li>
              <li>
                Each key hashes to a random slot, its home. If the home is taken it probes forward, one slot at a time, to the first empty one. Keys that
                can't overflow (no red slots) go in by themselves.
              </li>
              <li>When there is risk, the round pauses: cash out (C), or insert the next key (Space).</li>
              <li>Store the target number of keys and the round pays out automatically.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Every slot is an equal share of the ring, and a key is equally likely to hash to any of them. The number in a full slot is how far a key
              hashed there would slide. Slots whose number is bigger than the probe limit are{' '}
              <b style={{ color: 'var(--red)' }}>red</b>: the home and the next slots are all full, so a key hashed there overflows. The red share of the
              ring is exactly the chance that the next key loses the round.
            </p>
            <p>
              Clusters of full slots only grow. When a key fills the single gap between two clusters they merge into one long run and the red count jumps:
              Knuth's primary clustering.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Linear probing and parking functions (Knuth; Konheim and Weiss). Let f<sub>P</sub>(c) count the hash sequences that fill a block of c slots
              with every probe ≤ P. Splitting on the slot the last key fills, f<sub>P</sub>(c) = Σ<sub>j</sub> C(c−1, j) f<sub>P</sub>(j) f
              <sub>P</sub>(c−1−j) (min(j, P) + 1); with no limit this is (c+1)<sup>c−1</sup>, the parking functions. Cutting the ring at its m − K empty
              slots gives the exact chance that K keys all fit:
            </p>
            <p>
              P(fill) = m/(m−K) · K! [x<sup>K</sup>] F<sub>P</sub>(x)<sup>m−K</sup> / m<sup>K</sup>, where F<sub>P</sub>(x) = Σ f<sub>P</sub>(c) x
              <sup>c</sup>/c!.
            </p>
            <p>The same split, with the keys already stored held fixed, gives the live "fill chance from here" in the middle of the ring.</p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Inserting a key while r of the m slots are red multiplies your cash-out by m/(m−r). Each key is therefore a fair bet, free keys change
              nothing, and the round is worth {(RTP * 100).toFixed(0)}% of your stake however and whenever you cash out. The red count can never exceed the
              keys stored minus the limit, which caps the prize at the "Max prize" shown in the panel.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
