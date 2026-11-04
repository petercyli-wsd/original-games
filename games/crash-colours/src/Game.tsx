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
  Label,
  ModeTabs,
  PanelFoot,
  Readouts,
  VolBadge,
  ACCENTS,
  eventMs,
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
  crashPoint,
  multAt,
  multiplierOf,
  payoutOf,
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
  mult: number;
}

const parseStake = (t: string) => {
  const v = Number(t.trim());
  return Number.isFinite(v) && v >= 0 ? v : NaN;
};

const fmtX = (x: number) => (x >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toFixed(2)) + '×';
const fmtPay = (x: number) => (Math.abs(x * 100 - Math.round(x * 100)) < 1e-9 ? x.toFixed(2) : x.toFixed(4)) + '×';
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
    await climb(crash, eventMs(fast, CLIMB_MS));
    ticket.settle(mult);
    live.current = false;
    if (!alive.current) return mult;
    setHist((h) => [{ id, crash, mult }, ...h].slice(0, 16));
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
  const setStake = (b: Band, t: string) => {
    setTexts((s) => ({ ...s, [b]: t }));
    if (phase === 'over') clearBoard();
  };
  const scaleOne = (b: Band, f: number) => {
    const v = parseStake(texts[b]);
    setStake(b, formatAmount(Number.isNaN(v) ? 0 : Math.min(balance, v * f), 2));
  };

  // ---------- what the board shows ----------
  const shownLines = round && phase !== 'idle' ? round.lines : lines;
  const shownStakes = round && phase !== 'idle' ? round.stakes : invalid ? { red: 0, green: 0, moon: 0 } : stakes;
  const shownStaked: Record<Band, boolean> = { red: shownStakes.red > 0, green: shownStakes.green > 0, moon: shownStakes.moon > 0 };

  const safeStakes = invalid ? { red: 0, green: 0, moon: 0 } : stakes;
  const winChance = total > 0 ? anyWinChance(safeStakes, lines) : 0;
  const vol = total > 0 ? volatilityOf(safeStakes, lines) : 'medium';

  const winText = (r: Round) => {
    const w = winners(r.crash, r.lines);
    const names = BANDS.filter((b) => w[b]).map((b) => NAMES[b]);
    return `${names.join(' + ')} ${names.length > 1 ? 'win' : 'wins'}`;
  };
  // The round's result in words (the crash point itself is the hero number on the graph).
  const resultText = (r: Round) => {
    const net = payoutOf(r.stakes, r.crash, r.lines) - r.total;
    const back = net + r.total;
    const you =
      Math.abs(net) < 0.005
        ? `${formatAmount(r.total, 2)} back`
        : net > 0
          ? `+${formatAmount(net, 2)}`
          : back > 0
            ? `${formatAmount(back, 2)} of ${formatAmount(r.total, 2)} back`
            : `−${formatAmount(r.total, 2)}`;
    return `${winText(r)} · ${you}`;
  };
  const status = phase === 'live' ? 'In flight…' : phase === 'over' && round ? resultText(round) : 'Pick your colours';
  const tone = phase === 'live' ? 'live' : phase === 'over' && round ? (round.mult > 1.0000001 ? 'won' : round.mult === 0 ? 'lost' : 'idle') : 'idle';

  return (
    <GameLayout
      name="Crash Colours"
      accent={ACCENTS.pink}
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
                  ×
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
          <Label hint={<VolBadge level={vol} />}>Moon line</Label>
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
                Each auto bet stakes the mix above. On win / on loss scale all three together.
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
            <span key={h.id} className={'og-hist ' + (h.mult > 1.0000001 ? 'w' : h.mult > 0 ? 'p' : 'l')}>
              {fmtX(h.crash)}
            </span>
          ))}
        </div>
      </div>

      <Readouts items={[{ label: 'Chance of any return', value: fmtChance(winChance), tone: 'chance' }]} />

      <Board className="cc-board">
        <Graph m={m} phase={phase} lines={shownLines} staked={shownStaked} />
      </Board>
      <Caption>Win if the crash lands in a colour band you backed.</Caption>

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
              <li>Enter a stake for any of the three colours (leave a colour at 0 to skip it). ½, 2× and × (clear) adjust each one.</li>
              <li>Pick the green line (1.50×, 2.00× or 3.00×) and the moon line (5× to 1,000×).</li>
              <li>Press Bet or Space. The curve climbs through the bands. Space during the climb skips to the result.</li>
              <li>Auto runs a series of bets with the same mix; on win / on loss scale all three stakes together.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The graph's height is probability, not the multiplier: each colour band is exactly as tall as its chance. Red is everything under the green
              line, Green is everything above it, and Moon is the top slice above the moon line (so a Moon finish wins Green too). The multipliers on the
              right show where each value falls on that scale. As the line climbs, the part below it is shaded: those rounds would already have crashed.
              A bar down the left edge of a band marks the colours you backed. The stage shows your chance of any return for the current stakes.
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
              point is drawn before the climb starts (C = 1.00× about 2% of the time). Those instant crashes count as Red, which is why Red's chance at the
              2× line is 50.5% rather than 50%, and why it pays a little less than Green's 2×. The largest payout is 1,000× (Moon at the 1,000× line).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
