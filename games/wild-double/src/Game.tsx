import { formatAmount } from '@originals/game-sdk';
import { useBalance, useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  Caption,
  ChanceBar,
  GameLayout,
  InfoModal,
  InfoSection,
  Label,
  ModeTabs,
  PanelFoot,
  Readouts,
  Slider,
  StageTop,
  eventMs,
  fmtChance,
  fmtOneIn,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Reels, SymbolArt } from './Board';
import {
  BUY_PRICE,
  BUY_SPINS,
  FS_AWARD,
  FS_CAP,
  FS_MULT,
  LINES,
  MAX_MULTIPLIER,
  PAYING,
  PAYLINES,
  REELS,
  ROWS,
  SCATTER,
  SCATTER_PAY,
  SYMBOL_LABEL,
  WILD,
  WILD_MULT,
  WILD_PAY,
  playRound,
  reelSet,
  spinOdds,
  windowAt,
  type ReelSet,
  type Spin,
} from './math';

const ACCENT = ACCENTS.sky;
const IDLE_STOPS = [3, 11, 19, 27, 5];
const RULE = 'Match 3+ from the left (top symbols 2). Wild doubles.';

interface Last {
  id: number;
  multiplier: number;
  /** Amount paid for the round (stake, or the buy price). */
  paid: number;
  /** Total win in money. */
  won: number;
  freeSpins: number;
}

interface Present {
  spin: Spin;
  lines: number;
  stake: number;
}


interface Feature {
  /** Free spin being played (1-based; 0 before the first). */
  n: number;
  /** Total free spins awarded so far. */
  of: number;
  /** Feature win so far, in money. */
  won: number;
}

type Banner = { kind: 'fs'; title: string; sub: string } | { kind: 'end'; title: string; amount: number; spins: number };

const fmtMoney = (x: number) => formatAmount(x, 2);
const fmtSmall = (x: number) => formatAmount(x, x > 0 && x < 0.1 ? 4 : 2);
/** Feature-buy cost: the exact price × stake, kept to the wallet's 8 decimals (no cent rounding, which would move the RTP at small stakes). */
/** Money to at least 2 decimals, more when needed (e.g. a 0.191 buy cost). */
const fmtExact = (x: number) => {
  const t = x.toFixed(8).replace(/0+$/, '');
  return (t.split('.')[1] ?? '').length > 2 ? t : x.toFixed(2);
};
// Rounded up to the wallet's 8 decimals (never down, which would sell the feature below its price).
const buyCostOf = (stake: number, price: number) => Math.ceil(stake * price * 1e8 - 1e-6) / 1e8;

/** How a round's result reads: a win only when it returns more than was paid. */
function resultWords(won: number, paid: number): { text: string; tone: 'won' | 'part' | 'lost' } {
  const net = won - paid;
  const netTxt = `${net >= 0 ? '+' : '−'}${fmtMoney(Math.abs(net))}`;
  if (won <= 0) return { text: 'No win', tone: 'lost' };
  if (net > 1e-9) return { text: `Won ${fmtMoney(won)} (${netTxt})`, tone: 'won' };
  return { text: `Paid back ${fmtMoney(won)} (${netTxt})`, tone: 'part' };
}

export default function Game() {
  const { rng } = useHost();
  const balance = useBalance();
  const bet = useBetInput();
  const turbo = useTurbo();
  const [history, pushHistory] = useHistory(14);

  const [lines, setLines] = useState(LINES);
  const set = reelSet();

  const [cols, setCols] = useState<number[][]>(() => windowAt(reelSet(), IDLE_STOPS));
  const [spinningReels, setSpinningReels] = useState<boolean[]>(() => new Array(REELS).fill(false));
  const [anticip, setAnticip] = useState<boolean[]>(() => new Array(REELS).fill(false));
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [present, setPresent] = useState<Present | null>(null);
  const [feature, setFeature] = useState<Feature | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [spinWin, setSpinWin] = useState(0);
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const [pinLine, setPinLine] = useState<number | null>(null);
  const [buyArmed, setBuyArmed] = useState(false);
  const [stopOnFeature, setStopOnFeature] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const seq = useRef(0);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const stopsRef = useRef<number[]>(IDLE_STOPS);
  const stripRefs = useRef<(HTMLDivElement | null)[]>([]);
  const anims = useRef<Animation[]>([]);
  const skip = useRef<(() => void) | null>(null);
  const resolved = useRef(0);
  const lastHadFeature = useRef(false);
  const ticket = useTicket(() => (busyRef.current ? resolved.current : 0));

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      anims.current.forEach((a) => a.cancel());
      skip.current?.();
    };
  }, []);

  // Resolves after the next commit's layout phase, before paint, so a reel's
  // long strip and its animation appear in the same frame.
  const commitWaiters = useRef<(() => void)[]>([]);
  useLayoutEffect(() => {
    const w = commitWaiters.current;
    commitWaiters.current = [];
    w.forEach((f) => f());
  });
  const nextCommit = () => new Promise<void>((r) => commitWaiters.current.push(r));

  /** A pause the player can cut short with Space / Stop. */
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t);
        if (skip.current === done) skip.current = null;
        resolve();
      };
      const t = setTimeout(done, ms);
      skip.current = done;
    });

  /** Quick stop: lands every spinning reel now, or skips the current pause. */
  const slam = () => {
    if (anims.current.length) anims.current.forEach((a) => a.finish());
    else skip.current?.();
  };

  const T = (ms: number) => eventMs(turbo.turbo, ms);

  /** Spins all five reels along their real strips to `stops`. */
  async function spinReels(rs: ReelSet, stops: number[]) {
    const grid = windowAt(rs, stops);
    const prev = stopsRef.current;
    const base = T(600);
    const stagger = T(150);
    const suspense = T(900);
    const msPerCell = turbo.turbo ? 26 : 34;
    let seen = 0;
    let extra = 0;
    const durs: number[] = [];
    const anti: boolean[] = [];
    for (let r = 0; r < REELS; r++) {
      anti[r] = seen >= 2;
      if (anti[r]) extra += suspense;
      durs[r] = base + r * stagger + extra;
      if (grid[r].includes(SCATTER)) seen++;
    }
    // Each column is a real run of the strip: the new window on top, the old
    // window at the bottom, so the motion is continuous.
    const longCols = stops.map((s, r) => {
      const strip = rs.strips[r];
      const len = strip.length;
      const target = durs[r] / msPerCell;
      let filler = ((((prev[r] ?? 0) - s) % len) + len) % len;
      while (filler < Math.max(4, target - len / 2)) filler += len;
      return Array.from({ length: filler + ROWS }, (_, i) => strip[(s + i) % len]);
    });
    setCols(longCols);
    setSpinningReels(new Array(REELS).fill(true));
    setAnticip(anti);
    await nextCommit();
    if (!alive.current) return;
    anims.current = longCols.map((col, r) => {
      const n = col.length;
      const from = -((n - ROWS) / n) * 100;
      const over = (0.16 / n) * 100;
      const el = stripRefs.current[r]!;
      const a = el.animate(
        [
          { transform: `translateY(${from}%)`, easing: 'cubic-bezier(0.4, 0.02, 0.32, 1)' },
          { transform: `translateY(${over}%)`, offset: 0.9, easing: 'ease-out' },
          { transform: 'translateY(0)' },
        ],
        { duration: durs[r] },
      );
      void a.finished.then(
        () => {
          if (!alive.current) return;
          setSpinningReels((s) => s.map((v, i) => (i === r ? false : v)));
          setAnticip((s) => s.map((v, i) => (i === r ? false : v)));
        },
        () => {},
      );
      return a;
    });
    await Promise.all(anims.current.map((a) => a.finished.catch(() => undefined)));
    anims.current = [];
    stopsRef.current = stops;
    if (!alive.current) return;
    setCols(grid);
    setSpinningReels(new Array(REELS).fill(false));
    setAnticip(new Array(REELS).fill(false));
  }

  /** One whole round: pay, draw every spin up front, then animate it. */
  async function play(stake: number, buy = false): Promise<number | null> {
    if (busyRef.current) return null;
    const rs = set;
    const n = lines;
    const paid = buy ? buyCostOf(stake, BUY_PRICE) : stake;
    busyRef.current = true;
    if (!(await ticket.place(paid))) {
      busyRef.current = false;
      return null;
    }
    const round = playRound(rs, n, () => rng.next(), buy);
    const won = round.total * stake;
    const mult = won / paid;
    resolved.current = mult;
    lastHadFeature.current = round.freeSpins > 0;

    setBusy(true);
    setBuyArmed(false);
    setPinLine(null);
    setBanner(null);
    setPresent(null);
    setSpinWin(0);

    let featureWon = 0;
    if (buy) {
      setFeature({ n: 0, of: BUY_SPINS, won: 0 });
      setBanner({ kind: 'fs', title: `${BUY_SPINS} free spins`, sub: `Every win ×${FS_MULT}` });
      await pause(T(1500));
      setBanner(null);
    }

    for (let i = 0; i < round.spins.length; i++) {
      if (!alive.current) return mult;
      const sp = round.spins[i];
      setPresent(null);
      if (sp.free) setFeature((f) => (f ? { ...f, n: sp.n } : f));
      await spinReels(rs, sp.stops);
      if (!alive.current) return mult;
      setPresent({ spin: sp, lines: n, stake });
      setSpinWin(sp.win * stake);
      if (sp.free) {
        featureWon += sp.win * stake;
        const total = featureWon;
        setFeature({ n: sp.n, of: sp.n + sp.left, won: total });
      }
      const next = round.spins[i + 1];
      if (!sp.free && sp.awarded) {
        await pause(T(1300));
        setFeature({ n: 0, of: sp.awarded, won: 0 });
        setBanner({ kind: 'fs', title: `${sp.awarded} free spins`, sub: `${sp.scatterCells.length} scatters, every win ×${FS_MULT}` });
        await pause(T(1700));
        setBanner(null);
      } else if (sp.free && sp.awarded) {
        await pause(T(900));
        setBanner({ kind: 'fs', title: `+${sp.awarded} free spins`, sub: 'Retrigger!' });
        await pause(T(1400));
        setBanner(null);
      } else if (next) {
        await pause(T(sp.wins.length ? 950 : 380));
      }
    }
    if (!alive.current) return mult;

    if (round.freeSpins > 0 || round.capped) {
      setBanner({ kind: 'end', title: round.capped ? 'Max win reached' : 'Free spins win', amount: round.freeSpins > 0 ? featureWon : won, spins: round.freeSpins });
      await pause(T(2000));
      setBanner(null);
      setFeature(null);
    }

    ticket.settle(mult);
    busyRef.current = false;
    pushHistory(mult);
    setLast({ id: ++seq.current, multiplier: mult, paid, won, freeSpins: round.freeSpins });
    setSpinWin(won);
    setBusy(false);
    return mult;
  }

  const auto = useAutoBet({
    bet,
    play: async (stake) => {
      const m = await play(stake);
      if (m !== null && stopOnFeature && lastHadFeature.current) auto.stop();
      return m;
    },
    turbo: turbo.turbo,
  });
  const locked = busy || auto.running;
  const buyCost = buyCostOf(bet.value, BUY_PRICE);
  const buyBlocked = bet.blocked ?? (buyCost > balance + 1e-9 ? 'Not enough balance for the feature buy' : undefined);

  // An armed buy disarms after a few seconds.
  useEffect(() => {
    if (!buyArmed) return;
    const t = setTimeout(() => setBuyArmed(false), 6000);
    return () => clearTimeout(t);
  }, [buyArmed]);

  const manualSpin = () => {
    if (auto.mode !== 'manual' || locked || bet.blocked) return;
    void play(bet.value);
  };
  const buy = () => {
    // The buy (and its confirm box) only exists on the Manual tab.
    if (auto.mode !== 'manual' || locked || buyBlocked) return;
    if (!buyArmed) return setBuyArmed(true);
    void play(bet.value, true);
  };

  // Changing a setting clears the board to an idle preview.
  const changeSettings = (n: number) => {
    if (locked) return;
    n = Math.min(LINES, Math.max(1, Math.round(n)));
    setLines(n);
    setLast(null);
    setPresent(null);
    setSpinWin(0);
    setBanner(null);
    setBuyArmed(false);
  };

  useHotkeys(
    {
      space: () => {
        if (auto.running) auto.stop();
        if (busy) return slam();
        if (auto.mode === 'manual') manualSpin();
        else if (auto.running) auto.stop();
        else if (!bet.blocked) auto.start();
      },
    },
    !infoOpen,
  );

  // ← → lines, B buy (press twice), Esc cancels a buy.
  const keyState = useRef({ lines, changeSettings, buy, buyArmed });
  keyState.current = { lines, changeSettings, buy, buyArmed };
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t && (t.tagName === 'INPUT' ? (t as HTMLInputElement).type !== 'range' : t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = keyState.current;
      const key = e.key.toLowerCase();
      if (key === 'arrowleft' || key === '-') {
        e.preventDefault();
        return k.changeSettings(k.lines - 1);
      }
      if (key === 'arrowright' || key === '+' || key === '=') {
        e.preventDefault();
        return k.changeSettings(k.lines + 1);
      }
      if (key === 'b' && !e.repeat) return k.buy();
      if (key === 'escape' && k.buyArmed) setBuyArmed(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  // ---- What the board shows ----
  const wins = present?.spin.wins ?? [];
  const shownWins = wins;
  const scatterHit = !!present && present.spin.scatterWin > 0;
  let lit: Set<string> | null = null;
  if (present && (wins.length || scatterHit)) {
    lit = new Set();
    for (const w of shownWins) for (let r = 0; r < w.count; r++) lit.add(`${r}-${PAYLINES[w.line][r]}`);
    if (scatterHit) for (const [r, row] of present.spin.scatterCells) lit.add(`${r}-${row}`);
  }
  const lineCounts: Record<number, number> = {};
  for (const w of shownWins) lineCounts[w.line] = w.count;
  const lineBet = bet.value / lines;

  const result = last ? resultWords(last.won, last.paid) : null;
  const status = busy
    ? feature
      ? feature.n > 0
        ? `Free spin ${feature.n} of ${feature.of}, wins ×${FS_MULT}`
        : 'Free spins!'
      : 'Spinning…'
    : last && result
      ? `${result.text}${last.freeSpins ? ` · ${last.freeSpins} free spins` : ''}`
      : `${lines} line${lines > 1 ? 's' : ''}, W wild doubles wins`;
  // A result that returns less than the stake is neutral, not green.
  const partial = !busy && result?.tone === 'part';
  const tone = busy ? 'live' : result ? (result.tone === 'part' ? 'idle' : result.tone) : 'idle';

  // ---- The one chance: the exact chance a spin pays anything back. It stays put while the reels turn, so it never jumps. ----
  const nextOdds = spinOdds(set, lines);
  const odds = nextOdds;
  const oddsLabel = 'Chance a spin pays anything';
  // What paid on the spin shown, in words (best line first).
  const why = (() => {
    if (busy || !present) return '';
    const sp = present.spin;
    const parts: string[] = [];
    const w = [...sp.wins].sort((x, y) => y.pay - x.pay)[0];
    if (w) {
      const nm = SYMBOL_LABEL[w.sym];
      parts.push(`${w.count} ${nm}${w.doubled && w.sym !== WILD ? ' + wild ×2' : ''}`);
      if (sp.wins.length > 1) parts.push(`+${sp.wins.length - 1} more`);
    }
    if (sp.scatterWin > 0) parts.push(`${sp.scatterCells.length} scatters`);
    return parts.join(', ');
  })();
  const winLabel = feature ? 'Feature win' : !busy && last?.freeSpins ? 'Total win' : 'Win';
  const winValue = feature ? feature.won : spinWin;

  return (
    <GameLayout
      name="Wild Double"
      accent={ACCENT} // ACCENTS.sky (docs/STYLE.md)
      className="wild-double"
      panel={
        <>
          <ModeTabs auto={auto} disabled={busy} />
          <BetField bet={bet} disabled={locked} />

          <Label
            hint={
              <>
                <b>{lines}</b> · line bet {fmtSmall(lineBet)}
              </>
            }
          >
            Lines
          </Label>
          <div className="wd-lines-row">
            <button type="button" className="wd-step" disabled={locked || lines <= 1} onClick={() => changeSettings(lines - 1)} aria-label="Fewer lines">
              −
            </button>
            <Slider label="Lines" value={lines} min={1} max={LINES} onChange={changeSettings} disabled={locked} />
            <button type="button" className="wd-step" disabled={locked || lines >= LINES} onClick={() => changeSettings(lines + 1)} aria-label="More lines">
              +
            </button>
          </div>

          {auto.mode === 'manual' ? (
            <>
              <ActionButton disabled={(locked && !busy) || (!busy && !!bet.blocked)} onClick={busy ? slam : manualSpin} className="wd-spin">
                {busy ? (spinningReels.some(Boolean) ? 'Stop' : 'Skip') : 'Spin'}
              </ActionButton>
              {buyArmed ? (
                <div className="wd-buy-confirm" role="group" aria-label="Confirm feature buy">
                  <span>
                    Buy {BUY_SPINS} free spins for <b>{fmtExact(buyCost)}</b>?
                  </span>
                  <div>
                    <ActionButton kind="secondary" onClick={() => setBuyArmed(false)}>
                      Cancel
                    </ActionButton>
                    <ActionButton kind="cash" disabled={locked || !!buyBlocked} onClick={buy}>
                      Confirm
                    </ActionButton>
                  </div>
                </div>
              ) : (
                <ActionButton kind="secondary" className="wd-buy" disabled={locked || !!buyBlocked} onClick={buy}>
                  Buy free spins <span>{BUY_PRICE}× · {fmtExact(buyCost)}</span>
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || busy}>
              <label className="og-toggle wd-auto-toggle">
                <input type="checkbox" checked={stopOnFeature} disabled={auto.running} onChange={(e) => setStopOnFeature(e.target.checked)} />
                <span>Stop when free spins trigger</span>
              </label>
            </AutoBetControls>
          )}
          {bet.blocked ? <p className="wd-blocked">{bet.blocked}</p> : null}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <ChanceBar p={odds.pays} label={oddsLabel} />

      <Readouts
        items={[
          { label: winLabel, value: fmtMoney(winValue), tone: winValue > 0 && !partial ? 'win' : 'neutral' },
        ]}
      />

      <Board className="wd-board">
        <div className={'wd-cabinet' + (partial ? ' part' : '')}>
          <Reels
            cols={cols}
            stripRefs={stripRefs}
            lit={busy && spinningReels.some(Boolean) ? null : lit}
            spinning={spinningReels}
            anticip={anticip}
            shownLines={busy && spinningReels.some(Boolean) ? [] : shownWins.map((w) => w.line)}
            lineCounts={lineCounts}
            activeLines={lines}
            hoverLine={busy ? null : (hoverLine ?? pinLine)}
            onHoverLine={setHoverLine}
            onPinLine={(l) => setPinLine((p) => (p === l ? null : l))}
          />
          {banner && (
            <div className={'wd-banner ' + banner.kind} role="status" onClick={slam}>
              {banner.kind === 'fs' ? (
                <>
                  <b>{banner.title}</b>
                  <span>{banner.sub}</span>
                </>
              ) : (
                <>
                  <span>{banner.title}</span>
                  <b>{fmtMoney(banner.amount)}</b>
                  <span>{banner.spins} free spins played</span>
                </>
              )}
            </div>
          )}
        </div>
        <div className={'wd-paytable' + (partial ? ' part' : '')} aria-label="Paytable">
          <div className="wd-pt-head">Pays × line bet: symbols in a row</div>
          <div className="wd-pt-grid">
            {Array.from({ length: PAYING }, (_, s) => (
              <div key={s} className={'wd-pt' + (!busy && shownWins.some((w) => w.sym === s) ? ' on' : '')} title={SYMBOL_LABEL[s]}>
                <SymbolArt sym={s} />
                {[3, 2, 1, 0].filter((k) => set.pays[s][k] > 0).map((k) => (
                  <span key={k}>
                    {k + 2}: {set.pays[s][k]}
                  </span>
                ))}
              </div>
            ))}
          </div>
          <div className="wd-pt-note">
            <span className={!busy && shownWins.some((w) => w.doubled || w.sym === WILD) ? 'on' : ''}>{`Wild W: pays 2+, wins ×${WILD_MULT}`}</span>
            <span className={!busy && scatterHit ? 'on' : ''}>{`Scatter S pays anywhere: ${SCATTER_PAY[2]}× on 2`}</span>
            <span className={!busy && scatterHit ? 'on' : ''}>{`3+ S: ${FS_AWARD} free spins, wins ×${FS_MULT}`}</span>
          </div>
        </div>
      </Board>

      <Caption>{why ? `Paid: ${why}` : RULE}</Caption>

      {infoOpen && (
        <InfoModal title="Wild Double" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Spin five reels of three symbols. Matching symbols along an active payline, from the leftmost reel, pay a multiple of your line bet. A wild
              stands in for any symbol and doubles the win it completes; scatters pay anywhere, and three or more start {FS_AWARD} free spins where every win
              is tripled.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Set your total bet and how many of the 20 lines to play. Your bet is split evenly across the lines.</li>
              <li>Press Spin or Space. Press again while the reels turn to stop them at once (the result is already decided).</li>
              <li>
                3, 4 or 5 scatters award {FS_AWARD} free spins on the same lines with all wins ×{FS_MULT} (a wild-doubled line pays ×{FS_MULT * WILD_MULT}).
                Three or more scatters during free spins add {FS_AWARD} more, up to {FS_CAP} free spins in one feature.
              </li>
              <li>
                Buy free spins starts {BUY_SPINS} free spins straight away for {BUY_PRICE}× your bet (click twice, or press B twice, to confirm).
              </li>
              <li>Auto runs a series of spins with stake changes and stop rules; it can also stop when free spins trigger.</li>
              <li>Shortcuts: ← / → lines, B buy. Turbo shortens every animation. Changing the lines clears the board.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Paytable">
            <p>
              Line pays are multiples of your line bet ({fmtSmall(lineBet)} now). A line pays its leftmost run of one symbol from reel 1; the two highs also
              pay on 2. Symbols are plain shapes, listed best first.
            </p>
            <table className="wd-pt-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>2</th>
                  <th>3</th>
                  <th>4</th>
                  <th>5</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: PAYING }, (_, s) => (
                  <tr key={s}>
                    <td>
                      <SymbolArt sym={s} />
                      {SYMBOL_LABEL[s]}
                    </td>
                    {[0, 1, 2, 3].map((k) => (
                      <td key={k}>{set.pays[s][k] ? `${set.pays[s][k]}×` : '–'}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td>
                    <SymbolArt sym={WILD} />
                    {SYMBOL_LABEL[WILD]}
                  </td>
                  {[2, 3, 4, 5].map((k) => (
                    <td key={k}>{WILD_PAY[k].toLocaleString('en-US')}×</td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p>
              <b>Wild</b> <SymbolArt sym={WILD} className="wd-inline" /> lands on any reel and stands in for every symbol except the scatter. A win that
              includes a wild pays double (×{WILD_MULT}). Wilds also pay on their own from 2 in a row, as in the last row of the table; a line pays the
              larger of the two, never both.
            </p>
            <p>
              <b>Scatter</b> <SymbolArt sym={SCATTER} className="wd-inline" /> pays anywhere on the reels, on top of line wins, × your total bet: 2 scatters{' '}
              {SCATTER_PAY[2]}×, 3 {SCATTER_PAY[3]}×, 4 {SCATTER_PAY[4]}×, 5 {SCATTER_PAY[5]}×. Three or more also start {FS_AWARD} free spins.
            </p>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The chance above the reels is the exact chance that a spin pays anything back (a line win or two or more scatters); some of those pay less than the stake. With {lines} line
              {lines > 1 ? 's' : ''} a spin pays something {fmtChance(nextOdds.pays)} of the time; free spins start {fmtOneIn(set.trigger)} spins. Winning
              cells and lines are outlined in green.
            </p>
            <p>
              The bar holds still while the reels turn, because it is the chance before the spin. More lines raise the chance of a win but split
              the bet thinner, so each win is smaller; the return is the same.
            </p>
            <p>
              Every line has the same odds (each row of a reel shows each symbol as often as it sits on the strip): one line wins {fmtChance(set.lineHit)} of
              spins. Hover or tap a line number on either side of the reels to draw that line; tap it again to let go.
            </p>
            <div className="wd-paylines">
              {PAYLINES.map((p, l) => (
                <svg key={l} viewBox="0 0 50 30" className={l < lines ? 'on' : ''} aria-label={`Line ${l + 1}`}>
                  {Array.from({ length: REELS * ROWS }, (_, i) => (
                    <rect key={i} x={Math.floor(i / ROWS) * 10 + 1} y={(i % ROWS) * 10 + 1} width="8" height="8" className={p[Math.floor(i / ROWS)] === i % ROWS ? 'hit' : ''} />
                  ))}
                  <text x="25" y="29.5" textAnchor="middle">
                    {l + 1}
                  </text>
                </svg>
              ))}
            </div>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              <b>Lines.</b> Reel i has {set.strips.map((s) => s.length).join(', ')} stops (reels 1 to 5). A line&apos;s symbol X is the first non-wild symbol on
              it, and its run is the longest prefix of X or wild. With p<sub>i</sub>(s) the share of symbol s on reel i, the chance the run reaches reel k
              is the product of p<sub>i</sub>(X) + p<sub>i</sub>(wild), so one line is worth L = E[pay] = {set.lineEv.toFixed(5)} line bets, summed
              exactly over every run. A spin on n lines is worth n · L · (bet ÷ n) = L · bet whatever n is: lines change the spread, never the return.
            </p>
            <p>
              <b>Scatters.</b> Scatters sit at least three apart on every strip, so reel i shows one with probability q<sub>i</sub> = 3 · (scatters on strip) ÷
              (strip length), independently. The count K is the convolution of five Bernoulli(q<sub>i</sub>) variables, and the scatter pay is worth S ={' '}
              {set.scatterEv.toFixed(5)} bets per spin, so a spin is worth B = L + S = {set.baseEv.toFixed(5)}.
            </p>
            <p>
              <b>Free spins.</b> A free spin is worth {FS_MULT}B. An award of {FS_AWARD} plays E = {set.expSpins.toFixed(4)} spins on average (exact
              dynamic programming over spins awarded and left, with the {FS_CAP}-spin cap), so the feature is worth F = {FS_MULT} · B · E ={' '}
              {set.featureEv.toFixed(3)} bets and RTP = B + P(3+ scatters) · F.
            </p>
            <p>
              <b>The chance.</b> A line that has not paid after three reels cannot pay later, so which lines pay is settled by the first three windows
              (enumerated exactly, at most 30³ combinations) and the last two reels matter only through their scatters. Nothing is simulated. The chance is
              a martingale: its value now is the average of its values after the next reel.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <table className="wd-rtp-table">
              <thead>
                <tr>
                  <th>Bet</th>
                  <th>RTP</th>
                  <th>Cost</th>
                  <th>Free spins</th>
                </tr>
              </thead>
              <tbody>
                <tr className="on">
                  <td>Spin</td>
                  <td>{(set.rtp * 100).toFixed(2)}%</td>
                  <td>1×</td>
                  <td>{fmtOneIn(set.trigger)}</td>
                </tr>
                <tr>
                  <td>Buy</td>
                  <td>{(set.buyRtp * 100).toFixed(2)}%</td>
                  <td>{BUY_PRICE}×</td>
                  <td>always</td>
                </tr>
              </tbody>
            </table>
            <p>
              Every figure is exact (computed from the strips, not simulated). A round pays at most {MAX_MULTIPLIER.toLocaleString('en-US')}× the amount paid
              and ends the moment it gets there; the RTPs above ignore that cap, which can only lower them. Every spin of a round, free spins included, is
              drawn when you bet; the reels only show it, and leaving mid-round still pays the drawn result.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
