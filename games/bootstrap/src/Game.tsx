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
import Field from './Board';
import {
  RTP,
  SEEDS,
  SIZES,
  addSeed,
  allMask,
  cashOut,
  nextSeed,
  pFull,
  prizeFor,
  startChance,
  volatilityOf,
  waves,
  type Settings,
  type Side,
  type Size,
  type State,
} from './math';

type Phase = 'idle' | 'dropping' | 'checkpoint' | 'over';
type Outcome = 'cashed' | 'full' | 'held' | 'stuck';

interface Round {
  s: Settings;
  stake: number;
  st: State;
  cash: number;
  outcome: Outcome | null;
}

const SIDE_NAME: Record<Side, string> = { full: 'Full grid', not: 'Not full' };

function outcomeTitle(r: Round): string {
  if (r.outcome === 'cashed') return 'Cashed out';
  if (r.outcome === 'full') return 'Whole grid infected';
  if (r.outcome === 'stuck') return 'Grid can’t fill';
  return 'Grid held';
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [n, setN] = useState<Size>(5);
  const [k, setK] = useState(7);
  const [side, setSide] = useState<Side>('full');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [shown, setShown] = useState(0);
  const [fresh, setFresh] = useState(0);
  const [landing, setLanding] = useState<number | null>(null);
  // While a seed lands and spreads, the odds on screen stay at the pre-drop value.
  const [pHeld, setPHeld] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // A seed in flight is decided when it starts, so leaving mid-animation
  // settles at its real result, never at the pre-drop value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'dropping' ? resolved.current : round?.cash ?? 0));

  const dropMs = turbo.turbo ? 140 : 560;
  const waveMs = turbo.turbo ? 45 : 170;
  const live = phase === 'dropping' || phase === 'checkpoint';
  const settings: Settings = { n, k, side };

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setLanding(null);
    setFresh(0);
    setPHeld(null);
    setPhase('over');
  }

  async function drop(r: Round) {
    const { s, st } = r;
    const cell = nextSeed(st, s.n, rng.next());
    const next = addSeed(st, cell, s.n);
    const a = next.seeds.length;
    const pf = pFull(next.C, a, s.n, s.k);
    const p = s.side === 'full' ? pf : 1 - pf;
    const cash = p === 1 ? prizeFor(s) : cashOut(s, next.C, a);
    resolved.current = cash;
    setPHeld(pFull(st.C, st.seeds.length, s.n, s.k));
    setPhase('dropping');
    setLanding(cell);
    setFresh(0);
    if (!(await timers.wait(dropMs))) return;

    // The seed lands, then the infection spreads wave by wave.
    let S = st.C | (1 << cell);
    setLanding(null);
    setRound({ ...r, st: { seeds: next.seeds, C: st.C } });
    setShown(S);
    for (const w of waves(S, s.n)) {
      if (!(await timers.wait(waveMs))) return;
      S |= w;
      setShown(S);
      setFresh(w);
    }
    if (!(await timers.wait(waveMs))) return;

    const done: Round = { ...r, st: next, cash };
    setPHeld(null);
    if (next.C === allMask(s.n)) return finish(done, 'full', cash);
    if (pf === 0) return finish(done, a === s.k ? 'held' : 'stuck', cash);
    if (a === s.k) return finish(done, 'held', cash);
    setRound(done);
    setFresh(0);
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: cash, winChance: p });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { s: settings, stake: bet.value, st: { seeds: [], C: 0 }, cash: RTP, outcome: null };
    setRound(r);
    setShown(0);
    void drop(r);
  }

  function cashOutNow() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setShown(0);
    setFresh(0);
    setLanding(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  function changeSize(v: Size) {
    change(() => {
      setN(v);
      // Keep the seed count if it's offered on the new grid, else the nearest one.
      const opts = SEEDS[v];
      if (!opts.includes(k)) setK(opts.reduce((b, x) => (Math.abs(x - k) < Math.abs(b - k) ? x : b)));
    });
  }

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? void drop(round) : !live ? void start() : undefined),
      cashOut: cashOutNow,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const s = round?.s ?? settings;
  const st = round?.st ?? { seeds: [], C: 0 };
  const a = st.seeds.length;
  const pf = phase === 'dropping' && pHeld !== null ? pHeld : pFull(phase === 'idle' ? 0 : st.C, phase === 'idle' ? 0 : a, s.n, s.k);
  const p = s.side === 'full' ? pf : 1 - pf;
  const prize = prizeFor(s);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const vol = volatilityOf(settings);
  const finalFull = phase === 'over' && round ? round.st.C === allMask(s.n) : null;

  let status = `Ready · ${s.k} seeds on ${s.n}×${s.n} · ${SIDE_NAME[s.side]}`;
  if (phase === 'dropping') status = `Seed ${Math.min(a + (landing !== null ? 1 : 0), s.k)} of ${s.k} · spreading`;
  if (phase === 'checkpoint') status = `Checkpoint · ${a} of ${s.k} seeds down`;
  if (phase === 'over' && round?.outcome) status = `${outcomeTitle(round)} · ${a} of ${s.k} seeds`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Bootstrap"
      accent="#caf0f8"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Bet on</Label>
          <Chips
            label="Bet on"
            options={(['full', 'not'] as Side[]).map((v) => ({ value: v, label: SIDE_NAME[v] }))}
            value={side}
            disabled={live}
            onChange={(v) => change(() => setSide(v))}
          />

          <Label>Grid</Label>
          <Chips
            label="Grid size"
            options={SIZES.map((v) => ({ value: v, label: `${v}×${v}` }))}
            value={n}
            disabled={live}
            onChange={changeSize}
          />

          <Label hint={`full grid needs ≥ ${n}`}>Seeds</Label>
          <Chips label="Seeds" options={SEEDS[n].map((v) => ({ value: v, label: v }))} value={k} disabled={live} onChange={(v) => change(() => setK(v))} />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(startChance(settings))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(settings))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOutNow}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && void drop(round)}>
                Drop seed {a + 1} of {s.k}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'dropping' ? 'Spreading…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            value: fmtChance(phase === 'over' ? (round && round.outcome !== 'cashed' ? (round.cash > 0 ? 1 : 0) : p) : p),
            sub: SIDE_NAME[s.side],
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: formatAmount(stake * cash, 2), tone: 'cash' },
          { label: 'Prize', value: fmtMult(prize), sub: s.side === 'full' ? 'if the whole grid falls' : 'if any cell holds out', tone: 'prize' },
        ]}
      />

      <Board>
        <Field
          n={s.n}
          k={s.k}
          seeds={phase === 'idle' ? [] : st.seeds}
          infected={phase === 'idle' ? 0 : phase === 'dropping' ? shown : st.C}
          fresh={fresh}
          landing={landing}
          pFull={pf}
          side={s.side}
          finalFull={finalFull}
          live={live}
        />
        {phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={outcomeTitle(round)}
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
          p={p}
          label={`Win chance · ${SIDE_NAME[s.side]}`}
          note="Exact: every way the remaining seeds can land is counted. The perimeter bar only shrinks between seeds."
        />
      ) : (
        <Caption>
          A healthy cell catches the infection when two of its neighbours have it. The perimeter never grows as it spreads, so a {s.n}×{s.n} grid needs at least{' '}
          {s.n} seeds. With {s.k}, it fills {fmtChance(startChance({ ...s, side: 'full' }))} of the time. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Bootstrap" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Seeds of infection land on random cells of a grid. Infection spreads to any cell with at least two infected neighbours. Bet on whether the whole
              grid ends up infected (Full grid) or some cells hold out (Not full).
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick your side, the grid size and how many seeds will land, then bet.</li>
              <li>Seeds land one at a time and the infection spreads after each. After every seed you can cash out, or drop the next (Space).</li>
              <li>The round settles by itself as soon as the result is certain, or when the last seed has spread.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The <b>split bar</b> under the grid is the exact chance that the grid ends full (left) or not (right); your side is your win chance. The{' '}
              <b>perimeter budget</b> bar is the infected area's outline now plus 4 for every seed still to land. The full grid's outline is 4n, so once the
              budget drops below the marker, a full grid is impossible.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Two-neighbour bootstrap percolation. When a cell joins with two or more infected neighbours, the outline changes by 4 − 2 × (infected neighbours) ≤
              0, so spreading never grows the perimeter and each seed adds at most 4. An n×n grid has perimeter 4n, so it needs at least n seeds.
            </p>
            <p>
              The live chance is exact: P(full) = (ordered ways the remaining seeds fill the grid) / (all ordered ways they can land), counted by recursion over
              the infected shapes. Since spreading is a closure, cl(A ∪ B) = cl(cl(A) ∪ B): spreading after each seed ends exactly where spreading once at the
              end would.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays the fixed prize {(RTP * 100).toFixed(0)}% ÷ P(win at the start). Cash-out is prize × P(win now). Each seed is a fair bet on that value,
              so the round is worth {(RTP * 100).toFixed(0)}% of your stake however and whenever you cash out.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
