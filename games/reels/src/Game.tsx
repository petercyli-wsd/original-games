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
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  Label,
  ModeTabs,
  PanelFoot,
  Readouts,
  Slider,
  StageTop,
  VolBadge,
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
import { Reels, SHAPE_LABEL, SymbolArt } from './Board';
import {
  BUY_SPINS,
  FREE_SPINS,
  FS_CAP,
  FS_MULT,
  LINES,
  PAYING,
  PAYLINES,
  REELS,
  ROWS,
  SCATTER,
  VOLS,
  VOL_LABEL,
  WILD,
  playRound,
  reelSet,
  spinOdds,
  windowAt,
  type ReelSet,
  type Spin,
  type Vol,
} from './math';

const ACCENT = ACCENTS.amber;
const IDLE_STOPS = [3, 11, 19, 27, 5];
const RULE = 'Win by matching symbols from the leftmost reel along a payline.';

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

/** The spin on the reels, for the odds bar: its drawn windows (revealed reel by reel as they stop). */
interface SpinCtx {
  grid: number[][];
  mult: number;
  /** False once the feature has hit its free-spin cap, so scatters add nothing. */
  fsOpen: boolean;
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
  return { text: `Returned ${fmtMoney(won)} (${netTxt})`, tone: 'part' };
}

export default function Game() {
  const { rng } = useHost();
  const balance = useBalance();
  const bet = useBetInput();
  const turbo = useTurbo();
  const [history, pushHistory] = useHistory(14);

  const [vol, setVol] = useState<Vol>('medium');
  const [lines, setLines] = useState(LINES);
  const set = reelSet(vol);

  const [cols, setCols] = useState<number[][]>(() => windowAt(reelSet('medium'), IDLE_STOPS));
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
  const [spinCtx, setSpinCtx] = useState<SpinCtx | null>(null);
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
  async function spinReels(rs: ReelSet, stops: number[], ctx: Omit<SpinCtx, 'grid'>) {
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
    setSpinCtx({ grid, ...ctx });
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
    const paid = buy ? buyCostOf(stake, rs.buyPrice) : stake;
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
      // Free spins already awarded before this one: at the cap, scatters add nothing.
      const before = sp.free ? sp.n + sp.left - sp.awarded : 0;
      await spinReels(rs, sp.stops, { mult: sp.mult, fsOpen: before < FS_CAP });
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
        setBanner({ kind: 'fs', title: `${sp.awarded} free spins`, sub: `${sp.scatterCells.length} scatters · every win ×${FS_MULT}` });
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

    if (round.freeSpins > 0) {
      setBanner({ kind: 'end', title: 'Free spins win', amount: featureWon, spins: round.freeSpins });
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
  const buyCost = buyCostOf(bet.value, set.buyPrice);
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
  const changeSettings = (v: Vol, n: number) => {
    if (locked) return;
    n = Math.min(LINES, Math.max(1, Math.round(n)));
    if (v !== vol) {
      stopsRef.current = IDLE_STOPS;
      setCols(windowAt(reelSet(v), IDLE_STOPS));
    }
    setVol(v);
    setLines(n);
    setSpinCtx(null);
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

  // L / M / H volatility, ← → lines, B buy (press twice), Esc cancels a buy.
  const keyState = useRef({ vol, lines, changeSettings, buy, buyArmed });
  keyState.current = { vol, lines, changeSettings, buy, buyArmed };
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t && (t.tagName === 'INPUT' ? (t as HTMLInputElement).type !== 'range' : t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = keyState.current;
      const key = e.key.toLowerCase();
      const v = ({ l: 'low', m: 'medium', h: 'high' } as Record<string, Vol>)[key];
      if (v && !e.repeat) return k.changeSettings(v, k.lines);
      if (key === 'arrowleft' || key === '-') {
        e.preventDefault();
        return k.changeSettings(k.vol, k.lines - 1);
      }
      if (key === 'arrowright' || key === '+' || key === '=') {
        e.preventDefault();
        return k.changeSettings(k.vol, k.lines + 1);
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
  const scatterHit = !!present && present.spin.scatterCells.length >= 3;
  let lit: Set<string> | null = null;
  if (present && (wins.length || scatterHit)) {
    lit = new Set();
    for (const w of shownWins) for (let r = 0; r < w.count; r++) lit.add(`${r}-${PAYLINES[w.line][r]}`);
    if (scatterHit) for (const [r, row] of present.spin.scatterCells) lit.add(`${r}-${row}`);
  }
  const lineCounts: Record<number, number> = {};
  for (const w of shownWins) lineCounts[w.line] = w.count;
  const lineBet = bet.value / lines;
  const volLevel = vol === 'high' && lines <= 3 ? 'extreme' : vol;

  const result = last ? resultWords(last.won, last.paid) : null;
  const status = busy
    ? feature
      ? feature.n > 0
        ? `Free spin ${feature.n} of ${feature.of} · wins ×${FS_MULT}`
        : 'Free spins!'
      : 'Spinning…'
    : last && result
      ? `${result.text}${last.freeSpins ? ` · ${last.freeSpins} free spins` : ''}`
      : `${VOL_LABEL[vol]} reels · ${lines} line${lines > 1 ? 's' : ''}`;
  const tone = busy ? 'live' : result ? (result.tone === 'part' ? 'idle' : result.tone) : 'idle';

  // ---- The one chance: exact chance this spin pays, given the reels already stopped ----
  const nextOdds = spinOdds(set, lines, 1);
  let stopped = 0;
  if (spinCtx) while (stopped < REELS && !spinningReels[stopped]) stopped++;
  const odds = spinCtx ? spinOdds(set, lines, spinCtx.mult, spinCtx.grid.slice(0, stopped), spinCtx.fsOpen) : nextOdds;
  // After a feature the readout still shows its last free spin, so say so.
  const oddsLabel = !spinCtx ? 'Chance a spin pays' : !busy && last?.freeSpins ? 'Last free spin paid' : 'Chance this spin pays';
  const winLabel = feature ? 'Feature win' : !busy && last?.freeSpins ? 'Total win' : 'Win';
  const winValue = feature ? feature.won : spinWin;

  return (
    <GameLayout
      name="Reels"
      accent={ACCENT} // ACCENTS.amber (docs/STYLE.md)
      className="reels"
      panel={
        <>
          <ModeTabs auto={auto} disabled={busy} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={volLevel} />}>Volatility</Label>
          <Chips<Vol>
            label="Volatility"
            value={vol}
            disabled={locked}
            onChange={(v) => changeSettings(v, lines)}
            options={VOLS.map((v) => ({
              value: v,
              label: VOL_LABEL[v],
              title: `Free spins ${fmtOneIn(reelSet(v).trigger)} · top ${reelSet(v).maxLine}× line bet`,
            }))}
          />

          <Label
            hint={
              <>
                <b>{lines}</b> · line bet {fmtSmall(lineBet)}
              </>
            }
          >
            Lines
          </Label>
          <div className="rl-lines-row">
            <button type="button" className="rl-step" disabled={locked || lines <= 1} onClick={() => changeSettings(vol, lines - 1)} aria-label="Fewer lines">
              −
            </button>
            <Slider label="Lines" value={lines} min={1} max={LINES} onChange={(n) => changeSettings(vol, n)} disabled={locked} />
            <button type="button" className="rl-step" disabled={locked || lines >= LINES} onClick={() => changeSettings(vol, lines + 1)} aria-label="More lines">
              +
            </button>
          </div>

          {auto.mode === 'manual' ? (
            <>
              <ActionButton disabled={(locked && !busy) || (!busy && !!bet.blocked)} onClick={busy ? slam : manualSpin} className="rl-spin">
                {busy ? (spinningReels.some(Boolean) ? 'Stop' : 'Skip') : 'Spin'}
              </ActionButton>
              {buyArmed ? (
                <div className="rl-buy-confirm" role="group" aria-label="Confirm feature buy">
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
                <ActionButton kind="secondary" className="rl-buy" disabled={locked || !!buyBlocked} onClick={buy}>
                  Buy free spins <span>{set.buyPrice}× · {fmtExact(buyCost)}</span>
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || busy}>
              <label className="og-toggle rl-auto-toggle">
                <input type="checkbox" checked={stopOnFeature} disabled={auto.running} onChange={(e) => setStopOnFeature(e.target.checked)} />
                <span>Stop when free spins trigger</span>
              </label>
            </AutoBetControls>
          )}
          {bet.blocked ? <p className="rl-blocked">{bet.blocked}</p> : null}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <ChanceBar p={odds.pays} label={oddsLabel} />

      <Readouts
        items={[
          { label: winLabel, value: fmtMoney(winValue), tone: winValue > 0 ? 'win' : 'neutral' },
        ]}
      />

      <Board className="rl-board">
        <div className="rl-cabinet">
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
            <div className={'rl-banner ' + banner.kind} role="status" onClick={slam}>
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
      </Board>

      <Caption>{RULE}</Caption>

      {infoOpen && (
        <InfoModal title="Reels" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Spin five reels of three symbols. Matching symbols along an active payline, from the leftmost reel, pay a multiple of your line bet; three or
              more scatters anywhere start free spins where every win is doubled.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Set your total bet, a volatility (Low, Medium or High reel set) and how many of the 20 lines to play. Your bet is split evenly across the lines.</li>
              <li>Press Spin or Space. Press again while the reels turn to stop them at once (the result is already decided).</li>
              <li>
                3, 4 or 5 scatters award {FREE_SPINS[3]}, {FREE_SPINS[4]} or {FREE_SPINS[5]} free spins on the same lines with all wins ×{FS_MULT}. Scatters
                during free spins add more (up to {FS_CAP} per feature).
              </li>
              <li>
                Buy free spins starts {BUY_SPINS} free spins straight away for {set.buyPrice}× your bet (click twice, or press B twice, to confirm).
              </li>
              <li>Auto runs a series of spins with stake changes and stop rules; it can also stop when free spins trigger.</li>
              <li>Shortcuts: L / M / H volatility, ← / → lines, B buy. Turbo shortens every animation. Changing a setting clears the board.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Paytable">
            <p>
              Pays are multiples of your line bet ({fmtSmall(lineBet)} now), for 3, 4 or 5 matching symbols from the leftmost reel on the {VOL_LABEL[vol]}{' '}
              reels. Symbols are plain shapes, listed best first.
            </p>
            <table className="rl-pt-table">
              <thead>
                <tr>
                  <th>Symbol</th>
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
                      {SHAPE_LABEL[s]}
                    </td>
                    {[0, 1, 2].map((k) => (
                      <td key={k}>{set.pays[s][k]}×</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              <b>Wild</b> <SymbolArt sym={WILD} className="rl-inline" /> appears on reels 2–4 and stands in for any symbol except the scatter.
            </p>
            <p>
              <b>Scatter</b> <SymbolArt sym={SCATTER} className="rl-inline" /> 3, 4 or 5 anywhere = {FREE_SPINS[3]}, {FREE_SPINS[4]} or {FREE_SPINS[5]} free
              spins, every win ×{FS_MULT}.
            </p>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The chance above the reels is the exact chance that this spin pays anything (line wins or three or more scatters). On the{' '}
              {VOL_LABEL[vol]} reels with {lines} line{lines > 1 ? 's' : ''} a spin pays something {fmtChance(nextOdds.pays)} of the time and more than
              your bet {fmtChance(nextOdds.more)}; free spins start {fmtOneIn(set.trigger)} spins. Winning cells and lines are outlined in green.
            </p>
            <p>
              The reels stop left to right, and after each one the chance is recomputed given the reels already stopped, so you watch it rise (two
              matching reels, a second scatter) or collapse (a dead start). When the last reel stops it is 100% or 0%. More lines raise the chance of
              a win but split the bet thinner, so each win is smaller; the return is the same.
            </p>
            <p>
              Every line has the same odds (each row of a reel shows each symbol as often as it sits on the strip): one line wins {fmtChance(set.lineHit)}{' '}
              of spins. Hover or tap a line number on either side of the reels to draw that line; tap it again to let go.
            </p>
            <div className="rl-paylines">
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
              <b>Lines.</b> With p<sub>i</sub>(s) the share of symbol s on reel i and a<sub>j</sub>(X) = p<sub>j</sub>(X) + p<sub>j</sub>(wild), a line
              starting with X runs at least k reels with probability a<sub>2</sub>(X)···a<sub>k</sub>(X). So one line is worth L = Σ<sub>X</sub> p
              <sub>1</sub>(X) Σ<sub>k</sub> pay(X, k) · P(run = k) line bets, and a spin on n lines is worth n · L · (bet ÷ n) = L · bet whatever n is:
              lines change the spread, never the return.
            </p>
            <p>
              <b>Scatters.</b> Scatters sit at least three apart on every strip, so reel i shows one with probability q<sub>i</sub> = 3 · (scatters on
              strip) ÷ (strip length), independently. The scatter count is the convolution of five Bernoulli(q<sub>i</sub>) variables.
            </p>
            <p>
              <b>Free spins.</b> A free spin is worth {FS_MULT}L and awards μ = E[F(K)] new spins on average, so m awarded spins play m ÷ (1 − μ) spins
              (a geometric series). RTP = L · (1 + μ) ÷ (1 − μ), less a sub-0.0001% correction for the {FS_CAP}-spin cap, which is computed exactly by
              dynamic programming. On these reels: L = {set.lineEv.toFixed(5)}, μ = {set.mu.toFixed(5)}.
            </p>
            <p>
              <b>The chance.</b> The five windows are independent, each uniform over its strip&apos;s stops, so the chance given the reels already stopped is a finite sum
              over the windows still to come. It is computed reel by reel: reel 1 fixes each line&apos;s symbol, and after each reel the state is which
              lines are still running, the line pays already banked and the scatters seen. Windows that let the same lines through are merged; nothing is
              simulated. The chance is a martingale: its value now is the average of its values after the
              next reel.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <table className="rl-rtp-table">
              <thead>
                <tr>
                  <th>Reels</th>
                  <th>Spin RTP</th>
                  <th>Buy</th>
                  <th>Buy RTP</th>
                  <th>Free spins</th>
                </tr>
              </thead>
              <tbody>
                {VOLS.map((v) => {
                  const s = reelSet(v);
                  return (
                    <tr key={v} className={v === vol ? 'on' : ''}>
                      <td>{VOL_LABEL[v]}</td>
                      <td>{(s.rtp * 100).toFixed(3)}%</td>
                      <td>{s.buyPrice}×</td>
                      <td>{(s.buyRtp * 100).toFixed(3)}%</td>
                      <td>{fmtOneIn(s.trigger)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p>
              Every figure above is exact (computed from the strips, not simulated). The buy is priced in tenths of a stake, at or just under the spin’s own
              RTP. One spin pays at most the top 5-of-a-kind on every line ({set.maxLine.toLocaleString('en-US')}× bet on these reels), so a round is bounded
              by {(set.maxSpinRound).toLocaleString('en-US')}× including a full {FS_CAP}-spin feature. Every spin of a round, free spins included, is drawn
              when you bet; the reels only show it, and leaving mid-round still pays the drawn result.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
