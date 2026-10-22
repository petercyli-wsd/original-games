import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
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
  Slider,
  StageTop,
  VolBadge,
  fmtChance,
  fmtMult,
  fmtOneIn,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PlinkoBoard, { bucketColour, type BoardRefs } from './Board';
import { along, layoutFor, waypoints, type Waypoint } from './geometry';
import { MAX_ROWS, MIN_ROWS, RTP, exactLabel, resolveDrop, tableFor, volatilityOf, type Risk } from './math';
import { useTickets } from './tickets';

const RISK_LABEL: Record<Risk, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};
/** Balls allowed in flight at once. */
const MAX_IN_FLIGHT = 30;
/** Time per row of fall, normal and turbo (~27%). */
const SEG_MS = 118;
const SEG_TURBO_MS = 32;

interface Flight {
  id: number;
  ticket: number;
  pts: Waypoint[];
  start: number;
  seg: number;
  lastSeg: number;
  bucket: number;
  multiplier: number;
  stake: number;
  done(multiplier: number): void;
}

interface Landed {
  id: number;
  bucket: number;
  multiplier: number;
  stake: number;
}

const PEG_FLASH: Keyframe[] = [
  { transform: 'scale(1.9)', fill: '#ffffff', opacity: 1 },
  { transform: 'scale(1)', fill: '#b9b8c8', opacity: 0.85 },
];
const BUCKET_HIT: Keyframe[] = [
  { transform: 'translateY(0)', filter: 'brightness(1)' },
  { transform: 'translateY(7px)', filter: 'brightness(1.7)', offset: 0.25 },
  { transform: 'translateY(0)', filter: 'brightness(1)' },
];

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const tickets = useTickets();
  const [history, pushHistory] = useHistory(14);

  const [rows, setRows] = useState(16);
  const [risk, setRisk] = useState<Risk>('medium');
  const [balls, setBalls] = useState<number[]>([]);
  const [last, setLast] = useState<Landed | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const table = tableFor(rows, risk);
  const vol = volatilityOf(rows, risk);
  const inFlight = balls.length;

  // ---- Animation: one rAF loop moves every ball along its pre-drawn path. ----
  const flights = useRef(new Map<number, Flight>());
  const pegEls = useRef(new Map<string, SVGCircleElement>());
  const bucketEls = useRef(new Map<number, SVGGElement>());
  const ballEls = useRef(new Map<number, SVGGElement>());
  const raf = useRef(0);
  const seq = useRef(0);
  const alive = useRef(true);

  const refs = useMemo<BoardRefs>(
    () => ({
      peg: (row, j, el) => {
        const key = `${row}:${j}`;
        if (el) pegEls.current.set(key, el);
        else pegEls.current.delete(key);
      },
      bucket: (k, el) => {
        if (el) bucketEls.current.set(k, el);
        else bucketEls.current.delete(k);
      },
      ball: (id, el) => {
        if (el) ballEls.current.set(id, el);
        else ballEls.current.delete(id);
      },
    }),
    [],
  );

  const landRef = useRef<(f: Flight) => void>(() => {});
  landRef.current = (f: Flight) => {
    flights.current.delete(f.id);
    tickets.settle(f.ticket, f.multiplier);
    pushHistory(f.multiplier);
    setLast({
      id: ++seq.current,
      bucket: f.bucket,
      multiplier: f.multiplier,
      stake: f.stake,
    });
    setBalls((ids) => ids.filter((x) => x !== f.id));
    bucketEls.current.get(f.bucket)?.animate(BUCKET_HIT, { duration: 360, easing: 'ease-out' });
    f.done(f.multiplier);
  };

  const tick = useCallback((now: number) => {
    for (const f of flights.current.values()) {
      const pos = (now - f.start) / f.seg;
      const i = Math.floor(pos);
      if (i >= f.pts.length - 1) {
        landRef.current(f);
        continue;
      }
      if (i < 0) continue;
      while (f.lastSeg < i) {
        f.lastSeg++;
        const p = f.pts[f.lastSeg].peg;
        if (p) pegEls.current.get(`${p.row}:${p.j}`)?.animate(PEG_FLASH, { duration: 300, easing: 'ease-out' });
      }
      const at = along(f.pts[i], f.pts[i + 1], pos - i, i === 0);
      ballEls.current.get(f.id)?.setAttribute('transform', `translate(${at.x.toFixed(2)} ${at.y.toFixed(2)})`);
    }
    raf.current = flights.current.size > 0 && alive.current ? requestAnimationFrame(tick) : 0;
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelAnimationFrame(raf.current);
    };
  }, []);

  /** Drops one ball: debits the stake, draws the whole path now, animates it, settles on landing. */
  async function drop(stake: number): Promise<number | null> {
    if (tickets.count() >= MAX_IN_FLIGHT) return null;
    const placed = await tickets.place(stake, () => resolveDrop(() => rng.next(), rows, risk));
    if (placed === null) return null;
    const { id: ticket, result: r } = placed;
    if (!alive.current) return null; // already settled at r by the unmount cleanup
    return new Promise<number>((done) => {
      const id = ++seq.current;
      flights.current.set(id, {
        id,
        ticket,
        pts: waypoints(layoutFor(rows), r.path),
        start: performance.now(),
        seg: turbo.turbo ? SEG_TURBO_MS : SEG_MS,
        lastSeg: 0,
        bucket: r.bucket,
        multiplier: r.multiplier,
        stake,
        done,
      });
      setBalls((ids) => [...ids, id]);
      if (!raf.current) raf.current = requestAnimationFrame(tick);
    });
  }

  const auto = useAutoBet({ bet, play: drop, turbo: turbo.turbo });
  const settingsLocked = inFlight > 0 || auto.running;
  const full = inFlight >= MAX_IN_FLIGHT;

  const manualDrop = () => {
    if (auto.mode !== 'manual' || auto.running || bet.blocked || full) return;
    void drop(bet.value);
  };

  useHotkeys(
    {
      space: () => {
        if (auto.mode === 'manual') manualDrop();
        else if (auto.running) auto.stop();
        else if (!bet.blocked) auto.start();
      },
    },
    !infoOpen,
  );

  // Changing a setting clears the last result from the board.
  const changeRows = (n: number) => {
    setRows(n);
    setLast(null);
    setFocus(null);
  };
  const changeRisk = (r: Risk) => {
    setRisk(r);
    setLast(null);
    setFocus(null);
  };

  const shown = focus ?? last?.bucket ?? 0;
  const shownMult = table.mults[shown];
  const profit = bet.value * shownMult - bet.value;
  const topChance = table.probs[0] * 2;

  const status =
    inFlight > 0
      ? `${inFlight} ball${inFlight === 1 ? '' : 's'} in flight`
      : last
        ? `Landed ${fmtMult(last.multiplier)}`
        : `${rows} rows · ${RISK_LABEL[risk]} risk`;
  const tone = inFlight > 0 ? 'live' : last ? (last.multiplier >= 1 ? 'won' : 'lost') : 'idle';

  return (
    <GameLayout
      name="Plinko"
      accent="#ec4899"
      className="plinko"
      panel={
        <>
          <ModeTabs auto={auto} disabled={false} />
          <BetField bet={bet} disabled={auto.running} />

          <Label hint={<VolBadge level={vol} />}>Risk</Label>
          <Chips<Risk>
            label="Risk"
            value={risk}
            disabled={settingsLocked}
            onChange={changeRisk}
            options={(['low', 'medium', 'high'] as const).map((r) => ({
              value: r,
              label: RISK_LABEL[r],
              title: `Top prize ${fmtMult(tableFor(rows, r).max)}`,
            }))}
          />

          <Label
            hint={
              <>
                <b>{rows}</b> rows
              </>
            }
          >
            Rows
          </Label>
          <Slider label="Rows" min={MIN_ROWS} max={MAX_ROWS} value={rows} disabled={settingsLocked} onChange={changeRows} />
          <div className="pk-ticks" aria-hidden="true">
            {Array.from({ length: MAX_ROWS - MIN_ROWS + 1 }, (_, i) => (
              <span key={i} className={MIN_ROWS + i === rows ? 'on' : ''}>
                {MIN_ROWS + i}
              </span>
            ))}
          </div>

          {/* Like Stake, the Auto panel carries only the auto settings, so Start, the
              session profit and Turbo all fit at 1280×800. */}
          {auto.mode === 'manual' && (
            <dl className="og-stats">
              <dt>Top prize</dt>
              <dd>{fmtMult(table.max)}</dd>
              <dt>Top prize chance</dt>
              <dd>{fmtOneIn(topChance)}</dd>
              <dt>Chance of profit</dt>
              <dd>{fmtChance(table.chanceProfit)}</dd>
              <dt>RTP</dt>
              <dd>{(RTP * 100).toFixed(2)}%</dd>
            </dl>
          )}

          {auto.mode === 'manual' ? (
            <ActionButton disabled={!!bet.blocked || full} onClick={manualDrop}>
              Bet
            </ActionButton>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked} />
          )}
          {bet.blocked ? (
            <p className="pk-blocked">{bet.blocked}</p>
          ) : auto.mode === 'manual' ? (
            <p className="pk-note center">{full ? `Up to ${MAX_IN_FLIGHT} balls at once` : 'Space drops a ball. Drop as many as you like.'}</p>
          ) : null}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Board className="pk-board">
        <InstantResult multiplier={last ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />
        <PlinkoBoard table={table} balls={balls} landed={last?.bucket ?? null} focus={focus} onFocus={setFocus} refs={refs} />
      </Board>

      <div className="pk-detail" style={{ ['--b' as string]: bucketColour(shown, rows) }} aria-live="polite">
        <div>
          <span>{focus !== null ? 'Bucket' : last ? 'Last bucket' : 'Edge bucket'}</span>
          <b className="pk-swatch">{exactLabel(shownMult)}×</b>
        </div>
        <div>
          <span>Profit on hit</span>
          <b className={profit > 0 ? 'up' : profit < 0 ? 'down' : ''}>
            {profit >= 0 ? '+' : '−'}
            {formatAmount(Math.abs(profit), 2)}
          </b>
        </div>
        <div>
          <span>Chance</span>
          <b>{fmtChance(table.probs[shown])}</b>
          <small>{fmtOneIn(table.probs[shown])}</small>
        </div>
      </div>
      <Caption>Each peg is a fair 50/50 bounce. The bar under each bucket is its exact chance; hover or tap a bucket for details.</Caption>

      {infoOpen && (
        <InfoModal title="Plinko" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Drop a ball through the pegs. It pays the multiplier of the bucket it lands in: big prizes at the edges, smaller ones in the middle.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Set your bet, a risk level (Low, Medium, High) and the number of rows (8 to 16).</li>
              <li>Press Bet or Space to drop a ball. You can drop more while others are still falling; each ball is its own bet.</li>
              <li>Use Auto for a series of drops with stop-on-profit, stop-on-loss and on-win / on-loss stake changes. Space starts and stops it.</li>
              <li>Turbo speeds the balls up. Risk and rows lock while balls are in flight.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The bars under the buckets are drawn to scale: each bar's height is that bucket's exact chance. Hover or tap a bucket to see its multiplier, your
              profit if the ball lands there and its chance.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              With n rows the ball meets one peg per row and bounces left or right with probability ½ each. The bucket is the number of right bounces, so it
              follows the binomial distribution (the Galton board): P(bucket k) = C(n, k) / 2ⁿ. The middle buckets are hit most often, the edges once in 2ⁿ⁻¹
              drops.
            </p>
            <p>
              RTP = Σ C(n, k) · multiplierₖ / 2ⁿ. Each table keeps round prizes everywhere except the centre run of lowest buckets, whose value is solved
              exactly so the sum is 99.00% (e.g. {exactLabel(table.mults[table.plateau[0]])}× here instead of {table.plateauBase}×).
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              {rows} rows, {RISK_LABEL[risk]} risk (buckets mirror, listed from the edge in):
            </p>
            <table className="pk-paytable">
              <thead>
                <tr>
                  <th>From edge</th>
                  <th>Pays</th>
                  <th>Chance each</th>
                </tr>
              </thead>
              <tbody>
                {table.mults.slice(0, Math.floor(rows / 2) + 1).map((m, k) => (
                  <tr key={k}>
                    <td>{k === 0 ? 'Edge' : k === rows / 2 ? 'Centre' : `${k + 1}${['st', 'nd', 'rd'][k] ?? 'th'}`}</td>
                    <td>{exactLabel(m)}×</td>
                    <td>
                      {fmtChance(table.probs[k])} <small>({fmtOneIn(table.probs[k])})</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Every risk and row setting returns exactly {(RTP * 100).toFixed(2)}% of stakes in the long run; the settings change only the spread. The largest
              prize is 1,000× (16 rows, High risk). Each ball's path is drawn when it is dropped and the animation follows it peg by peg; if you leave mid-drop
              the ball still settles at that result.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
