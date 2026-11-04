import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  Caption,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  InstantResult,
  Label,
  ModeTabs,
  PanelFoot,
  Readouts,
  StageTop,
  VolBadge,
  eventMs,
  fmtChance,
  fmtMult,
  fmtOneIn,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import WheelBoard, { type WheelRefs } from './Board';
import { MAX_MULTIPLIER, RISKS, RTP, SEGMENTS, segmentFor, spin, tableFor, volatilityOf, type Risk, type Segments } from './math';

const RISK_LABEL: Record<Risk, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const ACCENT = ACCENTS.amber;
// The spin is one event: ~1.2 s in Manual, a quarter of that with Turbo.
const SPIN_MS = 1200;
const TURNS = 3;
const TURNS_TURBO = 2;

interface Last {
  id: number;
  index: number;
  multiplier: number;
  stake: number;
}

/** The wheel angle (degrees, clockwise) that puts the middle of segment 0 under the pointer. */
const idleAngle = (n: number) => -180 / n;

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const [history, pushHistory] = useHistory(14);

  const [risk, setRisk] = useState<Risk>('medium');
  const [segments, setSegments] = useState<Segments>(30);
  const [spinning, setSpinning] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  const table = tableFor(risk, segments);
  const vol = volatilityOf(risk, segments);

  const resolved = useRef(0);
  const spinningRef = useRef(false);
  const ticket = useTicket(() => (spinningRef.current ? resolved.current : 0));

  // ---- Wheel animation: one rAF loop turns the wheel to the drawn segment. ----
  const wheelEl = useRef<SVGGElement>(null);
  const liveEl = useRef<SVGTextElement>(null);
  const refs = useMemo<WheelRefs>(() => ({ wheel: wheelEl, live: liveEl }), []);
  const angle = useRef(idleAngle(segments));
  const alive = useRef(true);
  const raf = useRef(0);

  const apply = (deg: number) => wheelEl.current?.setAttribute('transform', `rotate(${deg.toFixed(3)} 200 200)`);

  useLayoutEffect(() => apply(angle.current));
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelAnimationFrame(raf.current);
    };
  }, []);

  /** Segment under the pointer when the wheel is turned by `deg`. */
  const underPointer = (deg: number, n: number) => segmentFor((((-deg % 360) + 360) % 360) / 360, n);

  function turnTo(target: number, ms: number, t = table): Promise<boolean> {
    return new Promise((resolve) => {
      const from = angle.current;
      const t0 = performance.now();
      let idx = -1;
      const frame = (now: number) => {
        if (!alive.current) return resolve(false);
        const x = Math.min(1, (now - t0) / ms);
        // Quartic ease-out: a fast launch that settles smoothly onto the segment.
        const e = 1 - Math.pow(1 - x, 4);
        const deg = from + (target - from) * e;
        angle.current = deg;
        apply(deg);
        const k = underPointer(deg, t.segments);
        if (k !== idx) {
          idx = k;
          if (liveEl.current) liveEl.current.textContent = fmtMult(t.layout[k]);
        }
        if (x < 1) raf.current = requestAnimationFrame(frame);
        else resolve(true);
      };
      raf.current = requestAnimationFrame(frame);
    });
  }

  /** One full round: debit, draw the segment, spin to it, settle. */
  async function play(stake: number): Promise<number | null> {
    if (spinningRef.current) return null;
    if (!(await ticket.place(stake))) return null;
    const t = table;
    const r = spin(() => rng.next(), t);
    resolved.current = r.multiplier;
    spinningRef.current = true;
    setSpinning(true);

    const s = 360 / t.segments;
    const landAt = (r.index + r.offset) * s; // wheel-frame angle that must end under the pointer
    const from = angle.current;
    const base = (((-landAt - from) % 360) + 360) % 360;
    const target = from + base + 360 * (turbo.turbo ? TURNS_TURBO : TURNS);
    await turnTo(target, eventMs(turbo.turbo, SPIN_MS), t);
    angle.current = ((target % 360) + 360) % 360;
    apply(angle.current);

    ticket.settle(r.multiplier);
    spinningRef.current = false;
    if (!alive.current) return r.multiplier;
    pushHistory(r.multiplier);
    setLast({ id: ++seq.current, index: r.index, multiplier: r.multiplier, stake });
    setSpinning(false);
    return r.multiplier;
  }

  const auto = useAutoBet({ bet, play, turbo: turbo.turbo });
  const locked = spinning || auto.running;

  const manualSpin = () => {
    if (auto.mode !== 'manual' || locked || bet.blocked) return;
    void play(bet.value);
  };

  // Changing a setting clears the board to an idle preview of the new wheel.
  const changeSettings = (r: Risk, n: Segments) => {
    if (locked) return;
    setRisk(r);
    setSegments(n);
    setLast(null);
    angle.current = idleAngle(n);
    apply(angle.current);
  };

  useHotkeys(
    {
      space: () => {
        if (auto.mode === 'manual') manualSpin();
        else if (auto.running) auto.stop();
        else if (!bet.blocked && !spinning) auto.start();
      },
    },
    !infoOpen,
  );

  // Letter / digit shortcuts: L, M, H pick the risk; 1–5 pick 10–50 segments.
  const keyState = useRef({ risk, segments, changeSettings });
  keyState.current = { risk, segments, changeSettings };
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = keyState.current;
      const rk = ({ l: 'low', m: 'medium', h: 'high' } as Record<string, Risk>)[e.key.toLowerCase()];
      if (rk) return k.changeSettings(rk, k.segments);
      const d = Number(e.key);
      if (d >= 1 && d <= 5) k.changeSettings(k.risk, SEGMENTS[d - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  const status = spinning ? 'Spinning…' : last ? `Landed ${fmtMult(last.multiplier)}` : `${RISK_LABEL[risk]} risk · ${segments} segments`;
  const tone = spinning ? 'live' : last ? (last.multiplier > 0 ? 'won' : 'lost') : 'idle';
  const top = table.entries[table.entries.length - 1];

  return (
    <GameLayout
      name="Wheel"
      accent={ACCENT}
      className="wheel"
      panel={
        <>
          <ModeTabs auto={auto} disabled={spinning} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={vol} />}>Risk</Label>
          <Chips<Risk>
            label="Risk"
            value={risk}
            disabled={locked}
            onChange={(r) => changeSettings(r, segments)}
            options={RISKS.map((r) => ({ value: r, label: RISK_LABEL[r], title: `Hit rate ${fmtChance(tableFor(r, segments).chanceHit)} · top ${fmtMult(tableFor(r, segments).max)}` }))}
          />

          <Label hint={<><b>{segments}</b> segments</>}>Segments</Label>
          <Chips<Segments>
            label="Segments"
            value={segments}
            disabled={locked}
            onChange={(n) => changeSettings(risk, n)}
            options={SEGMENTS.map((n) => ({ value: n, label: n, title: `${n} segments · top ${fmtMult(tableFor(risk, n).max)}` }))}
          />

          {auto.mode === 'manual' ? (
            <ActionButton disabled={locked || !!bet.blocked} onClick={manualSpin}>
              {spinning ? 'Spinning…' : 'Bet'}
            </ActionButton>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || spinning} />
          )}
          {bet.blocked ? <p className="wh-blocked">{bet.blocked}</p> : null}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Win chance', value: fmtChance(table.chanceHit), tone: 'chance' },
          { label: 'Top prize', value: fmtMult(top.mult), tone: 'prize' },
        ]}
      />

      <Board className="wh-board">
        <div className="wh-wrap">
          <WheelBoard table={table} landed={last && !spinning ? last.index : null} spinning={spinning} refs={refs} />
          <InstantResult multiplier={last && !spinning ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />
        </div>
      </Board>

      <Caption>The segment under the pointer when the wheel stops pays its multiplier.</Caption>

      {infoOpen && (
        <InfoModal title="Wheel" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Spin the wheel. You win the multiplier on the segment that stops under the pointer at the top.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Set your bet, a risk level (Low, Medium or High) and the number of segments (10 to 50).</li>
              <li>Press Bet or Space to spin. The landed segment stays outlined, green if you profit and red if you lose, and the result shows in the history row; press Bet again whenever you like.</li>
              <li>Use Auto for a series of spins with stop-on-profit, stop-on-loss and on-win / on-loss stake changes. Space starts and stops it.</li>
              <li>Shortcuts: L, M and H set the risk; 1 to 5 set 10 to 50 segments. Turbo shortens the spin. Settings lock while the wheel turns.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              All segments are the same size and equally likely, so a multiplier printed on c of the N segments wins with chance c ÷ N: exactly its share
              of the rim. Each segment is labelled with its multiplier, and segments that pay 0× are the darker ones.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The stopping segment is uniform on N segments, so the return is the wheel’s average multiplier: RTP = (1/N) · Σ multiplierᵢ = Σ m · count(m) ÷
              N. Every table is written in hundredths so that Σ (100·m) · count(m) = 99 · N exactly, with no rounding.
            </p>
            <p>
              Low risk repeats 1.20× ×7, 1.50× ×1, 0× ×2 per ten segments (8.4 + 1.5 = 9.9). Medium alternates 0× with 1.5×–5× prizes. High has one
              jackpot paying 0.99 × N ({fmtMult(0.99 * segments)} here) and 0× elsewhere.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              {RISK_LABEL[risk]} risk, {segments} segments:
            </p>
            <table className="wh-paytable">
              <thead>
                <tr>
                  <th>Pays</th>
                  <th>Segments</th>
                  <th>Chance</th>
                </tr>
              </thead>
              <tbody>
                {table.entries.map((e) => (
                  <tr key={e.hundredths}>
                    <td>{fmtMult(e.mult)}</td>
                    <td>
                      {e.count} of {segments}
                    </td>
                    <td>
                      {fmtChance(e.prob)} <small>({fmtOneIn(e.prob)})</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              All 15 risk and segment settings return exactly {(RTP * 100).toFixed(2)}% of stakes in the long run; they change only the spread, from an 80%
              hit rate (Low) to 1 in 50 (High, 50 segments). The largest prize is {fmtMult(MAX_MULTIPLIER)}. The segment is drawn when you bet and the
              wheel simply turns to it; if you leave mid-spin the bet still settles at that result.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
