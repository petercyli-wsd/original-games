import { formatAmount } from '@originals/game-sdk';
import { useBalance, useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
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
  VolBadge,
  fmtChance,
  useAutoBet,
  useHotkeys,
  useTicket,
  useTurbo,
  type BetInput,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import Graph, { type Phase } from './Graph';
import {
  BANDS,
  DEFAULT_MOON,
  DEFAULT_SPLIT,
  MOONS,
  RTP,
  SPLITS,
  anyWinChance,
  bandOf,
  chances,
  crashPoint,
  distribution,
  multAt,
  multiplierOf,
  payouts,
  scaleStakes,
  timeAt,
  totalOf,
  volatilityOf,
  winners,
  type Band,
  type Lines,
  type Stakes,
} from './math';

const NAMES: Record<Band, string> = { red: 'Red', green: 'Green', moon: 'Moon' };
const CLIMB_MS = 2600;
const TURBO_CLIMB_MS = 650;

interface Round {
  id: number;
  crash: number;
  stakes: Stakes;
  total: number;
  mult: number;
  lines: Lines;
}

interface Hist {
  id: number;
  crash: number;
  band: Band;
}

const parseStake = (t: string) => {
  const v = Number(t.trim());
  return Number.isFinite(v) && v >= 0 ? v : NaN;
};

const fmtX = (x: number) => (x >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toFixed(2)) + '×';
const fmtPay = (x: number) => (Number.isInteger(x) ? x.toFixed(2) : x.toFixed(4)) + '×';
const condition = (b: Band, l: Lines) => (b === 'red' ? `under ${fmtX(l.split)}` : b === 'green' ? `${fmtX(l.split)} or more` : `${fmtX(l.moon)} or more`);

export default function Game() {
  const { rng } = useHost();
  const balance = useBalance();
  const turbo = useTurbo();

  const [texts, setTexts] = useState<Record<Band, string>>({ red: '0.00', green: '1.00', moon: '0.10' });
  const [split, setSplit] = useState<number>(DEFAULT_SPLIT);
  const [moon, setMoon] = useState<number>(DEFAULT_MOON);
  const [phase, setPhase] = useState<Phase>('idle');
  const [m, setM] = useState(1);
  const [round, setRound] = useState<Round | null>(null);
  const [hist, setHist] = useState<Hist[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);

  const lines: Lines = { split, moon };
  const stakes: Stakes = { red: parseStake(texts.red), green: parseStake(texts.green), moon: parseStake(texts.moon) };
  const invalid = BANDS.some((b) => Number.isNaN(stakes[b]));
  const total = invalid ? 0 : totalOf(stakes);
  const blocked = invalid ? 'Enter a valid stake for each colour' : !(total > 0) ? 'Stake at least one colour' : total > balance + 1e-9 ? 'Not enough balance' : undefined;

  const latest = useRef({ stakes, lines, turbo: turbo.turbo });
  latest.current = { stakes, lines, turbo: turbo.turbo };

  // ---------- the bet ticket and the climb ----------
  const seq = useRef(0);
  const live = useRef(false);
  const resolved = useRef(0);
  const ticket = useTicket(() => (live.current ? resolved.current : 0));
  const skip = useRef(false);
  const raf = useRef(0);
  const pending = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
      cancelAnimationFrame(raf.current);
      pending.current?.();
    },
    [],
  );

  function climb(crash: number, T: number) {
    return new Promise<void>((resolve) => {
      const dur = timeAt(crash, T);
      let t0 = -1;
      pending.current = resolve;
      const tick = (now: number) => {
        if (t0 < 0) t0 = now;
        const t = now - t0;
        if (skip.current || t >= dur) {
          setM(crash);
          pending.current = null;
          resolve();
          return;
        }
        setM(Math.min(crash, multAt(t, T)));
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    });
  }

  async function playOnce(stake: number): Promise<number | null> {
    const { stakes: cur, lines: ls, turbo: fast } = latest.current;
    if (!(totalOf(cur) > 0)) return null;
    const st = scaleStakes(cur, stake);
    if (!(await ticket.place(stake))) return null;
    const crash = crashPoint(rng.next());
    const mult = multiplierOf(st, crash, ls);
    resolved.current = mult;
    live.current = true;
    skip.current = false;
    const id = ++seq.current;
    setRound({ id, crash, stakes: st, total: stake, mult, lines: ls });
    setM(1);
    setPhase('live');
    await climb(crash, fast ? TURBO_CLIMB_MS : CLIMB_MS);
    ticket.settle(mult);
    live.current = false;
    if (!alive.current) return mult;
    setHist((h) => [{ id, crash, band: bandOf(crash, ls) }, ...h].slice(0, 16));
    setPhase('over');
    return mult;
  }

  // ---------- auto-bet: the three stakes move together ----------
  // Auto-bet sees one "bet" (the total). On win / on loss it sets a new total,
  // which scales the mix captured at the start of the run, so the proportions never drift.
  const anchor = useRef<Stakes | null>(null);
  const betProxy: BetInput = {
    text: formatAmount(total, 2),
    value: total,
    blocked,
    setText(t: string) {
      const next = Number(t);
      if (!Number.isFinite(next) || next <= 0) return;
      if (!anchor.current) anchor.current = latest.current.stakes;
      const s = scaleStakes(anchor.current, next);
      setTexts({ red: formatAmount(s.red, 2), green: formatAmount(s.green, 2), moon: formatAmount(s.moon, 2) });
    },
    half() {},
    double() {},
    normalize() {},
  };
  const auto = useAutoBet({ bet: betProxy, play: playOnce, turbo: turbo.turbo });
  useEffect(() => {
    if (!auto.running) anchor.current = null;
  }, [auto.running]);

  const isLive = phase === 'live';
  const busy = isLive || auto.running;

  const startManual = () => {
    if (busy || blocked) return;
    void playOnce(total);
  };
  const onMain = () => {
    if (auto.mode !== 'manual' || auto.running) return;
    if (isLive) skip.current = true;
    else startManual();
  };
  useHotkeys({ space: onMain }, !infoOpen);

  // ---------- settings ----------
  const clearBoard = () => {
    setPhase('idle');
    setRound(null);
    setM(1);
  };
  const changeLines = (next: Partial<Lines>) => {
    if (next.split !== undefined) setSplit(next.split);
    if (next.moon !== undefined) setMoon(next.moon);
    if (phase === 'over') clearBoard();
  };
  const setStake = (b: Band, t: string) => setTexts((s) => ({ ...s, [b]: t }));
  const scaleOne = (b: Band, f: number) => {
    const v = parseStake(texts[b]);
    setStake(b, formatAmount(Number.isNaN(v) ? 0 : Math.min(balance, v * f), 2));
  };

  // ---------- what the board shows ----------
  const shownLines = round && phase !== 'idle' ? round.lines : lines;
  const shownStakes = round && phase !== 'idle' ? round.stakes : invalid ? { red: 0, green: 0, moon: 0 } : stakes;
  const pChance = chances(shownLines);
  const pay = payouts(shownLines);

  function bandState(b: Band): 'idle' | 'pending' | 'won' | 'lost' {
    if (!round || phase === 'idle') return 'idle';
    const ls = round.lines;
    const done = phase === 'over';
    if (b === 'red') return m >= ls.split ? 'lost' : done ? (winners(round.crash, ls).red ? 'won' : 'lost') : 'pending';
    if (b === 'green') return m >= ls.split ? 'won' : done ? 'lost' : 'pending';
    return m >= ls.moon ? 'won' : done ? 'lost' : 'pending';
  }

  const safeStakes = invalid ? { red: 0, green: 0, moon: 0 } : stakes;
  const winChance = total > 0 ? anyWinChance(safeStakes, lines) : 0;
  const bestPay = total > 0 ? Math.max(...distribution(safeStakes, lines).map((o) => o.mult)) * total : 0;
  const vol = total > 0 ? volatilityOf(safeStakes, lines) : 'medium';

  const status = (() => {
    if (phase === 'live') return 'In flight…';
    if (phase === 'over' && round) {
      const w = winners(round.crash, round.lines);
      const names = BANDS.filter((b) => w[b]).map((b) => NAMES[b]);
      return `Crashed at ${fmtX(round.crash)} · ${names.join(' + ')}`;
    }
    return 'Pick your colours';
  })();
  const tone = phase === 'live' ? 'live' : phase === 'over' && round ? (round.mult >= 1 ? 'won' : 'lost') : 'idle';

  return (
    <GameLayout
      name="Crash Colours"
      accent="#ef4444"
      className="cc-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={isLive} />
          <Label hint={`Balance ${formatAmount(balance, 2)}`}>Bet per colour</Label>
          {BANDS.map((b) => (
            <div key={b} className={`cc-stake ${b}`}>
              <div className="cc-stake-head">
                <i aria-hidden="true" />
                <b>{NAMES[b]}</b>
                <span>{condition(b, lines)}</span>
                <em>{fmtPay(payouts(lines)[b])}</em>
              </div>
              <div className="og-bet-row cc-stake-row">
                <input
                  value={texts[b]}
                  inputMode="decimal"
                  aria-label={`${NAMES[b]} stake`}
                  disabled={busy}
                  onChange={(e) => setStake(b, e.target.value)}
                  onBlur={() => {
                    const v = parseStake(texts[b]);
                    setStake(b, formatAmount(Number.isNaN(v) ? 0 : v, 2));
                  }}
                />
                <button type="button" disabled={busy} onClick={() => scaleOne(b, 0.5)} aria-label={`Halve ${NAMES[b]} stake`}>
                  ½
                </button>
                <button type="button" disabled={busy} onClick={() => scaleOne(b, 2)} aria-label={`Double ${NAMES[b]} stake`}>
                  2×
                </button>
                <button type="button" disabled={busy} onClick={() => setStake(b, '0.00')} aria-label={`Clear ${NAMES[b]} stake`}>
                  ✕
                </button>
              </div>
            </div>
          ))}

          <Label hint="Red | Green split">Green line</Label>
          <Chips
            label="Green line"
            options={SPLITS.map((s) => ({ value: s, label: fmtX(s) }))}
            value={split}
            onChange={(v) => changeLines({ split: v })}
            disabled={busy}
          />
          <Label hint={`${fmtChance(RTP / moon)} chance`}>Moon line</Label>
          <div className="cc-moons">
            <Chips
              label="Moon line"
              wrap
              options={MOONS.map((v) => ({ value: v, label: fmtX(v) }))}
              value={moon}
              onChange={(v) => changeLines({ moon: v })}
              disabled={busy}
            />
          </div>

          <dl className="og-stats">
            <dt>Total bet</dt>
            <dd>{formatAmount(total, 2)}</dd>
            <dt>Chance of a return</dt>
            <dd>{fmtChance(winChance)}</dd>
            <dt>Best payout</dt>
            <dd>{formatAmount(bestPay, 2)}</dd>
            <dt>Volatility</dt>
            <dd>
              <VolBadge level={vol} />
            </dd>
          </dl>

          {auto.mode === 'manual' ? (
            isLive ? (
              <ActionButton kind="secondary" className="cc-skip" onClick={() => (skip.current = true)}>
                Skip to result
              </ActionButton>
            ) : (
              <ActionButton disabled={!!blocked} onClick={startManual}>
                Bet {total > 0 ? formatAmount(total, 2) : ''}
              </ActionButton>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!blocked || isLive}>
              <p className="cc-auto-note">
                Each auto bet stakes the mix above
                {total > 0 && (
                  <>
                    {' '}
                    (
                    {BANDS.filter((b) => safeStakes[b] > 0)
                      .map((b) => `${NAMES[b]} ${Math.round((safeStakes[b] / total) * 100)}%`)
                      .join(' · ')}
                    )
                  </>
                )}
                . On win / on loss scale all three together.
              </p>
            </AutoBetControls>
          )}
          {blocked && <p className="cc-blocked">{blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <div className="og-stage-top">
        <span className={`og-status ${tone}`} aria-live="polite">
          {status}
        </span>
        <div className="og-history" aria-label="Recent crash points">
          {hist.map((h) => (
            <span key={h.id} className={`og-hist cc-hist ${h.band}`}>
              {fmtX(h.crash)}
            </span>
          ))}
        </div>
      </div>

      <Board className="cc-board">
        <InstantResult multiplier={phase === 'over' && round ? round.mult : null} stake={round?.total ?? 0} id={round?.id ?? 0} />
        <Graph m={m} phase={phase} lines={shownLines} />
      </Board>

      <div className="cc-bands" aria-label="Colour bands">
        {BANDS.map((b) => {
          const st = bandState(b);
          const s = shownStakes[b];
          return (
            <div key={b} className={`cc-band ${b} ${st}` + (s > 0 ? ' staked' : '')}>
              <div className="cc-band-head">
                <b>{NAMES[b]}</b>
                <span>{fmtChance(pChance[b])}</span>
              </div>
              <div className="cc-band-cond">{condition(b, shownLines)}</div>
              <div className="cc-band-bar" title={`Exact chance ${fmtChance(pChance[b])}`}>
                <i style={{ width: `${pChance[b] * 100}%` }} />
              </div>
              <div className="cc-band-foot">
                <span>Pays {fmtPay(pay[b])}</span>
                <b>{s > 0 ? (st === 'lost' ? `−${formatAmount(s, 2)}` : `${formatAmount(s * pay[b], 2)}`) : 'No bet'}</b>
              </div>
            </div>
          );
        })}
      </div>
      {phase === 'idle' && (
        <Caption>
          Each bar is the band's exact chance. Pay = {(RTP * 100).toFixed(0)}% ÷ chance, so every colour, line and mix returns {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Crash Colours" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A crash multiplier climbs from 1.00× and stops at a random crash point. There is no cash-out: before the climb you back the colour band you think it
              will stop in. <b>Red</b> wins if it crashes under the green line ({fmtX(split)}), <b>Green</b> if it reaches the line, and <b>Moon</b> if it
              reaches the moon line ({fmtX(moon)}). A Moon finish also wins Green.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Enter a stake for any of the three colours (leave a colour at 0 to skip it). ½, 2× and ✕ adjust each one.</li>
              <li>Pick the green line (1.50×, 2.00× or 3.00×) and the moon line (5× to 1,000×).</li>
              <li>Press Bet or Space. The bands light as the curve passes their lines. Space during the climb skips to the result.</li>
              <li>Auto runs a series of bets with the same mix; on win / on loss scale all three stakes together.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Under each band, the filled bar is its exact chance to win. Red and Green always add up to 100%; Moon is a slice of Green. The graph's tinted
              regions are the same three bands on the multiplier axis.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The crash point C follows the crash survival law P(C ≥ x) = 0.99 ÷ x. So Green at line L wins with chance 0.99 ÷ L and pays L; Moon at line M
              wins with chance 0.99 ÷ M and pays M; Red wins with chance 1 − 0.99 ÷ L and pays 0.99 ÷ (1 − 0.99 ÷ L), which is{' '}
              {payouts({ split: 2, moon: 10 }).red.toFixed(4)}× at the classic 2× line. Each band is chance × pay = 0.99, and by linearity of expectation every
              mix of stakes returns 0.99 too.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Return to player is exactly {(RTP * 100).toFixed(0)}% on every colour, every line and every mix; the lines only change the volatility. The crash
              point is drawn before the climb starts (C = 1.00× about 2% of the time). The largest payout is 1,000× (Moon at the 1,000× line).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
