// SlotGame: the whole slot game shell, on the site's kit layout (docs/SLOT-STYLE.md).
//
//   <SlotGame manifest spec featureSpecs config facts theme symbols />
//
// Panel: Manual | Auto tabs, bet field, Spin (the primary button), Autoplay (n spins, stop on a feature,
// stop on a win of N×), Turbo, How to play (the paytable). Stage: status and history, balance and win
// readouts, the reel window, the win chip, one rule sentence. Space spins (and skips).
//
// A spin: guard with a ref → `await ticket.place()` → seed from the host RNG → `engine.playRound` →
// animate the base spin, each win in turn, tumbles, then the feature (intro card, spins counter,
// multiplier, running total, retrigger notices, outro) → `ticket.settle` on the same ticket. While
// anything animates, the ticket's fair value is the round's resolved multiplier (docs/BUILDING-GAMES.md).

import { formatAmount } from '@originals/game-sdk';
import { useBalance, useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  BetField,
  Board,
  Caption,
  Chips,
  GameLayout,
  InfoModal,
  Label,
  PanelFoot,
  Readouts,
  StageTop,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTurbo,
  type StatusTone,
} from '@originals/game-sdk/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SpinResult, SpinStep, SpinWin } from '../engine/types';
import { installDevHooks, createSeedSource, resolveEngine } from './engine-bridge';
import { PayTableSheet, themeVars } from './PayTableSheet';
import { Card, MultiplierReel, RollNumber, WinChip, type CardProps, type RollHandle } from './parts';
import { ReelWindow, type ReelWindowHandle } from './ReelWindow';
import type { SlotGameProps, SlotSymbolArt } from './types';
import {
  TIER_LABEL,
  anticipationPlan,
  extraLabel,
  landedByStep,
  landedCoins,
  modifierOf,
  multiplierChip,
  multiplierValues,
  preReveal,
  roundMultiplier,
  type RoundMultiplier,
  bigWinTier,
  cellsUnion,
  decorOverlays,
  fmtX,
  idleBoard,
  idsWithRole,
  initialSpins as initialSpins_,
  introLines,
  maxRowsOf,
  multiplierNote,
  outroLines,
  parseWinLabel,
  rollMs,
  ruleSentence,
  symbolMetas,
} from './util';

const money = (x: number) => formatAmount(x, 2);

interface ChipState {
  art?: SlotSymbolArt | null;
  text: string;
  event?: boolean;
}

interface FeatureState {
  /** 'spins' (free spins) or 'respin' (a modifier-driven feature). */
  kind?: 'spins' | 'respin';
  /** Landed coin value so far, in money (respins). */
  total?: number;
  n: number;
  of: number;
  mult: number;
}

const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function SlotGame(props: SlotGameProps) {
  const { manifest, spec, featureSpecs, config, facts, theme, symbols, copy, renderOverlay } = props;
  const { rng } = useHost();
  const balance = useBalance();
  const bet = useBetInput();
  const turboState = useTurbo();
  const turbo = turboState.turbo || prefersReducedMotion();
  const [history, pushHistory] = useHistory(14);

  const engine = useMemo(() => resolveEngine(props), [props.engine, spec, featureSpecs, config]); // eslint-disable-line react-hooks/exhaustive-deps
  // A modifier-driven feature (hold and spin, sticky respins) may come with its own test and name in slot.config.json.
  const mf = (config as { modifierFeature?: { name?: string; detect?: unknown } }).modifierFeature;
  const customDetect = typeof mf?.detect === 'function' ? (mf.detect as (r: SpinResult) => boolean) : undefined;
  const modName = mf?.name ?? copy?.modifierName ?? 'Bonus';
  const seeds = useMemo(
    () => createSeedSource(engine, rng, spec.bet.coins, undefined, (r) => !!r.feature || !!modifierOf(r.base, customDetect)),
    [engine, rng, spec.bet.coins], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => installDevHooks(seeds), [seeds]);

  const cols = spec.geometry.cols;
  const bc = spec.bet.coins;
  const maxRows = useMemo(() => maxRowsOf(spec), [spec]);
  const filler = useMemo(() => spec.symbols.map((s) => s.id), [spec]);
  const initial = useMemo(() => idleBoard(spec), [spec]);
  const metas = useMemo(() => symbolMetas(spec), [spec]);
  const scatterIds = useMemo(() => idsWithRole(spec, 'scatter'), [spec]);
  const featureName = copy?.featureName ?? 'Free spins';
  const scatterMin = spec.trigger?.scatter_min ?? 3;
  const featureSpec = useMemo(() => Object.values(featureSpecs ?? {})[0] ?? spec, [featureSpecs, spec]);

  // ---- what the player sees
  const [status, setStatus] = useState<{ text: string; tone: StatusTone }>({ text: 'Spin to play', tone: 'idle' });
  const [win, setWin] = useState<ReadonlySet<string> | null>(null);
  const [line, setLine] = useState<[number, number][] | null>(null);
  const [overlays, setOverlays] = useState<ReadonlyMap<string, string> | null>(null);
  const [chip, setChip] = useState<ChipState | null>(null);
  const [card, setCard] = useState<CardProps | null>(null);
  const [feat, setFeat] = useState<FeatureState | null>(null);
  const [rmult, setRmult] = useState<RoundMultiplier | null>(null);
  const [overlayDecor, setOverlayDecor] = useState<Record<string, unknown> | undefined>(undefined);
  const mrCfg = copy?.multiplierReel;
  const mrValues = useMemo(() => mrCfg?.values ?? multiplierValues(spec), [mrCfg, spec]);
  const [mr, setMr] = useState<{ spinning: boolean; value: number | null }>({ spinning: false, value: null });
  const [busy, setBusy] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const [autoCfg, setAutoCfg] = useState({ count: 25, stopFeature: true, stopWin: 0 });
  const [autoLeft, setAutoLeft] = useState<number | null>(null);

  // ---- machinery
  const reels = useRef<ReelWindowHandle>(null);
  const counter = useRef<RollHandle>(null);
  const bigRoll = useRef<RollHandle>(null);
  const alive = useRef(true);
  const busyRef = useRef(false);
  const resolved = useRef(0);
  const turboRef = useRef(turbo);
  turboRef.current = turbo;
  const autoRef = useRef(false);
  const stopReq = useRef(false);
  const lastFeature = useRef(false);
  const skipFns = useRef(new Set<() => void>());
  const epoch = useRef(0);
  const ticket = useTicket(() => (busyRef.current ? resolved.current : 0));

  const skipAll = () => {
    epoch.current++;
    [...skipFns.current].forEach((f) => f());
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopReq.current = true;
      skipAll();
    };
  }, []);

  /** A pause that Space / a click can cut short. */
  const wait = (ms: number) =>
    new Promise<void>((res) => {
      const done = () => {
        clearTimeout(t);
        skipFns.current.delete(done);
        res();
      };
      const t = setTimeout(done, ms);
      skipFns.current.add(done);
    });
  const T = (ms: number) => (turboRef.current ? Math.max(40, Math.round(ms * 0.25)) : ms);

  const rollTo = async (h: RollHandle | null, to: number, ms: number) => {
    if (!h) return;
    const sk = () => h.skip();
    skipFns.current.add(sk);
    await h.roll(to, ms);
    skipFns.current.delete(sk);
  };

  /** A card over the window. `autoMs` null waits for a press (Space or a click); otherwise it closes by itself. */
  async function showCard(c: CardProps, opts: { autoMs: number | null; during?: () => Promise<void> }) {
    let done!: () => void;
    const pressed = new Promise<void>((r) => (done = r));
    skipFns.current.add(done);
    setCard({ ...c, button: opts.autoMs === null ? (c.button ?? 'Continue') : null, onContinue: done });
    try {
      if (opts.during) {
        await wait(30);
        await opts.during();
      }
      // A card that waits for a press still moves on by itself after 6 s, so a round can't hang on it.
      if (opts.autoMs === null) await Promise.race([pressed, wait(6000)]);
      else await Promise.race([pressed, wait(opts.autoMs)]);
    } finally {
      skipFns.current.delete(done);
    }
    if (alive.current) setCard(null);
  }
  const autoAdvance = () => autoRef.current || turboRef.current;

  // ---- presentation of one spin result

  const strips = (s: typeof spec, res: SpinResult, board: number[][]) => {
    const rs = s.board_law.reel_sets?.[res.set];
    if (!rs || rs.strips.length !== cols || res.stops?.length !== cols) return null;
    const out = rs.strips.map((strip, c) => ({ strip, stop: res.stops[c] }));
    // Only use the strips if they really reproduce the window; otherwise the passing symbols are a plain cycle.
    for (let c = 0; c < cols; c++) {
      const { strip, stop } = out[c];
      if (!strip.length || board[c].some((sym, r) => strip[(stop + r) % strip.length] !== sym)) return null;
    }
    return out;
  };

  async function spinOne(res: SpinResult, s: typeof spec, anticipate: boolean) {
    const board0 = res.steps[0]?.board ?? res.finalBoard;
    // A mystery reveal shows only the final board; rebuild the board the reels stop on, with the mystery squares visible.
    const pre = preReveal(s, res);
    const board = pre?.board ?? board0;
    const st = strips(s, res, board);
    const ant =
      anticipate && config.feature
        ? anticipationPlan(board0, scatterIds, scatterMin, (c) => !st || st[c].strip.some((x) => scatterIds.includes(x)))
        : undefined;
    setWin(null);
    setLine(null);
    setChip(null);
    setOverlays(null);
    setOverlayDecor(undefined);
    setRmult(null);
    if (mrCfg) setMr({ spinning: true, value: null });
    await reels.current?.spin({ board, strips: st, turbo: turboRef.current, anticipate: ant });
    if (!alive.current) return;
    if (pre) {
      // The reveal: every mystery square flips into its symbol at once, before any win shows.
      await wait(T(350));
      if (alive.current) await reels.current?.reveal(board0, pre.cells, turboRef.current);
      await wait(T(300));
    }
    if (mrCfg) {
      const v = res.decor?.[mrCfg.decorKey ?? 'global_iid.mult'];
      setMr({ spinning: false, value: typeof v === 'number' ? v : null });
    }
  }

  const linePath = (w: SpinWin): [number, number][] | null => (w.lineIdx !== null && w.cells.length > 1 ? [...w.cells].sort((a, b) => a[0] - b[0]) : null);
  const keys = (cells: [number, number][]) => new Set(cells.map(([c, r]) => `${c},${r}`));

  /** Shows every win of one step, rolling the counter up by the step's coins. Returns the running coins. */
  async function presentWins(st: SpinStep, m: number, stake: number, running: number, limit: number, k = 1): Promise<number> {
    const add = st.stepCoins * m;
    const to = running + add;
    const m$ = (c: number) => (Math.min(c, limit) / bc) * stake;
    const ms = rollTo(counter.current, m$(to), rollMs(add / bc, turboRef.current) * k);
    const wins = st.wins;
    const chipFor = (w: SpinWin): ChipState => {
      const p = parseWinLabel(w.label);
      const id = p ? metas.find((x) => x.label === p.symbol)?.id : undefined;
      const art = id !== undefined ? symbols[id] : undefined;
      const name = art?.name ?? p?.symbol ?? w.label;
      const count = p ? ` ×${p.count}` : '';
      const ways = w.ways && w.ways > 1 ? ` · ${w.ways} ways` : '';
      return { art, text: `${name}${count}${ways} = ${money(((w.coins * m) / bc) * stake)}` };
    };
    const all = keys(cellsUnion(wins));
    const total = `${wins.length} wins = ${money((add / bc) * stake)}`;
    if (wins.length === 1 || turboRef.current || wins.length > 4) {
      setWin(all);
      setLine(wins.length === 1 ? linePath(wins[0]) : null);
      setChip(wins.length === 1 ? chipFor(wins[0]) : { text: total });
      await Promise.all([ms, wait(T(700) * k)]);
    } else {
      // A few wins: each in turn (its cells, its line, its chip), then all of them together.
      const ep = epoch.current;
      for (const w of wins) {
        if (!alive.current || ep !== epoch.current) break;
        setWin(keys(w.cells));
        setLine(linePath(w));
        setChip(chipFor(w));
        await wait(Math.max(520, 1100 / Math.max(1, wins.length - 1)) * k);
      }
      await ms;
      if (alive.current) {
        setWin(all);
        setLine(null);
        setChip({ text: total });
      }
    }
    return to;
  }

  /** One spin result from its first board to its last: wins, tumbles, respins, extras, decor. Returns the running coins. */
  async function presentResult(res: SpinResult, m: number, stake: number, running: number, limit: number, isBase = false): Promise<number> {
    const r = reels.current;
    const steps = res.steps;
    const rm = roundMultiplier(res.decor);
    setRmult(rm);
    const mod = isBase ? modifierOf(res, customDetect) : null;
    const landed = mod ? landedByStep(res, bc, copy?.decorLabels) : null;
    const landedC = mod ? landedCoins(res) : null;
    const money$ = (c: number) => (Math.min(c, limit) / bc) * stake;

    // Decor that belongs to the whole spin shows before the wins: the rockets' +N, the multiplier they add up to.
    if (steps.length === 1 && !mod) {
      const ov = decorOverlays(res.decor, copy?.decorLabels, bc);
      if (ov.size) setOverlays(ov);
      setOverlayDecor(res.decor);
      const chipText = rm && res.totalCoins > 0 ? multiplierChip(rm) : null;
      if (chipText) {
        setChip({ text: chipText, event: true });
        await wait(T(800));
      }
    }

    let introduced = false;
    for (let i = 0; i < steps.length && alive.current; i++) {
      const st = steps[i];
      const next = steps[i + 1];
      // Long cascades and respin chains speed up: the first three steps at full length, then shorter, to 35%.
      const k = i < 3 ? 1 : Math.max(0.35, 1 - 0.12 * (i - 2));
      if (st.wins.length) {
        running = await presentWins(st, m, stake, running, limit, k);
        if (next) {
          await r?.tumble(next.board, cellsUnion(st.wins), turboRef.current, k);
          if (alive.current) {
            setWin(null);
            setLine(null);
          }
        }
      } else if (next) {
        // No win, but the board changes: a respin. Only the reels that changed spin.
        if (mod && !introduced) {
          introduced = true;
          if (landed) setOverlays(landed[0]);
          setChip(null);
          setWin(null);
          setLine(null);
          await wait(T(400));
          const note = copy?.modifierIntro ?? '';
          await showCard(
            { kicker: modName, title: `${mod.respins} respins`, lines: note ? [note] : [], button: 'Start' },
            { autoMs: autoAdvance() ? T(1400) : null },
          );
          setFeat({ kind: 'respin', n: 0, of: mod.respins, mult: 1, total: 0 });
          if (landedC) await rollTo(counter.current, money$(landedC[0]), T(250));
        }
        const only = new Set<number>();
        next.board.forEach((col, c) => {
          if (JSON.stringify(col) !== JSON.stringify(st.board[c])) only.add(c);
        });
        if (mod) setFeat((f) => (f ? { ...f, n: i + 1 } : f));
        if (only.size) await r?.spin({ board: next.board, only, turbo: turboRef.current, speed: k });
        if (mod && landed && landedC && alive.current) {
          // Coin values show as they land, and the live total rolls up with them.
          setOverlays(landed[i + 1]);
          await rollTo(counter.current, money$(landedC[i + 1]), T(250) * k);
        }
      }
    }
    if (!alive.current) return running;
    const last = steps[steps.length - 1]?.board;
    if (last && JSON.stringify(last) !== JSON.stringify(res.finalBoard)) r?.set(res.finalBoard);
    if (mod) setFeat(null);
    // Decor first (the orb values on their cells), then the multiplier event that uses them.
    if (steps.length > 1 || mod) {
      const ov = decorOverlays(res.decor, copy?.decorLabels, bc);
      if (ov.size) setOverlays(ov);
      setOverlayDecor(res.decor);
    }
    for (const ex of res.extras) {
      const add = ex.coins * m;
      running += add;
      setChip({ text: `${extraLabel(ex.label, copy?.extrasLabels)} · +${money(((add / bc) * stake))}`, event: true });
      if (/scatter/i.test(ex.label)) {
        // A scatter pay has no cells of its own: show the scatters that paid.
        const cells: [number, number][] = [];
        (steps[0]?.board ?? res.finalBoard).forEach((col, c) => col.forEach((sym, row) => scatterIds.includes(sym) && cells.push([c, row])));
        setWin(keys(cells));
      }
      await Promise.all([rollTo(counter.current, (Math.min(running, limit) / bc) * stake, rollMs(add / bc, turboRef.current)), wait(T(900))]);
    }
    if (mod && alive.current) {
      const stakes = Math.min(running, limit) / bc;
      await showCard(
        { kicker: modName, title: 'Total win', amount: money(stakes * stake), lines: [`${mod.respins} respins`, `${fmtX(stakes)} your bet`], tier: bigWinTier(stakes) },
        { autoMs: autoAdvance() ? T(1800) : null },
      );
    }
    return running;
  }

  async function bigWin(coins: number, stake: number, capped: boolean) {
    const stakes = coins / bc;
    const tier = bigWinTier(stakes);
    if (!tier) return;
    const total = (coins / bc) * stake;
    await showCard(
      {
        kicker: TIER_LABEL[tier],
        tier,
        amount: <RollNumber ref={bigRoll} />,
        lines: [`${fmtX(stakes)} your bet`, ...(capped ? ['Max win reached'] : [])],
      },
      { autoMs: T(1300), during: () => rollTo(bigRoll.current, total, rollMs(stakes, turboRef.current)) },
    );
  }

  /** The whole animated round. All amounts are already decided by `round`. */
  async function runRound(round: ReturnType<typeof engine.playRound>, stake: number) {
    const base = round.base;
    await spinOne(base, spec, true);
    if (!alive.current) return;
    setStatus(round.feature ? { text: featureName, tone: 'live' } : base.totalCoins > 0 ? { text: 'Win', tone: 'won' } : { text: 'No win', tone: 'idle' });
    const baseCoins = Math.min(base.totalCoins, round.totalCoins);
    counter.current?.set(0);
    await presentResult(base, 1, stake, 0, round.totalCoins, true);
    if (!alive.current) return;

    const fr = round.feature;
    if (!fr) {
      await bigWin(round.totalCoins, stake, round.capped);
      return;
    }

    // ---- feature
    const name = featureName;
    const retrig = fr.spins.reduce((a, s) => a + s.retrigger, 0);
    const nScatter = Math.max(...[base.steps[0]?.board ?? base.finalBoard, base.finalBoard].map((b) => b.flat().filter((s) => scatterIds.includes(s)).length));
    const initialSpins = config.feature ? initialSpins_(config.feature, fr.spins.length, retrig, round.capped, nScatter) : fr.spins.length - retrig;
    const introNote = copy?.introNote ?? (config.feature ? multiplierNote(config.feature) : '');
    await wait(T(500));
    await showCard(
      { kicker: name, title: `${initialSpins} free spins`, lines: introLines(nScatter, introNote), button: 'Start' },
      { autoMs: autoAdvance() ? T(1600) : null },
    );
    if (!alive.current) return;

    const limit = round.totalCoins - baseCoins;
    counter.current?.set(0);
    setWin(null);
    setLine(null);
    setChip(null);
    let of = initialSpins;
    let fcoins = 0;
    for (let i = 0; i < fr.spins.length && alive.current; i++) {
      const sp = fr.spins[i];
      setFeat({ n: i + 1, of, mult: sp.multiplier });
      await spinOne(sp.result, featureSpec, false);
      if (!alive.current) return;
      fcoins = await presentResult(sp.result, sp.multiplier, stake, fcoins, limit);
      if (sp.retrigger > 0 && alive.current) {
        of += sp.retrigger;
        setFeat({ n: i + 1, of, mult: sp.multiplier });
        await showCard({ title: `+${sp.retrigger} free spins`, lines: ['Retrigger'] }, { autoMs: T(1400) });
      } else if (i < fr.spins.length - 1) {
        await wait(T(380));
      }
    }
    if (!alive.current) return;
    const tier = bigWinTier(round.totalCoins / bc);
    await showCard(
      {
        kicker: tier ? TIER_LABEL[tier] : name,
        tier,
        title: tier ? undefined : 'Total win',
        amount: money(((Math.min(fcoins, limit) / bc) * stake)),
        lines: outroLines(fr.spins.length, round.totalCoins / bc, round.capped),
        button: 'Collect',
      },
      { autoMs: autoAdvance() ? T(2000) : null },
    );
    if (!alive.current) return;
    setFeat(null);
    await rollTo(counter.current, (round.totalCoins / bc) * stake, T(500));
  }

  async function play(stake: number): Promise<number | null> {
    if (busyRef.current) return null;
    busyRef.current = true;
    resolved.current = facts.rtp; // before the draw: the expected value, never the previous round's
    if (!(await ticket.place(stake))) {
      busyRef.current = false;
      return null;
    }
    if (!alive.current) return null;
    const { seed, rng32 } = seeds.next();
    const round = engine.playRound(seed, rng32);
    const mult = round.totalCoins / bc;
    resolved.current = mult;
    lastFeature.current = !!round.feature;

    setBusy(true);
    setFeat(null);
    setCard(null);
    setStatus({ text: 'Spinning', tone: 'live' });
    try {
      await runRound(round, stake);
    } finally {
      if (alive.current) {
        ticket.settle(mult);
        busyRef.current = false;
        pushHistory(mult);
        const won = mult * stake;
        setStatus(won <= 0 ? { text: 'No win', tone: 'lost' } : won > stake + 1e-9 ? { text: `Won ${money(won)}`, tone: 'won' } : { text: `Returned ${money(won)}`, tone: 'idle' });
        setBusy(false);
        counter.current?.set(won);
      }
    }
    return mult;
  }
  const playRef = useRef(play);
  playRef.current = play;

  const spin = () => {
    if (busyRef.current || autoRef.current || mode !== 'manual' || bet.blocked) return;
    void play(bet.value);
  };

  async function startAuto() {
    if (autoRef.current || busyRef.current || bet.blocked) return;
    stopReq.current = false;
    autoRef.current = true;
    const cfg = autoCfg;
    const stake = bet.value;
    for (let i = 0; i < cfg.count; i++) {
      if (stopReq.current || !alive.current) break;
      setAutoLeft(cfg.count - i);
      const m = await playRef.current(stake);
      if (m === null || !alive.current) break;
      if (cfg.stopFeature && lastFeature.current) break;
      if (cfg.stopWin > 0 && m >= cfg.stopWin) break;
      await new Promise((r) => setTimeout(r, turboRef.current ? 60 : 350));
    }
    autoRef.current = false;
    if (alive.current) setAutoLeft(null);
  }
  const stopAuto = () => {
    stopReq.current = true;
  };

  const skip = () => {
    reels.current?.slam();
    skipAll();
  };

  useHotkeys(
    {
      space: () => {
        if (busyRef.current) return skip();
        if (autoRef.current) return stopAuto();
        if (mode === 'manual') spin();
        else void startAuto();
      },
    },
    !infoOpen,
  );

  const autoRunning = autoLeft !== null;
  const locked = busy || autoRunning;
  const hasFeature = !!config.feature;

  // The multiplier readout shows what is really applied: the feature's multiplier times the spin's own (a multiplier reel,
  // rockets, orbs). A plain ×1 is not shown, so it can't mislead.
  const mult = (feat?.mult ?? 1) * (rmult?.total ?? 1);
  const multItem = mult !== 1 ? [{ label: 'Multiplier', value: `×${mult}` }] : [];
  const readouts = feat
    ? feat.kind === 'respin'
      ? [
          { label: copy?.respinLabel ?? 'Respin', value: `${feat.n} of ${feat.of}` },
          { label: 'Bonus total', value: <RollNumber ref={counter} format={money} /> },
          ...multItem,
        ]
      : [
          { label: 'Free spin', value: `${feat.n} of ${feat.of}` },
          { label: 'Feature total', value: <RollNumber ref={counter} format={money} /> },
          ...multItem,
        ]
    : [
        { label: 'Balance', value: money(balance) },
        { label: 'Win', value: <RollNumber ref={counter} format={money} /> },
        ...multItem,
      ];

  const panel = (
    <>
      <div className="og-mode-tabs" role="tablist" aria-label="Spin mode">
        {(['manual', 'auto'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} disabled={locked} onClick={() => setMode(m)}>
            {m === 'manual' ? 'Manual' : 'Autoplay'}
          </button>
        ))}
      </div>
      <BetField bet={bet} disabled={locked} />
      {mode === 'auto' && (
        <div className="sl-auto">
          <Label>Number of spins</Label>
          <Chips
            label="Number of spins"
            value={autoCfg.count}
            disabled={locked}
            onChange={(count) => setAutoCfg((c) => ({ ...c, count }))}
            options={[10, 25, 50, 100].map((n) => ({ value: n, label: String(n) }))}
          />
          <Label hint="times your bet">Stop on a win of</Label>
          <Chips
            label="Stop on a win of"
            value={autoCfg.stopWin}
            disabled={locked}
            onChange={(stopWin) => setAutoCfg((c) => ({ ...c, stopWin }))}
            options={[
              { value: 0, label: 'Off' },
              { value: 5, label: '5×' },
              { value: 20, label: '20×' },
              { value: 100, label: '100×' },
            ]}
          />
          {hasFeature && (
            <label className="og-toggle">
              <input type="checkbox" checked={autoCfg.stopFeature} disabled={locked} onChange={(e) => setAutoCfg((c) => ({ ...c, stopFeature: e.target.checked }))} />
              <span>Stop on {featureName.toLowerCase()}</span>
            </label>
          )}
        </div>
      )}
      {mode === 'manual' ? (
        busy ? (
          <ActionButton kind="secondary" className="sl-skip" onClick={skip}>
            Skip
          </ActionButton>
        ) : (
          <ActionButton disabled={!!bet.blocked} onClick={spin}>
            Spin
          </ActionButton>
        )
      ) : autoRunning ? (
        <ActionButton kind="cash" onClick={stopAuto}>
          Stop autoplay · {autoLeft} left
        </ActionButton>
      ) : (
        <ActionButton disabled={!!bet.blocked} onClick={() => void startAuto()}>
          Start autoplay
        </ActionButton>
      )}
      {bet.blocked && !locked && <p className="sl-note">{bet.blocked}</p>}
      <PanelFoot turbo={turboState} onInfo={() => setInfoOpen(true)} />
    </>
  );

  return (
    <GameLayout name={manifest.name} accent={manifest.accent} className="slots" panel={panel}>
      <StageTop status={feat ? (feat.kind === 'respin' ? modName : featureName) : status.text} tone={feat ? 'live' : status.tone} history={history} />
      <Readouts items={readouts} />
      <Board>
        <div className="sl-stage" style={themeVars(theme)}>
          {mrCfg && mrValues.length > 0 && <MultiplierReel label={mrCfg.label ?? 'Multiplier'} values={mrValues} spinning={mr.spinning} value={mr.value} turbo={turbo} />}
          <ReelWindow
            ref={reels}
            cols={cols}
            maxRows={maxRows}
            symbols={symbols}
            theme={theme}
            fillerIds={filler}
            initial={initial}
            win={win}
            line={line}
            overlays={overlays}
            feature={!!feat}
            renderOverlay={renderOverlay}
            overlayDecor={overlayDecor}
          />
          <div className="sl-winbar" aria-live="polite">
            {chip && <WinChip art={chip.art} text={chip.text} event={chip.event} />}
          </div>
          {card && <Card {...card} />}
        </div>
      </Board>
      <Caption>{ruleSentence(spec, copy)}</Caption>
      {infoOpen && (
        <InfoModal title="Paytable" onClose={() => setInfoOpen(false)}>
          <PayTableSheet spec={spec} symbols={symbols} config={config} copy={copy} facts={facts} theme={theme} modifierName={modName} />
        </InfoModal>
      )}
    </GameLayout>
  );
}
