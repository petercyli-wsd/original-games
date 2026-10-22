import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  InstantResult,
  Label,
  ModeTabs,
  PanelFoot,
  StageTop,
  fmtChance,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  BOARD,
  DRAWS,
  MAX_MULTIPLIER,
  MAX_PICKS,
  RISKS,
  RISK_LABEL,
  RTP,
  TOTAL_DRAWS,
  countHits,
  payRows,
  playKeno,
  profitChance,
  randomPicks,
  topPayout,
  type Risk,
} from './math';

interface Last {
  id: number;
  hits: number;
  multiplier: number;
  stake: number;
}

const NUMBERS = Array.from({ length: BOARD }, (_, i) => i + 1);

/** Compact odds for the paytable cells: "23.1%", "0.52%", "1 in 12k", "1 in 848M". */
function shortChance(p: number): string {
  if (p >= 0.001) return fmtChance(p);
  const n = 1 / p;
  if (n < 1e4) return `1 in ${Math.round(n).toLocaleString('en-US')}`;
  if (n < 1e6) return `1 in ${Math.round(n / 1e3)}k`;
  return `1 in ${(n / 1e6).toFixed(n < 1e8 ? 1 : 0)}M`;
}
/** Exact multiplier text: tables are set to the cent, so never round them away ("1,011.60×"). */
const fmtX = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '×';
const fmtAmt = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longOdds = (p: number) => (p <= 0 ? 'never' : `1 in ${Math.round(1 / p).toLocaleString('en-US')}`);

function Gem() {
  return (
    <svg className="kn-gem" viewBox="0 0 40 40" aria-hidden="true">
      <polygon points="20,2 38,20 20,38 2,20" className="g0" />
      <polygon points="20,2 29,20 20,38 11,20" className="g1" />
      <polygon points="20,2 38,20 29,20" className="g2" />
      <polygon points="2,20 11,20 20,38" className="g3" />
    </svg>
  );
}

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [risk, setRisk] = useState<Risk>('classic');
  const [picks, setPicks] = useState<number[]>([]);
  const [drawn, setDrawn] = useState<number[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [repick, setRepick] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [fullFlash, setFullFlash] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  const resolved = useRef(0);
  // The draw is fixed before the animation starts, so leaving mid-draw settles
  // the ticket at that round's real result (read from a ref, never stale).
  const ticket = useTicket(() => resolved.current);

  const n = picks.length;
  const rows = payRows(risk, n);
  const stepMs = turbo.turbo ? 24 : 95;

  async function playOnce(stake: number): Promise<number | null> {
    const count = repick && auto.mode === 'auto' ? picks.length || MAX_PICKS : 0;
    if (count === 0 && picks.length === 0) return null;
    if (!(await ticket.place(stake))) return null;
    const round = playKeno(rng, risk, picks, count);
    resolved.current = round.multiplier;
    setPicks(round.picks);
    setDrawn([]);
    setLast(null);
    setHover(null);
    setDrawing(true);
    for (let i = 0; i < DRAWS; i++) {
      if (!(await timers.wait(stepMs))) return null;
      setDrawn(round.drawn.slice(0, i + 1));
    }
    await timers.wait(turbo.turbo ? 60 : 220);
    ticket.settle(round.multiplier);
    pushHistory(round.multiplier);
    setLast({ id: ++seq.current, hits: round.hits, multiplier: round.multiplier, stake });
    setDrawing(false);
    return round.multiplier;
  }

  const auto = useAutoBet({ bet, play: playOnce, turbo: turbo.turbo });
  const busy = drawing || auto.running;
  const canBet = !busy && !bet.blocked && n > 0;

  /** Any edit after a round clears the drawn numbers and the result. */
  function clearResult() {
    if (drawn.length || last) {
      setDrawn([]);
      setLast(null);
    }
  }

  function toggle(num: number) {
    if (busy) return;
    clearResult();
    if (picks.includes(num)) setPicks(picks.filter((x) => x !== num));
    else if (picks.length < MAX_PICKS) setPicks([...picks, num]);
    else setFullFlash((f) => f + 1);
  }
  const autoPick = () => {
    if (busy) return;
    clearResult();
    setPicks(randomPicks(rng, picks.length || MAX_PICKS));
  };
  const clearTable = () => {
    if (busy) return;
    clearResult();
    setPicks([]);
  };
  const changeRisk = (r: Risk) => {
    clearResult();
    setRisk(r);
  };

  useHotkeys({ space: () => (auto.mode === 'manual' && canBet ? void playOnce(bet.value) : undefined) }, !infoOpen);

  // Letter shortcuts: A = auto pick, X = clear the table.
  const keys = useRef({ autoPick, clearTable });
  keys.current = { autoPick, clearTable };
  useEffect(() => {
    if (infoOpen) return;
    const onDown = (e: KeyboardEvent) => {
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.key === 'a' || e.key === 'A') keys.current.autoPick();
      else if (e.key === 'x' || e.key === 'X') keys.current.clearTable();
    };
    window.addEventListener('keydown', onDown);
    return () => window.removeEventListener('keydown', onDown);
  }, [infoOpen]);

  // "Max 10 picks" hint fades after a moment.
  const [showFull, setShowFull] = useState(false);
  useEffect(() => {
    if (!fullFlash) return;
    setShowFull(true);
    const id = window.setTimeout(() => setShowFull(false), 1400);
    return () => clearTimeout(id);
  }, [fullFlash]);

  const liveHits = countHits(picks, drawn);
  const done = !!last && !drawing;
  const markHits = drawing || done ? liveHits : null;
  const focus = hover ?? (markHits !== null ? markHits : n > 0 ? n : null);
  const focusRow = focus !== null && focus <= n ? rows[focus] : null;
  const latest = drawn[drawn.length - 1];

  const status = drawing
    ? `Drawing… ${drawn.length}/${DRAWS}`
    : last
      ? `${last.hits} ${last.hits === 1 ? 'hit' : 'hits'} · ${fmtX(last.multiplier)}`
      : n === 0
        ? `Pick 1–${MAX_PICKS} numbers`
        : `${n} picked · up to ${fmtX(topPayout(risk, n))}`;

  return (
    <GameLayout
      name="Keno"
      accent="#eab308"
      panel={
        <>
          <ModeTabs auto={auto} disabled={drawing} />
          <BetField bet={bet} disabled={busy} />

          <Label>Risk</Label>
          <Chips label="Risk" options={RISKS.map((r) => ({ value: r, label: RISK_LABEL[r] }))} value={risk} onChange={changeRisk} disabled={busy} />

          <div className="kn-pick-row">
            <ActionButton kind="secondary" disabled={busy} onClick={autoPick} title="Pick random numbers (A)">
              Auto pick
            </ActionButton>
            <ActionButton kind="secondary" disabled={busy || n === 0} onClick={clearTable} title="Clear the table (X)">
              Clear table
            </ActionButton>
          </div>

          <dl className="og-stats">
            <dt>Picks</dt>
            <dd>
              {n} / {MAX_PICKS}
            </dd>
            <dt>Chance of profit</dt>
            <dd>{n ? fmtChance(profitChance(risk, n)) : '–'}</dd>
            <dt>Top payout</dt>
            <dd>{n ? fmtX(topPayout(risk, n)) : '–'}</dd>
            <dt>RTP</dt>
            <dd>{(RTP * 100).toFixed(2)}%</dd>
          </dl>

          {auto.mode === 'manual' ? (
            <ActionButton disabled={!canBet} onClick={() => void playOnce(bet.value)}>
              {drawing ? 'Drawing…' : n === 0 ? 'Pick numbers to bet' : 'Bet'}
            </ActionButton>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || drawing || (n === 0 && !repick)}>
              <Label hint={repick ? `${n || MAX_PICKS} random each bet` : n ? `${n} ${n === 1 ? 'number' : 'numbers'}` : 'pick numbers first'}>Numbers each bet</Label>
              <Chips
                label="Numbers each bet"
                options={[
                  { value: 'keep', label: 'Keep picks' },
                  { value: 'new', label: 'New random' },
                ]}
                value={repick ? 'new' : 'keep'}
                onChange={(v) => setRepick(v === 'new')}
                disabled={auto.running}
              />
            </AutoBetControls>
          )}
          {bet.blocked && <p className="kn-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={drawing ? 'live' : last ? (last.multiplier >= 1 ? 'won' : 'lost') : 'idle'} history={history} />

      <Board className="kn-board">
        {done && last && (
          <div className={'kn-result-wrap' + (last.multiplier >= 1 ? ' win' : ' lose')}>
            <InstantResult multiplier={last.multiplier} stake={last.stake} id={last.id} />
          </div>
        )}
        <div className="kn-wrap">
          <div className={'kn-grid' + (showFull ? ' full' : '')} role="group" aria-label="Keno board">
            {NUMBERS.map((num) => {
              const picked = picks.includes(num);
              const isDrawn = drawn.includes(num);
              const cls =
                'kn-tile' +
                (picked && isDrawn ? ' hit' : isDrawn ? ' miss' : picked ? ' picked' : '') +
                (done && picked && !isDrawn ? ' dim' : '') +
                (num === latest && drawing ? ' fresh' : '');
              return (
                <button
                  key={num}
                  type="button"
                  className={cls}
                  aria-pressed={picked}
                  aria-label={`${num}${picked ? ', picked' : ''}${isDrawn ? ', drawn' : ''}`}
                  disabled={busy}
                  onClick={() => toggle(num)}
                >
                  {picked && isDrawn && <Gem />}
                  <span>{num}</span>
                </button>
              );
            })}
            {showFull && <div className="kn-full">Max {MAX_PICKS} picks</div>}
          </div>

          <div className="kn-rail" aria-label="Drawn numbers">
            {Array.from({ length: DRAWS }, (_, i) => {
              const d = drawn[i];
              return (
                <span key={i} className={'kn-ball' + (d === undefined ? '' : picks.includes(d) ? ' hit' : ' miss')}>
                  {d ?? ''}
                </span>
              );
            })}
          </div>
        </div>
      </Board>

      <div className="kn-table">
        {n === 0 ? (
          <p className="kn-empty">
            Pick 1–{MAX_PICKS} numbers on the board (or press <b>Auto pick</b>) to see the payout and chance for every hit count.
          </p>
        ) : (
          <>
            <div className="kn-pay" style={{ '--n': n + 1, '--m': n + 1 > 6 ? Math.ceil((n + 1) / 2) : n + 1 } as CSSProperties} onMouseLeave={() => setHover(null)}>
              {rows.map((r) => (
                <button
                  key={r.hits}
                  type="button"
                  className={
                    'kn-cell' +
                    (r.multiplier >= 1 ? ' pays' : r.multiplier > 0 ? ' part' : '') +
                    (markHits === r.hits ? (drawing ? ' live' : r.multiplier >= 1 ? ' won' : ' lost') : '') +
                    (focus === r.hits ? ' focus' : '')
                  }
                  onMouseEnter={() => setHover(r.hits)}
                  onFocus={() => setHover(r.hits)}
                  onBlur={() => setHover(null)}
                  onClick={() => setHover(r.hits)}
                  aria-label={`${r.hits} hits pays ${fmtX(r.multiplier)}, chance ${fmtChance(r.chance)}`}
                >
                  <b>{fmtX(r.multiplier)}</b>
                  <small className="kn-odds">{shortChance(r.chance)}</small>
                  <span className="kn-hits">
                    {r.hits}
                    <i aria-hidden="true" />
                  </span>
                </button>
              ))}
            </div>
            {focusRow && (
              <div className="kn-detail">
                <div>
                  <span>{focusRow.hits} {focusRow.hits === 1 ? 'hit' : 'hits'} pays</span>
                  <b className={focusRow.multiplier >= 1 ? 'g' : focusRow.multiplier > 0 ? 'p' : 'r'}>{fmtX(focusRow.multiplier)}</b>
                </div>
                <div>
                  <span>Profit</span>
                  <b>
                    {bet.value * focusRow.multiplier - bet.value >= 0 ? '+' : '−'}
                    {fmtAmt(Math.abs(bet.value * focusRow.multiplier - bet.value))}
                  </b>
                </div>
                <div>
                  <span>Chance</span>
                  <b title={longOdds(focusRow.chance)}>{shortChance(focusRow.chance)}</b>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {infoOpen && (
        <InfoModal title="Keno" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Pick up to {MAX_PICKS} of the {BOARD} numbers. {DRAWS} numbers are then drawn. The more of your picks that are drawn (hits), the bigger the
              payout.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Click numbers to pick them (1 to {MAX_PICKS}), or press Auto pick for a random set. Clear table removes your picks.</li>
              <li>Choose a risk: Low pays small amounts often, High pays only on many hits but much more. Classic sits in between.</li>
              <li>Press Bet (or Space). Ten numbers are drawn one by one: green gems are hits, red numbers were drawn but not picked.</li>
              <li>Auto runs a series of bets on your picks, or on fresh random numbers each bet, with your own stop rules.</li>
              <li>Shortcuts: Space bet, A auto pick, X clear table.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The table under the board lists every possible hit count for your number of picks, with its payout and its exact chance. Hover or tap a cell
              for the profit at your bet. During the draw the live hit count is highlighted.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The draw is a uniform choice of {DRAWS} of {BOARD} numbers, so there are C({BOARD}, {DRAWS}) = {TOTAL_DRAWS.toLocaleString('en-US')} equally
              likely draws. With n picks, the chance of exactly k hits is hypergeometric:
            </p>
            <p className="kn-formula">
              P(k) = C(n, k) · C({BOARD} − n, {DRAWS} − k) / C({BOARD}, {DRAWS})
            </p>
            <p>Which numbers you pick makes no difference, only how many.</p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Each of the 40 tables (4 risks × 10 pick counts) is set to the cent so that Σ P(k) × payout(k) is exactly {(RTP * 100).toFixed(2)}%. Risk
              and the number of picks change only how the return is spread, never its size. The largest prize on any table is {fmtX(MAX_MULTIPLIER)} (10 of 10).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
