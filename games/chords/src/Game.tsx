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
import { Ladder, Odds, Rim, type LadderItem } from './Board';
import {
  PACES,
  RTP,
  TARGETS,
  afterClearChord,
  afterFirstEnd,
  allClear,
  clearChance,
  dart,
  finishChance,
  finishChanceMid,
  isClear,
  maxMultiplier,
  regionIndex,
  regions,
  typicalClear,
  volatilityOf,
  type Chord,
  type Pace,
  type Target,
} from './math';

const ACCENT = '#4cc9f0';

type Phase = 'idle' | 'moving' | 'checkpoint' | 'over';
type Outcome = 'crossed' | 'cashed' | 'full';

interface Round {
  target: Target;
  pace: Pace;
  stake: number;
  /** Chords that landed clear. */
  chords: Chord[];
  /** First end of the chord in progress (mid-chord checkpoint). */
  first: number | null;
  /** Cash-out before the chord in progress. */
  base: number;
  cash: number;
  /** The clear chance Σ L² each drawn chord faced. */
  risks: number[];
  outcome: Outcome | null;
  /** The chord that crossed. */
  bad: Chord | null;
}

const OUTCOME_TITLE: Record<Outcome, string> = { crossed: 'Chords crossed', cashed: 'Cashed out', full: 'Board complete' };
const PACE_LABEL: Record<Pace, string> = { end: 'Every end', chord: 'Every chord' };

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [target, setTarget] = useState<Target>(5);
  const [pace, setPace] = useState<Pace>('end');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  // Animation: the comet's travel, the chord line being drawn and its dot in the pairs square.
  const [spin, setSpin] = useState(0);
  const [flying, setFlying] = useState(false);
  const [flightMs, setFlightMs] = useState(720);
  const [flyFirst, setFlyFirst] = useState<number | null>(null);
  const [drawing, setDrawing] = useState<{ chord: Chord; clear: boolean } | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // A step is decided the moment it starts, so leaving mid-animation settles
  // at its real result, never at the pre-step value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'moving' ? resolved.current : round?.cash ?? 0));

  const spinMs = turbo.turbo ? 200 : 720;
  const drawMs = turbo.turbo ? 90 : 340;
  const live = phase === 'moving' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number, bad: Chord | null = null) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash, bad });
    setFlying(false);
    setPhase('over');
  }

  /** Sends the comet round the rim to p, then runs `then`. */
  function fly(p: number, ms: number, then: () => void) {
    setFlying(true);
    setFlightMs(ms);
    // At least half a turn, ending exactly on p.
    setSpin((s) => {
      const d = (((p - s) % 1) + 1) % 1;
      return s + d + (d < 0.5 ? 1 : 0);
    });
    timers.after(ms, then);
  }

  /** Lands the chord (x, y) on round r, whose pre-chord value is r.base and clear chance S. */
  function land(r: Round, x: number, y: number, S: number) {
    const chord = { a: x, b: y };
    const clear = isClear(r.chords, x, y);
    setFlying(false);
    setDrawing({ chord, clear });
    timers.after(drawMs + (turbo.turbo ? 60 : 180), () => {
      if (!clear) {
        setFlyFirst(null);
        return finish({ ...r, first: x }, 'crossed', 0, chord);
      }
      const chords = [...r.chords, chord];
      const cash = afterClearChord(r.base, S);
      const next: Round = { ...r, chords, first: null, base: cash, cash, risks: [...r.risks, S] };
      setDrawing(null);
      setFlyFirst(null);
      if (chords.length >= r.target) return finish(next, 'full', cash);
      setRound(next);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: clearChance(regions(chords)) });
    });
  }

  /** Draws both ends without stopping (the free first chord, or the "every chord" pace). */
  function drawChord(r: Round) {
    const S = clearChance(regions(r.chords));
    const x = rng.next();
    const y = rng.next();
    const clear = isClear(r.chords, x, y);
    resolved.current = clear ? afterClearChord(r.cash, S) : 0;
    // The free first chord is quick; a full chord in one go is a little quicker than two separate ends.
    const ms = Math.round(spinMs * (r.chords.length === 0 ? 0.5 : 0.8));
    setPhase('moving');
    fly(x, ms, () => {
      setFlyFirst(x);
      fly(y, ms, () => land({ ...r, base: r.cash }, x, y, S));
    });
  }

  /** Drops the first end and stops at the mid-chord checkpoint. */
  function dropFirst(r: Round) {
    const rs = regions(r.chords);
    const S = clearChance(rs);
    const x = rng.next();
    const L = rs[regionIndex(rs, r.chords, x)].length;
    const mid = afterFirstEnd(r.cash, S, L);
    resolved.current = mid;
    setPhase('moving');
    fly(x, spinMs, () => {
      setFlying(false);
      setRound({ ...r, first: x, base: r.cash, cash: mid });
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: mid, winChance: L });
    });
  }

  /** Drops the second end of the chord in progress. */
  function dropSecond(r: Round) {
    if (r.first === null) return;
    const S = clearChance(regions(r.chords));
    const y = rng.next();
    const clear = isClear(r.chords, r.first, y);
    resolved.current = clear ? afterClearChord(r.base, S) : 0;
    setPhase('moving');
    const x = r.first;
    fly(y, spinMs, () => land(r, x, y, S));
  }

  function next() {
    if (phase !== 'checkpoint' || !round) return;
    if (round.first !== null) dropSecond(round);
    else if (round.pace === 'end') dropFirst(round);
    else drawChord(round);
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { target, pace, stake: bet.value, chords: [], first: null, base: RTP, cash: RTP, risks: [], outcome: null, bad: null };
    setRound(r);
    setDrawing(null);
    setFlyFirst(null);
    drawChord(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setDrawing(null);
    setFlyFirst(null);
    setFlying(false);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys({ space: () => (phase === 'checkpoint' ? next() : !live ? void start() : undefined), cashOut }, !infoOpen);

  // ---------- What the board shows ----------
  const t = round?.target ?? target;
  const chords = round?.chords ?? [];
  const rs = regions(chords);
  const S = clearChance(rs);
  const first = round?.first ?? flyFirst;
  // The first end's region is the safe one for the second end (the first chord has nothing to cross).
  const home = first !== null && chords.length > 0 ? regionIndex(rs, chords, first) : null;
  const L = home !== null ? rs[home].length : null;
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const left = t - chords.length;
  const winP = allClear(target);
  const vol = volatilityOf(target);
  const midStop = phase === 'checkpoint' && round?.first !== null && round?.first !== undefined;
  const crossedOver = phase === 'over' && round?.outcome === 'crossed';

  // The live chance to fill the board from here (exact, shown for information).
  const finishP = !round
    ? allClear(t)
    : round.outcome === 'crossed'
      ? 0
      : round.outcome === 'full'
        ? 1
        : home !== null && L !== null && round.first !== null
          ? finishChanceMid(
              rs.map((r) => r.length),
              home,
              left,
            )
          : finishChance(
              rs.map((r) => r.length),
              left,
            );

  let status = `Ready · ${t} chords, none may cross`;
  if (phase === 'moving') status = round?.first !== null || flyFirst !== null ? `Chord ${chords.length + 1} of ${t} · second end` : `Chord ${chords.length + 1} of ${t}`;
  if (phase === 'checkpoint') status = midStop ? `Checkpoint · first end of chord ${chords.length + 1} is down` : `Checkpoint · ${chords.length} of ${t} chords clear`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${chords.length} of ${t} chords clear`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  // The odds panel: the pairs square, with the live quantity above it.
  const dot =
    drawing && round
      ? (() => {
          const d = dart(rs, chords, drawing.chord.a, drawing.chord.b);
          return { u: d.u, v: d.v!, ok: drawing.clear };
        })()
      : null;
  const u = first !== null ? dart(rs, chords, first, null).u : null;
  const odds =
    !round || chords.length === 0
      ? { title: 'First chord', value: 'free', tone: 'idle' as const }
      : L !== null
        ? { title: crossedOver ? 'Second end was safe' : 'Second end safe', value: fmtChance(L), tone: 'safe' as const }
        : { title: 'Next chord clear', value: fmtChance(S), tone: 'chance' as const };

  // The ladder: one pip per chord with its clear chance.
  const ladder: LadderItem[] = Array.from({ length: t }, (_, i) => {
    if (!round) return { state: 'todo', label: i === 0 ? 'free' : `${Math.round(typicalClear(i + 1) * 100)}%` };
    if (i < chords.length) return { state: 'done', label: i === 0 ? 'free' : `${Math.round(round.risks[i] * 100)}%` };
    if (i === chords.length) {
      if (round.outcome === 'crossed') return { state: 'bust', label: `${Math.round(S * 100)}%` };
      if (round.outcome) return { state: 'todo', label: '·' };
      return { state: 'now', label: i === 0 ? 'free' : `${Math.round(S * 100)}%` };
    }
    return { state: 'todo', label: '·' };
  });
  const ladderHead = !round
    ? { left: 'Average chance per chord', right: `product ${fmtChance(winP)}` }
    : round.outcome
      ? { left: `${chords.length} of ${t} chords clear`, right: round.outcome === 'full' ? 'complete' : round.outcome === 'crossed' ? `chord ${chords.length + 1} crossed` : 'cashed out' }
      : { left: `Chord ${chords.length + 1} of ${t}`, right: `finish ${fmtChance(finishP)}` };

  // The readouts.
  const chanceItem = !round
    ? { label: 'Chance to win', value: fmtChance(allClear(t)), sub: `${t} chords, none crossing` }
    : phase === 'over'
      ? {
          label: 'Chords clear',
          value: `${chords.length} / ${t}`,
          sub: round.outcome === 'full' ? 'board complete' : round.outcome === 'crossed' ? `chord ${chords.length + 1} crossed` : 'cashed out',
        }
      : L !== null
        ? { label: 'Second end safe', value: fmtChance(L), sub: `finish ${fmtChance(finishP)}` }
        : { label: 'Next chord clear', value: fmtChance(S), sub: `finish ${fmtChance(finishP)}` };
  const prizeItem = !round
    ? { label: 'Average full prize', value: fmtMult(RTP / allClear(t)), sub: `up to ${fmtMult(maxMultiplier(t))}` }
    : phase === 'over'
      ? { label: 'Average full prize', value: fmtMult(RTP / allClear(t)), sub: `${t} chords, none crossing` }
      : L !== null
        ? { label: 'If it lands safe', value: fmtMult(round.base / S), sub: `chord ${chords.length + 1} of ${t}` }
        : { label: 'If it lands clear', value: fmtMult(cash / S), sub: `chord ${chords.length + 1} of ${t}` };

  const continueLabel = round?.first !== null && round?.first !== undefined ? 'Drop second end' : round?.pace === 'chord' ? 'Draw chord' : 'Drop first end';
  const continueOdds = round?.first !== null && L !== null ? `${fmtChance(L)} safe` : `${fmtChance(S)} clear`;

  return (
    <GameLayout
      name="Chords"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Chords to draw</Label>
          <Chips
            label="Chords to draw"
            options={TARGETS.map((v) => ({ value: v, label: v }))}
            value={target}
            disabled={live}
            onChange={(v) => change(() => setTarget(v))}
          />

          <Label hint="same value either way">Checkpoints</Label>
          <Chips
            label="Checkpoints"
            options={PACES.map((v) => ({ value: v, label: PACE_LABEL[v] }))}
            value={pace}
            disabled={live}
            onChange={(v) => change(() => setPace(v))}
          />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(winP)}</dd>
            <dt>Average full prize</dt>
            <dd>{fmtMult(RTP / winP)}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={next}>
                {continueLabel} · {continueOdds}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'moving' ? 'Drawing…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { ...chanceItem, tone: 'chance' },
          {
            label: phase === 'over' ? 'Paid' : 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub:
              midStop && round
                ? `${formatAmount(stake * cash, 2)} · ${cash >= round.base ? '▲' : '▼'} from ${fmtMult(round.base)}`
                : live || phase === 'over'
                  ? formatAmount(stake * cash, 2)
                  : 'after the free chord',
            tone: 'cash',
          },
          { ...prizeItem, tone: 'prize' },
        ]}
      />

      <Board className="ch-stage">
        <div className="ch-board">
          <div className="ch-rimwrap">
            <Rim
              chords={chords}
              regions={rs}
              first={first}
              home={home}
              drawing={crossedOver ? (round?.bad ?? null) : (drawing?.chord ?? null)}
              crossed={crossedOver || (drawing !== null && !drawing.clear)}
              spin={spin}
              flying={flying}
              spinMs={flightMs}
              drawMs={drawMs}
              preview={round ? null : { target: t, pace }}
              over={phase === 'over'}
            />
          </div>
          <div className="ch-side">
            <Odds
              regions={rs}
              home={home}
              u={u}
              dot={dot ?? (crossedOver && round?.bad ? { ...pick(dart(rs, chords, round.bad.a, round.bad.b)), ok: false } : null)}
              {...odds}
            />
            <Ladder items={ladder} head={ladderHead} />
          </div>
        </div>
        {phase === 'over' && round?.outcome && (
          // Inline under the circle, so the final chords and the crossing stay in view.
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

      {phase === 'over' ? null : live ? (
        L !== null ? (
          <ChanceBar p={L} label="Second end lands safe" note="The green arcs are the first end's region. Land there and the chord crosses nothing." />
        ) : (
          <ChanceBar p={S} label="Next chord lands clear" note="Both ends must land on the same colour: the coloured squares' area is exactly this chance." />
        )
      ) : (
        <Caption>
          Draw {t} random chords with no two crossing. They miss each other with chance Catalan({t}) / ({2 * t - 1})!! = {fmtChance(allClear(t))}. RTP{' '}
          {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Chords" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Chords are drawn across a circle one at a time, each joining two random points of the rim. Draw the number of chords you chose with no two of them
              crossing, and the board pays out.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many chords to draw and where the round should pause, then bet. The first chord is free.</li>
              <li>
                Each chord lands one end at a time. At every checkpoint you can cash out, or carry on (Space). With <b>Every chord</b> the round only pauses
                between chords; with <b>Every end</b> it also pauses after each chord's first end.
              </li>
              <li>If a chord crosses another, the round is lost. When the last chord lands clear, it pays automatically.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The chords cut the circle into regions, each with its own colour on the rim. A new chord crosses nothing exactly when both of its ends land on the
              same colour. A region holding a share L of the rim catches both ends with chance L², so the next chord is clear with chance Σ L².
            </p>
            <p>
              The <b>pairs square</b> draws that literally. Lay the rim out flat, region by region, along both sides: every possible chord is a dot (first end
              across, second end up). The coloured squares on the diagonal are the clear chords, so their area is the chance; the red is crossing. Once the first
              end is down, its region's arcs glow <b style={{ color: 'var(--green)' }}>green</b>: their length is the chance the second end is safe, and in the
              square it is the green part of that column.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The 2N ends of N random chords come in a uniformly random order around the circle, so the chords form a uniformly random pairing of 2N points.
              There are (2N−1)!! = 1·3·5·…·(2N−1) pairings, and the Catalan number C<sub>N</sub> of them are non-crossing, so
            </p>
            <p>
              <b>P(N chords, none crossing) = C<sub>N</sub> / (2N−1)!! = 2<sup>N</sup> / (N+1)!</b>
            </p>
            <p>
              That is 1/3 for 3 chords, 4.44% for 5 and 0.07% for 8. Given k−1 clear chords, chord k is clear with average chance 2/(k+1), which is what the
              ladder shows before you bet. The live chance to finish comes from the same theorem applied inside each region.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Say the cash-out is V before a chord whose clear chance is Σ L². When the first end lands in a region of share L, the cash-out becomes V·L / Σ L²
              (up for a big region, down for a small one). When the second end lands safe it becomes V / Σ L². Each stage is a fair bet, so the cash-out is a
              martingale and the round is worth {(RTP * 100).toFixed(0)}% of your stake however and whenever you cash out, and whichever pace you play.
            </p>
            <p>
              With j regions Σ L² ≥ 1/j (Cauchy–Schwarz), so a chord can at most multiply the cash-out by the number of regions it lands on: the most any round
              can pay is 0.99 × N!.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}

const pick = (d: { u: number; v: number | null }) => ({ u: d.u, v: d.v ?? 0 });
