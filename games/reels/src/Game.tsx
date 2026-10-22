import { formatAmount } from '@originals/game-sdk';
import { useBalance, useHost } from '@originals/game-sdk/react';
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
  fmtOneIn,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Reels, SymbolArt, SymbolDefs, lineColour } from './Board';
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
  SYMBOL_LABEL,
  VOLS,
  VOL_LABEL,
  WILD,
  playRound,
  reelSet,
  windowAt,
  winTier,
  type ReelSet,
  type Spin,
  type Vol,
} from './math';

const ACCENT = '#f97316';
const IDLE_STOPS = [3, 11, 19, 27, 5];
const TIER_LABEL = { big: 'Big win', mega: 'Mega win', epic: 'Epic win' } as const;

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

type Banner =
  | { kind: 'fs'; title: string; sub: string }
  | { kind: 'end'; title: string; amount: number; spins: number }
  | { kind: 'big'; tier: 'big' | 'mega' | 'epic'; amount: number; id: number };

const fmtMoney = (x: number) => formatAmount(x, 2);
const fmtSmall = (x: number) => formatAmount(x, x > 0 && x < 0.1 ? 4 : 2);
/** Feature-buy cost: the exact price × stake, kept to the wallet's 8 decimals (no cent rounding, which would move the RTP at small stakes). */
/** Money to at least 2 decimals, more when needed (e.g. a 0.191 buy cost). */
const fmtExact = (x: number) => {
  const t = x.toFixed(8).replace(/0+$/, '');
  return (t.split('.')[1] ?? '').length > 2 ? t : x.toFixed(2);
};
const buyCostOf = (stake: number, price: number) => Math.round(stake * price * 1e8) / 1e8;

/** Counts up to `amount` for the big-win banner. */
function CountUp({ amount, ms }: { amount: number; ms: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const x = Math.min(1, (now - t0) / ms);
      setV(amount * (1 - Math.pow(1 - x, 3)));
      if (x < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [amount, ms]);
  return <>{fmtMoney(v)}</>;
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
  const [cycle, setCycle] = useState(-1);
  const [feature, setFeature] = useState<Feature | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [spinWin, setSpinWin] = useState(0);
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const [buyArmed, setBuyArmed] = useState(false);
  const [stopOnFeature, setStopOnFeature] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [ptOpen, setPtOpen] = useState(false);

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

  const T = (ms: number) => (turbo.turbo ? Math.round(ms * 0.3) : ms);

  /** Spins all five reels along their real strips to `stops`. */
  async function spinReels(rs: ReelSet, stops: number[]) {
    const grid = windowAt(rs, stops);
    const prev = stopsRef.current;
    const base = T(780);
    const stagger = T(190);
    const suspense = T(950);
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
    setBanner(null);
    setPresent(null);
    setCycle(-1);
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
    // Tiers are multiples of what was paid, so a bought feature returning 1.7× is not a "Mega win".
    const tier = winTier(round.multiplier);
    if (tier) setBanner({ kind: 'big', tier, amount: won, id: seq.current });
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

  // The big-win banner clears itself.
  useEffect(() => {
    if (banner?.kind !== 'big') return;
    const t = setTimeout(() => setBanner((b) => (b?.kind === 'big' ? null : b)), turbo.turbo ? 1600 : 3200);
    return () => clearTimeout(t);
  }, [banner, turbo.turbo]);

  // An armed buy disarms after a few seconds.
  useEffect(() => {
    if (!buyArmed) return;
    const t = setTimeout(() => setBuyArmed(false), 6000);
    return () => clearTimeout(t);
  }, [buyArmed]);

  // After a round, cycle the winning lines one by one.
  const nWins = present?.spin.wins.length ?? 0;
  useEffect(() => {
    if (busy || nWins < 2) return;
    const t = setInterval(() => setCycle((c) => (c + 1 >= nWins ? -1 : c + 1)), 1400);
    return () => clearInterval(t);
  }, [busy, nWins, present]);

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
    setLast(null);
    setPresent(null);
    setCycle(-1);
    setSpinWin(0);
    setBanner(null);
    setBuyArmed(false);
  };

  useHotkeys(
    {
      space: () => {
        if (auto.running) auto.stop();
        if (busy) return slam();
        if (banner?.kind === 'big') setBanner(null);
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
  const shownWins = cycle >= 0 && wins[cycle] ? [wins[cycle]] : wins;
  const scatterHit = !!present && present.spin.scatterCells.length >= 3;
  let lit: Set<string> | null = null;
  if (present && (wins.length || scatterHit)) {
    lit = new Set();
    for (const w of shownWins) for (let r = 0; r < w.count; r++) lit.add(`${r}-${PAYLINES[w.line][r]}`);
    if (scatterHit && cycle < 0) for (const [r, row] of present.spin.scatterCells) lit.add(`${r}-${row}`);
  }
  const lineCounts: Record<number, number> = {};
  for (const w of shownWins) lineCounts[w.line] = w.count;
  const lineBet = bet.value / lines;
  const volLevel = vol === 'high' && lines <= 3 ? 'extreme' : vol;

  const status = busy
    ? feature
      ? feature.n > 0
        ? `Free spin ${feature.n} of ${feature.of}`
        : 'Free spins!'
      : 'Spinning…'
    : last
      ? last.won > 0
        ? `Won ${fmtMoney(last.won)}${last.freeSpins ? ` · ${last.freeSpins} free spins` : ''}`
        : 'No win'
      : `${VOL_LABEL[vol]} reels · ${lines} line${lines > 1 ? 's' : ''}`;
  const tone = busy ? 'live' : last ? (last.won > 0 ? 'won' : 'lost') : 'idle';

  let caption: ReactNode;
  if (present && shownWins.length === 1 && wins.length) {
    const w = shownWins[0];
    const amt = w.pay * (present.stake / present.lines) * present.spin.mult;
    caption = (
      <>
        <b style={{ color: lineColour(w.line) }}>Line {w.line + 1}</b>: {w.count} × {SYMBOL_LABEL[w.sym]} pays {w.pay}× line bet
        {present.spin.mult > 1 ? ` ×${present.spin.mult}` : ''} = <b className="rl-gold">{fmtMoney(amt)}</b>
      </>
    );
  } else if (present && wins.length) {
    caption = (
      <>
        {wins.length} winning line{wins.length > 1 ? 's' : ''}
        {scatterHit ? ' plus scatters' : ''} · spin win <b className="rl-gold">{fmtMoney(present.spin.win * present.stake)}</b>
      </>
    );
  } else if (scatterHit) {
    caption = <>{present!.spin.scatterCells.length} scatters: free spins!</>;
  } else {
    caption = (
      <>
        Lines pay left to right from reel 1. Wild stands in on reels 2–4; 3+ scatters anywhere start free spins with every win ×{FS_MULT}.
      </>
    );
  }

  return (
    <GameLayout
      name="Reels"
      accent={ACCENT}
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
              title: `Line wins ${fmtChance(reelSet(v).lineHit)} · free spins ${fmtOneIn(reelSet(v).trigger)} · top ${reelSet(v).maxLine}× line bet`,
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

          {auto.mode === 'manual' && (
          <dl className="og-stats">
            <dt>Each line wins</dt>
            <dd>{fmtChance(set.lineHit)}</dd>
            <dt>Free spins</dt>
            <dd>{fmtOneIn(set.trigger)}</dd>
            <dt>Top line pay</dt>
            <dd>{set.maxLine.toLocaleString('en-US')}× line</dd>
            <dt>RTP</dt>
            <dd>{(set.rtp * 100).toFixed(2)}%</dd>
          </dl>
          )}

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
          {bet.blocked ? (
            <p className="rl-blocked">{bet.blocked}</p>
          ) : auto.mode === 'manual' ? (
            <p className="rl-note">Space spins / stops · L M H volatility · ← → lines · B buy</p>
          ) : null}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Board className="rl-board">
        <SymbolDefs />
        <div className={'rl-cabinet' + (feature ? ' free' : '') + (banner && banner.kind !== 'big' ? ' veiled' : '')}>
          <div className="rl-topbar">
            {feature ? (
              <>
                <span className="rl-fs-tag">Free spins</span>
                <b>
                  {Math.max(feature.n, 0)} / {feature.of}
                </b>
                <span className="rl-mult">×{FS_MULT}</span>
                <span className="rl-fs-won">
                  Feature win <b>{fmtMoney(feature.won)}</b>
                </span>
              </>
            ) : (
              <>
                <span className={'rl-brand' + (last && !busy && banner?.kind !== 'big' ? ' hidden' : '')}>
                  <i />
                  REELS
                  <i />
                </span>
                <span className="rl-topbar-note">
                  {lines} line{lines > 1 ? 's' : ''} · {VOL_LABEL[vol]}
                </span>
              </>
            )}
          </div>
          <Reels
            cols={cols}
            stripRefs={stripRefs}
            lit={busy && spinningReels.some(Boolean) ? null : lit}
            spinning={spinningReels}
            anticip={anticip}
            shownLines={busy && spinningReels.some(Boolean) ? [] : shownWins.map((w) => w.line)}
            lineCounts={lineCounts}
            activeLines={lines}
            hoverLine={busy ? null : hoverLine}
            onHoverLine={setHoverLine}
            free={!!feature}
          />
          <div className="rl-hud">
            <div>
              <span>Bet</span>
              <b>{fmtMoney(bet.value)}</b>
            </div>
            <div className={'rl-hud-win' + (spinWin > 0 ? ' on' : '')}>
              <span>{!busy && last?.freeSpins ? 'Total win' : 'Win'}</span>
              <b key={spinWin}>{fmtMoney(spinWin)}</b>
            </div>
            <div>
              <span>Line bet</span>
              <b>{fmtSmall(lineBet)}</b>
            </div>
          </div>

          {banner && banner.kind !== 'big' && (
            <div className={'rl-banner ' + banner.kind} role="status" onClick={slam}>
              {banner.kind === 'fs' ? (
                <>
                  <SymbolArt sym={SCATTER} className="rl-banner-icon" />
                  <b>{banner.title}</b>
                  <span>{banner.sub}</span>
                </>
              ) : (
                <>
                  <span>{banner.title}</span>
                  <b className="rl-gold">{fmtMoney(banner.amount)}</b>
                  <span>
                    {banner.spins} free spins played
                  </span>
                </>
              )}
            </div>
          )}
          {banner?.kind === 'big' && (
            <div key={banner.id} className={'rl-bigwin ' + banner.tier} role="status" onClick={() => setBanner(null)}>
              <span>{TIER_LABEL[banner.tier]}</span>
              <b>
                <CountUp amount={banner.amount} ms={turbo.turbo ? 600 : 1600} />
              </b>
            </div>
          )}
        </div>
        <InstantResult multiplier={last && !busy && banner?.kind !== 'big' ? last.multiplier : null} stake={last?.paid ?? 0} id={last?.id ?? 0} />
      </Board>

      <Caption>{caption}</Caption>

      <div className={'rl-paytable' + (ptOpen ? ' open' : '')} aria-label="Paytable">
        <div className="rl-pt-head">
          <button type="button" className="rl-pt-toggle" aria-expanded={ptOpen} onClick={() => setPtOpen((o) => !o)}>
            Paytable <i aria-hidden>▾</i>
          </button>
          <span className="rl-pt-title">Pays × line bet</span>
          <span>
            {VOL_LABEL[vol]} reels · line bet {fmtSmall(lineBet)}
          </span>
        </div>
        <div className="rl-pt-grid">
          {Array.from({ length: PAYING }, (_, s) => (
            <div key={s} className={'rl-pt' + (shownWins.some((w) => w.sym === s) ? ' on' : '')} title={SYMBOL_LABEL[s]}>
              <SymbolArt sym={s} />
              <dl>
                {[2, 1, 0].map((k) => (
                  <div key={k}>
                    <dt>{k + 3}</dt>
                    <dd>{set.pays[s][k]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          <div className="rl-pt wild">
            <SymbolArt sym={WILD} />
            <p>
              <b>Wild</b> on reels 2–4, stands in for any symbol but scatter
            </p>
          </div>
          <div className="rl-pt special">
            <SymbolArt sym={SCATTER} />
            <p>
              <b>Scatter</b> 3 · 4 · 5 anywhere = {FREE_SPINS[3]} · {FREE_SPINS[4]} · {FREE_SPINS[5]} free spins, every win ×{FS_MULT}
            </p>
          </div>
        </div>
      </div>

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
          <InfoSection title="Reading the odds">
            <p>
              Each reel stops at a uniformly random point on its strip, and every row of a reel shows each symbol as often as it appears on the strip. So
              all 20 lines have the same odds: on the {VOL_LABEL[vol]} reels a line wins {fmtChance(set.lineHit)} of spins, and free spins trigger{' '}
              {fmtOneIn(set.trigger)} spins ({fmtChance(set.trigger)}). Hovering a line number on either side of the reels draws that line.
            </p>
            <div className="rl-paylines">
              {PAYLINES.map((p, l) => (
                <svg key={l} viewBox="0 0 50 30" className={l < lines ? 'on' : ''} aria-label={`Line ${l + 1}`}>
                  {Array.from({ length: REELS * ROWS }, (_, i) => (
                    <rect key={i} x={Math.floor(i / ROWS) * 10 + 1} y={(i % ROWS) * 10 + 1} width="8" height="8" rx="1.5" className={p[Math.floor(i / ROWS)] === i % ROWS ? 'hit' : ''} style={{ '--lc': lineColour(l) } as CSSProperties} />
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
