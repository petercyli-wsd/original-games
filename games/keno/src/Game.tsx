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
  Label,
  ModeTabs,
  PanelFoot,
  Readouts,
  StageTop,
  type ReadoutItem,
  eventMs,
  fmtChance,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import {
  BOARD,
  DRAWS,
  MAX_MULTIPLIER,
  MAX_PICKS,
  RISKS,
  RISK_LABEL,
  RTP,
  TOTAL_DRAWS,
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
  const [fullFlash, setFullFlash] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  const resolved = useRef(0);
  // The draw is fixed before the animation starts, so leaving mid-draw settles
  // the ticket at that round's real result (read from a ref, never stale).
  const ticket = useTicket(() => resolved.current);

  const n = picks.length;

  async function playOnce(stake: number): Promise<number | null> {
    const count = repick && auto.mode === 'auto' ? picks.length || MAX_PICKS : 0;
    if (count === 0 && picks.length === 0) return null;
    if (!(await ticket.place(stake))) return null;
    // Manual: a number is drawn about every 160 ms so the ten draws read one by one; Turbo and Auto are about 4x faster.
    const fast = turbo.turbo || auto.mode === 'auto';
    const stepMs = eventMs(fast, 160);
    const round = playKeno(rng, risk, picks, count);
    resolved.current = round.multiplier;
    setPicks(round.picks);
    setDrawn([]);
    setLast(null);
    setDrawing(true);
    for (let i = 0; i < DRAWS; i++) {
      if (!(await timers.wait(stepMs))) return null;
      setDrawn(round.drawn.slice(0, i + 1));
    }
    await timers.wait(eventMs(fast, 200));
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

  const latest = drawn[drawn.length - 1];
  const tableN = n || MAX_PICKS;

  const status = drawing
    ? `Drawing… ${drawn.length}/${DRAWS}`
    : last
      ? `${last.hits} ${last.hits === 1 ? 'hit' : 'hits'} · ${fmtX(last.multiplier)}`
      : n === 0
        ? `Pick 1–${MAX_PICKS} numbers`
        : `${n} picked`;

  // One chance and one payout (docs/STYLE.md §6); the full table is in How to play.
  const readouts: ReadoutItem[] = [
    { label: 'Chance of profit', value: n ? fmtChance(profitChance(risk, n)) : '–', tone: 'chance' },
    { label: 'Top payout', value: n ? fmtX(topPayout(risk, n)) : '–', tone: 'prize' },
  ];

  return (
    <GameLayout
      name="Keno"
      accent={ACCENTS.violet}
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

      <Readouts items={readouts} />

      <Board className="kn-board">
        <div className="kn-wrap">
          <div className="kn-grid" role="group" aria-label="Keno board">
            {NUMBERS.map((num) => {
              const picked = picks.includes(num);
              const isDrawn = drawn.includes(num);
              const cls = 'kn-tile' + (picked && isDrawn ? ' hit' : isDrawn ? ' drawn' : picked ? ' picked' : '') + (num === latest && drawing ? ' latest' : '');
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
                  {num}
                </button>
              );
            })}
            {showFull && <div className="kn-full">Max {MAX_PICKS} picks</div>}
          </div>
        </div>
      </Board>
      <Caption>Win when enough of your picks are among the {DRAWS} numbers drawn.</Caption>

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
              <li>Press Bet (or Space). Ten numbers are drawn one by one: a green number is a hit (a pick that was drawn), a grey number was drawn but not picked.</li>
              <li>Auto runs a series of bets on your picks, or on fresh random numbers each bet, with your own stop rules.</li>
              <li>Shortcuts: Space bet, A auto pick, X clear table.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Your picks are marked in colour; drawn numbers fill in as they come up, green where they match a pick. "Chance of profit" above the board is the
              chance of any hit count that pays more than your bet. The table lists every hit count for {RISK_LABEL[risk]} risk with {tableN}{' '}
              {tableN === 1 ? 'pick' : 'picks'}.
            </p>
            <table className="kn-paytable">
              <thead>
                <tr>
                  <th>Hits</th>
                  <th>Pays</th>
                  <th>Chance</th>
                </tr>
              </thead>
              <tbody>
                {payRows(risk, tableN).map((r) => (
                  <tr key={r.hits}>
                    <td>{r.hits}</td>
                    <td>{fmtX(r.multiplier)}</td>
                    <td>{shortChance(r.chance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
