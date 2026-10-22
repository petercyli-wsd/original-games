import { formatAmount, type BetTicket } from '@originals/game-sdk';
import { useBalance, useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  Board,
  Caption,
  ChanceBar,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  InstantResult,
  Label,
  ModeTabs,
  PanelFoot,
  Readouts,
  RoundOver,
  StageTop,
  VolBadge,
  fmtChance,
  fmtMult,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTimers,
  useTurbo,
  type BetInput,
} from '@originals/game-sdk/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DiceTray, FACE_ROT, PointTrack, Table, type Rot, type TrayTone } from './Board';
import {
  autoBeforeRoll,
  chargesOf,
  clean,
  IDLE,
  isOdds,
  oddsCap,
  onlyWorking,
  resolveRoll,
  scaleLayout,
  ticketValue,
  withOdds,
  isLine,
  type AutoOdds,
  type RollTag,
  type RoundState,
} from './engine';
import {
  ALL_IDS,
  BET_NAME,
  DONT_RTP,
  FIELD_PAYS,
  LINE_OF,
  MAX_MULTIPLIER,
  ODDS_IDS,
  ODDS_LIMITS,
  PASS_RTP,
  POINTS,
  WAYS,
  betChance,
  betRtp,
  cents,
  dontChance,
  oddsReturn,
  passChance,
  pointChance,
  roundDollars,
  roundMoments,
  strategyOf,
  totalOf,
  volatilityOf,
  workingValue,
  type BetId,
  type FieldPays,
  type Layout,
  type OddsId,
  type OddsLimit,
  type Point,
} from './math';

const ACCENT = '#22d3ee';
const CHIP_VALUES = [0.1, 1, 5, 25, 100];
const KEY_OF: Record<string, BetId> = { p: 'pass', n: 'dontPass', o: 'passOdds', l: 'layOdds', f: 'field', '7': 'any7', a: 'anyCraps', y: 'yo' };

const money = (x: number) => formatAmount(x, 2);
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
type St = RoundState;

interface Entry {
  ticket: BetTicket;
  amount: number;
  parts: Layout;
  /** Settlement multiplier once decided (set the moment the dice are drawn). */
  value: number | null;
  /** Whether the dice for this ticket's first roll have been drawn. */
  drawn: boolean;
}

interface RecentRoll {
  id: number;
  d: [number, number];
  tag: RollTag;
}

function typing(e: KeyboardEvent) {
  const t = e.composedPath()[0] as HTMLElement | undefined;
  if (!t || !t.tagName) return false;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true;
  return t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type);
}

function titleOf(st: St): string {
  const s = st.lastSum;
  switch (st.outcome) {
    case 'natural':
      return `Natural ${s}`;
    case 'craps':
      return `Craps ${s}`;
    case 'bar':
      return 'Craps 12 · bar';
    case 'pointMade':
      return `Point ${st.endPoint} made`;
    case 'sevenOut':
      return 'Seven out';
    default:
      return `Rolled ${s}`;
  }
}

const restRot = (d: [number, number]): Rot[] => d.map((n, i) => ({ ...FACE_ROT[n], z: [-10, 8][i] }));
const INITIAL: [number, number] = [5, 2];

export default function Game() {
  const { rng, wallet, track } = useHost();
  const balance = useBalance();
  const chip = useBetInput(1);
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [st, setSt] = useState<St>(IDLE);
  const cur = useRef<St>(IDLE);
  const commit = (next: St) => {
    cur.current = next;
    setSt(next);
  };

  const [limit, setLimit] = useState<OddsLimit>('345x');
  const [field, setField] = useState<FieldPays>('double');
  const [propsStay, setPropsStay] = useState(true);
  const [autoOdds, setAutoOdds] = useState<AutoOdds>('max');
  const [undoStack, setUndoStack] = useState<Layout[]>([]);
  const [lastBase, setLastBase] = useState<Layout | null>(null);
  const [dice, setDice] = useState<[number, number]>(INITIAL);
  const [rots, setRots] = useState<Rot[]>(() => restRot(INITIAL));
  const [throwKey, setThrowKey] = useState(0);
  const [recent, setRecent] = useState<RecentRoll[]>([]);
  const [hover, setHover] = useState<BetId | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [autoLast, setAutoLast] = useState<{ id: number; mult: number; stake: number } | null>(null);
  const seq = useRef(0);
  const rotsRef = useRef(rots);
  rotsRef.current = rots;
  const settingsRef = useRef({ limit, field, propsStay, autoOdds });
  settingsRef.current = { limit, field, propsStay, autoOdds };

  // ------------------------------------------------------------ wallet tickets
  // One ticket per batch of chips with the same fate: the come-out line bets,
  // each round of added odds, and each roll's one-roll bets. A ticket's value
  // is set the moment the dice are drawn, so leaving mid-roll settles at the
  // true result; undecided line and odds bets settle at their exact expected
  // return from the current point (workingValue), the fair price of the bet.
  // One roll at a time: the lock is taken before the tickets are placed, so a
  // double click (or Space held with a click) can't start a second roll.
  const rollLock = useRef(false);
  const book = useRef<Entry[]>([]);
  const latestBalance = useRef(balance);
  latestBalance.current = balance;
  const truthPoint = useRef<Point | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const e of book.current) {
        let v = e.value;
        // Placed but the dice were never drawn (left while the bet was going in): a refund.
        if (!e.drawn) v = 1;
        else if (v === null) {
          let sum = 0;
          for (const id of ALL_IDS) {
            const a = e.parts[id] ?? 0;
            if (a && (isLine(id) || isOdds(id))) sum += a * workingValue(id as never, truthPoint.current);
          }
          v = sum / e.amount;
        }
        void e.ticket.settle(v);
      }
      book.current = [];
    };
  }, []);

  async function placeEntry(parts: Layout): Promise<Entry | null> {
    const amount = cents(totalOf(parts));
    if (!(amount > 0)) return null;
    try {
      const ticket = await wallet.placeBet(amount);
      if (!alive.current) {
        void ticket.settle(1);
        return null;
      }
      const e: Entry = { ticket, amount, parts, value: null, drawn: false };
      book.current.push(e);
      return e;
    } catch {
      return null;
    }
  }
  function settleEntry(e: Entry) {
    const i = book.current.indexOf(e);
    if (i < 0) return;
    book.current.splice(i, 1);
    void e.ticket.settle(e.value ?? 1);
  }

  // ------------------------------------------------------------ derived
  const phase = st.phase;
  const rolling = phase === 'rolling';
  const live = phase === 'rolling' || phase === 'point';
  const rollMs = turbo.turbo ? 360 : 950;

  const charges = chargesOf(st);
  const tableTotal = totalOf(st.table);
  const rollBlocked =
    phase === 'point'
      ? charges.total > balance + 1e-9
        ? 'Not enough balance: remove some chips'
        : undefined
      : !(tableTotal > 0)
        ? 'Place chips on the table first'
        : tableTotal > balance + 1e-9
          ? 'Not enough balance'
          : undefined;

  const capOf = (s: St, id: OddsId) => oddsCap(s, id, settingsRef.current.limit);

  // ------------------------------------------------------------ table editing
  function canAdd(id: BetId, s: St = cur.current): boolean {
    if (s.phase === 'rolling' || rollLock.current) return false;
    if (s.phase === 'point') {
      if (isLine(id)) return false;
      if (isOdds(id)) return (s.table[id] ?? 0) < capOf(s, id) - 1e-9;
      return true;
    }
    return !isOdds(id);
  }

  /** After a round, any change clears the board back to an idle table (the round's come-out chips stay). */
  function editable(): St {
    const s = cur.current;
    if (s.phase === 'over') {
      const next: St = { ...IDLE, table: s.base };
      commit(next);
      setUndoStack([]);
      return next;
    }
    return s;
  }

  function setTable(table: Layout) {
    if (rollLock.current) return;
    const s = editable();
    if (s.phase === 'rolling') return;
    setUndoStack((u) => [...u.slice(-79), s.table]);
    commit({ ...s, table: clean(table), marks: s.phase === 'point' ? null : s.marks });
  }

  const addChip = (id: BetId) => {
    const s = editable();
    if (!canAdd(id, s) || !(chip.value > 0)) return;
    let v = cents((s.table[id] ?? 0) + chip.value);
    if (isOdds(id)) v = Math.min(v, capOf(s, id));
    setTable({ ...s.table, [id]: v });
  };
  const removeChip = (id: BetId) => {
    const s = editable();
    if (s.phase === 'rolling') return;
    const amt = s.table[id] ?? 0;
    const floor = s.phase === 'point' ? (s.working[id] ?? 0) : 0;
    if (amt - floor <= 1e-9) return;
    setTable({ ...s.table, [id]: Math.max(floor, cents(amt - chip.value)) });
  };
  const scaleAll = (f: number) => {
    const s = editable();
    if (s.phase !== 'idle' || !(totalOf(s.table) > 0)) return;
    const next: Layout = {};
    for (const id of ALL_IDS) if (s.table[id]) next[id] = Math.max(0.01, cents(s.table[id]! * f));
    setTable(next);
  };
  const clearChips = () => {
    const s = editable();
    if (s.phase === 'idle' && totalOf(s.table) > 0) setTable({});
    // On a point only what isn't working yet can come off: pending odds and one-roll bets.
    else if (s.phase === 'point') setTable(onlyWorking(s).table);
  };
  const rebet = () => {
    const s = editable();
    if (s.phase === 'idle' && lastBase && totalOf(lastBase) > 0) setTable({ ...lastBase });
  };
  const undo = () => {
    const s = cur.current;
    if (!undoStack.length || s.phase === 'rolling' || rollLock.current) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((u) => u.slice(0, -1));
    commit({ ...editable(), table: prev });
  };
  const takeMaxOdds = () => {
    const s = cur.current;
    if (s.phase !== 'point' || rollLock.current) return;
    setUndoStack((u) => [...u.slice(-79), s.table]);
    commit(withOdds(s, settingsRef.current.limit));
  };

  /** Changing a knob after a round clears the board. */
  const change = (apply: () => void) => {
    apply();
    if (cur.current.phase === 'over') editable();
  };

  // ------------------------------------------------------------ one roll
  async function roll(): Promise<boolean> {
    if (rollLock.current) return false;
    rollLock.current = true;
    try {
      return await rollOnce();
    } finally {
      rollLock.current = false;
    }
  }

  async function rollOnce(): Promise<boolean> {
    const s0 = cur.current;
    if (s0.phase === 'rolling') return false;
    const { contract, props, total } = chargesOf(s0);
    if (s0.phase !== 'point' && !(total > 0)) return false;
    if (total > latestBalance.current + 1e-9) return false;

    // Line and odds money on one ticket, one-roll bets on another: they settle at different times.
    const placed: Entry[] = [];
    for (const parts of [contract, props]) {
      if (!(totalOf(parts) > 0)) continue;
      const e = await placeEntry(parts);
      if (!e) {
        for (const p of placed) {
          p.value = 1;
          settleEntry(p);
        }
        return false;
      }
      placed.push(e);
    }
    if (!alive.current) return false;
    const propsEntry = totalOf(props) > 0 ? placed[placed.length - 1] : null;

    // The dice are decided here, before the animation, and every ticket's value with them.
    const d: [number, number] = [1 + rng.int(6), 1 + rng.int(6)];
    const r = resolveRoll(s0, d, settingsRef.current.field, settingsRef.current.propsStay);
    truthPoint.current = r.next.point;
    for (const e of placed) e.drawn = true;
    if (propsEntry) propsEntry.value = ticketValue(propsEntry.parts, r.returnOf);
    if (r.decided) for (const e of book.current) if (e !== propsEntry) e.value = ticketValue(e.parts, r.returnOf);

    // Tumble: a couple of turns on each axis, landing on the drawn faces.
    const next = rotsRef.current.map((rot, i) => {
      const f = FACE_ROT[d[i]];
      return {
        x: Math.ceil(rot.x / 360) * 360 + 360 * (2 + rng.int(2)) + f.x,
        y: Math.ceil(rot.y / 360) * 360 + 360 * (1 + rng.int(2)) + f.y,
        z: Math.ceil(rot.z / 360) * 360 + 360 + Math.round(-16 + 32 * rng.next()),
      };
    });
    const comeOut = s0.phase !== 'point';
    commit({ ...s0, phase: 'rolling', base: r.next.base, marks: null, wagered: r.next.wagered, returned: comeOut ? 0 : s0.returned, rolls: comeOut ? 0 : s0.rolls, outcome: null });
    setThrowKey((k) => k + 1);
    setRots(next);
    if (!(await timers.wait(rollMs + 120))) return false;

    setDice(d);
    if (propsEntry) settleEntry(propsEntry);
    setRecent((rs) => [{ id: ++seq.current, d, tag: r.tag }, ...rs].slice(0, 40));
    commit(r.next);
    setUndoStack([]);
    if (r.decided) {
      for (const e of [...book.current]) settleEntry(e);
      setLastBase(r.next.base);
      pushHistory(r.next.wagered > 0 ? r.next.returned / r.next.wagered : 0);
    } else {
      track({ type: 'checkpoint', multiplier: r.next.returned / r.next.wagered, winChance: pointChance(r.next.point!) });
    }
    return true;
  }

  /** Bet again: the last come-out layout, rolled at once. */
  async function betAgain() {
    const s = cur.current;
    if (s.phase !== 'over' || rollLock.current) return;
    const fresh: St = { ...IDLE, table: s.base };
    commit(fresh);
    setUndoStack([]);
    await roll();
  }

  function clearBoard() {
    if (cur.current.phase !== 'over') return;
    editable();
  }

  // ------------------------------------------------------------ auto
  const autoBase = useRef<Layout>({});
  async function playAuto(stake: number): Promise<number | null> {
    let s = cur.current;
    if (s.phase === 'over') s = editable();
    if (s.phase !== 'idle') return null;
    const layout = scaleLayout(autoBase.current, stake);
    commit({ ...s, table: layout });
    if (!(await roll())) return null;
    let first = true;
    while (cur.current.phase === 'point' && alive.current) {
      commit(autoBeforeRoll(cur.current, settingsRef.current, first, latestBalance.current));
      first = false;
      if (!(await roll())) return null;
    }
    const f = cur.current;
    const mult = f.wagered > 0 ? f.returned / f.wagered : 0;
    setAutoLast({ id: ++seq.current, mult, stake: f.wagered });
    // Auto-bet tracks profit against the come-out stake; odds and repeated
    // one-roll bets can stake more than that, so report the net on it.
    return 1 + (f.returned - f.wagered) / stake;
  }
  const idleTotal = phase === 'idle' || phase === 'over' ? totalOf(phase === 'over' ? st.base : st.table) : totalOf(st.base);
  const layoutBet: BetInput = {
    text: money(idleTotal),
    value: idleTotal,
    blocked: !(idleTotal > 0) ? 'Place chips on the table first' : idleTotal > balance + 1e-9 ? 'Not enough balance' : undefined,
    setText: (text: string) => {
      const v = Number(text);
      if (!(v > 0)) return;
      const s = cur.current;
      if (s.phase === 'idle') commit({ ...s, table: scaleLayout(autoBase.current, v) });
    },
    half: () => scaleAll(0.5),
    double: () => scaleAll(2),
    normalize: () => {},
  };
  const auto = useAutoBet({ bet: layoutBet, play: playAuto, turbo: turbo.turbo });
  useEffect(() => {
    if (auto.running) return;
    // The layout Auto repeats is the table as the player left it.
    const s = cur.current;
    autoBase.current = s.phase === 'idle' ? s.table : s.base;
  }, [auto.running, st]);
  const autoMode = auto.mode === 'auto';
  const busy = rolling || auto.running;

  // ------------------------------------------------------------ main action + keys
  const main = () => {
    if (autoMode || auto.running) return;
    const s = cur.current;
    if (s.phase === 'over') {
      if (totalOf(s.base) <= balance + 1e-9) void betAgain();
    } else if ((s.phase === 'idle' || s.phase === 'point') && !rollBlocked) void roll();
  };
  useHotkeys({ space: main }, !infoOpen);

  const keys = useRef({ addChip, removeChip, undo, clearChips, scaleAll, rebet, takeMaxOdds, busy, setChip: (v: number) => chip.setText(money(v)) });
  keys.current = { addChip, removeChip, undo, clearChips, scaleAll, rebet, takeMaxOdds, busy, setChip: (v: number) => chip.setText(money(v)) };
  useEffect(() => {
    if (infoOpen) return;
    const onDown = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const h = keys.current;
      if (h.busy) return;
      const key = e.key.toLowerCase();
      const id = KEY_OF[key];
      if (id) e.shiftKey ? h.removeChip(id) : h.addChip(id);
      else if (key === 'z' || e.key === 'Backspace') h.undo();
      else if (key === 'x') h.clearChips();
      else if (key === 'd') h.scaleAll(2);
      else if (key === 'h') h.scaleAll(0.5);
      else if (key === 'r') h.rebet();
      else if (key === 'm') h.takeMaxOdds();
      else if (/^[1-5]$/.test(e.key)) h.setChip(CHIP_VALUES[Number(e.key) - 1]);
    };
    window.addEventListener('keydown', onDown);
    return () => window.removeEventListener('keydown', onDown);
  }, [infoOpen]);

  // ------------------------------------------------------------ display
  const shownPoint = st.point;
  const comeOutTable = phase === 'idle' ? st.table : st.base;
  const strat = useMemo(
    () => (totalOf(comeOutTable) > 0 ? strategyOf(comeOutTable, autoMode && autoOdds !== 'none' ? (autoOdds === 'max' ? limit : autoOdds) : null, propsStay, field) : null),
    [comeOutTable, autoMode, autoOdds, limit, propsStay, field],
  );
  const stratStats = useMemo(() => (strat ? { ...roundDollars(strat), sd: roundMoments(strat).sd } : null), [strat]);
  const vol = stratStats ? volatilityOf(stratStats.sd) : 'low';

  const hasPass = (st.phase === 'point' ? st.working.pass : comeOutTable.pass) ?? 0;
  const hasDont = (st.phase === 'point' ? st.working.dontPass : comeOutTable.dontPass) ?? 0;
  const lineSide: 'pass' | 'dontPass' = hasDont > 0 && !(hasPass > 0) ? 'dontPass' : 'pass';
  const lineChance = lineSide === 'pass' ? passChance(phase === 'point' ? shownPoint : null) : dontChance(phase === 'point' ? shownPoint : null);

  // What the line pays if it wins from here (stake back included).
  const linePays = (() => {
    if (phase !== 'point' || shownPoint === null) {
      // Pass and Don't Pass can't both win: show the side the readouts follow.
      const l = comeOutTable;
      return (l[lineSide] ?? 0) * 2;
    }
    const t = st.table;
    return lineSide === 'pass'
      ? (t.pass ?? 0) * 2 + (t.passOdds ?? 0) * oddsReturn('passOdds', shownPoint, shownPoint)!
      : (t.dontPass ?? 0) * 2 + (t.layOdds ?? 0) * oddsReturn('layOdds', shownPoint, 7)!;
  })();

  const verdict = (() => {
    if (st.lastSum === null) return <span className="cr-hint">Two dice · 36 equally likely rolls</span>;
    const s = st.lastSum;
    let label = '';
    let cls = '';
    switch (st.outcome) {
      case 'natural':
        label = 'Natural';
        cls = 'win';
        break;
      case 'craps':
        label = 'Craps';
        cls = 'lose';
        break;
      case 'bar':
        label = 'Craps · bar 12';
        cls = 'push';
        break;
      case 'pointSet':
        label = `Point is ${s}`;
        cls = 'info';
        break;
      case 'pointMade':
        label = 'Winner · point made';
        cls = 'win';
        break;
      case 'sevenOut':
        label = 'Seven out';
        cls = 'lose';
        break;
      default:
        label = s === 7 ? 'Seven' : 'No decision';
        cls = '';
    }
    return (
      <>
        <b className={`cr-sum ${cls}`}>{s}</b>
        <span className={`cr-tag ${cls}`}>{label}</span>
      </>
    );
  })();
  const trayTone: TrayTone =
    rolling || st.lastSum === null
      ? 'idle'
      : phase === 'over'
        ? st.returned > st.wagered + 1e-9
          ? 'win'
          : Math.abs(st.returned - st.wagered) < 1e-9
            ? 'push'
            : 'lose'
        : st.outcome === 'pointSet'
          ? 'info'
          : 'idle';

  let status = 'Come-out roll · place your bets';
  if (auto.running) status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ' · running'}`;
  else if (rolling) status = st.point === null ? 'Come-out roll…' : `Rolling for the ${st.point}…`;
  else if (phase === 'point') status = `Point ${st.point} · roll it before a 7`;
  else if (phase === 'over') status = `${titleOf(st)} · ${st.rolls} roll${st.rolls === 1 ? '' : 's'}`;
  else if (tableTotal > 0) status = `Come-out · ${money(tableTotal)} on the table`;
  const tone = rolling || phase === 'point' ? 'live' : phase === 'over' ? (Math.abs(st.returned - st.wagered) < 1e-9 ? 'idle' : st.returned > st.wagered ? 'won' : 'lost') : 'idle';

  const oddsMax: Partial<Record<BetId, number>> = {};
  if (phase === 'point') for (const id of ODDS_IDS) if (st.working[LINE_OF[id]]) oddsMax[id] = capOf(st, id);
  const canTakeOdds = phase === 'point' && ODDS_IDS.some((id) => st.working[LINE_OF[id]] && (st.table[id] ?? 0) < capOf(st, id) - 1e-9);

  const hb = hover;
  const hoverInfo = hb
    ? (() => {
        const ch = isOdds(hb) && st.point === null ? null : betChance(hb, phase === 'point' ? st.point : null);
        const rtp = betRtp(hb, field);
        return { ch, rtp };
      })()
    : null;

  const counts = { seven: 0, craps: 0 };
  for (const r of recent) {
    const s = r.d[0] + r.d[1];
    if (s === 7) counts.seven++;
    if (s === 2 || s === 3 || s === 12) counts.craps++;
  }

  const actionLabel =
    phase === 'rolling'
      ? 'Rolling…'
      : phase === 'point'
        ? charges.total > 0
          ? `Roll · ${money(charges.total)} in`
          : 'Roll'
        : phase === 'over'
          ? 'Bet again'
          : tableTotal > 0
            ? `Roll · bet ${money(tableTotal)}`
            : 'Roll';

  return (
    <GameLayout
      name="Craps"
      accent={ACCENT}
      className="cr-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live} />

          <Label hint={`Balance ${money(balance)}`}>Chip value</Label>
          <div className="og-bet-row">
            <input value={chip.text} inputMode="decimal" aria-label="Chip value" disabled={busy} onChange={(e) => chip.setText(e.target.value)} onBlur={chip.normalize} />
            <button type="button" disabled={busy} onClick={chip.half} aria-label="Halve chip">
              ½
            </button>
            <button type="button" disabled={busy} onClick={chip.double} aria-label="Double chip">
              2×
            </button>
          </div>
          <div className="cr-denoms" role="group" aria-label="Chip presets">
            {CHIP_VALUES.map((v, i) => (
              <button
                key={v}
                type="button"
                className={`cr-denom t${i + 1}` + (Math.abs(chip.value - v) < 1e-9 ? ' on' : '')}
                disabled={busy}
                onClick={() => chip.setText(money(v))}
                title={`Chip ${money(v)} (key ${i + 1})`}
              >
                {v < 1 ? v.toFixed(1) : v}
              </button>
            ))}
          </div>

          <Label hint={stratStats ? <VolBadge level={vol} /> : undefined}>Your chips</Label>
          <div className="cr-tools">
            <button type="button" className="og-ghost" disabled={busy || !undoStack.length} onClick={undo} title="Undo (Z)">
              Undo
            </button>
            <button type="button" className="og-ghost" disabled={busy || phase !== 'idle' || !lastBase || tableTotal > 0} onClick={rebet} title="Put back the last come-out chips (R)">
              Rebet
            </button>
            <button type="button" className="og-ghost" disabled={busy || live || !(idleTotal > 0)} onClick={() => scaleAll(0.5)} title="Halve every chip (H)">
              ½
            </button>
            <button type="button" className="og-ghost" disabled={busy || live || !(idleTotal > 0)} onClick={() => scaleAll(2)} title="Double every chip (D)">
              2×
            </button>
            <button type="button" className="og-ghost" disabled={busy || !(tableTotal > 0) || rolling} onClick={clearChips} title="Clear the chips that aren't working (X)">
              Clear
            </button>
          </div>

          <Label hint="behind the line, true odds">Max odds</Label>
          <Chips
            label="Max odds"
            options={ODDS_LIMITS.map((o) => ({ value: o.id, label: o.label, title: o.title }))}
            value={limit}
            disabled={live || auto.running}
            onChange={(v) => change(() => setLimit(v))}
          />

          <div className="cr-knobs">
            <div>
              <Label>Field pays</Label>
              <Chips
                label="Field pays"
                options={FIELD_PAYS.map((f) => ({ value: f.id, label: f.id === 'double' ? '2:1' : '3:1 on 12', title: f.title }))}
                value={field}
                disabled={live || auto.running}
                onChange={(v) => change(() => setField(v))}
              />
            </div>
            <div>
              <Label>One-roll bets</Label>
              <Chips
                label="One-roll bets"
                options={[
                  { value: 'stay', label: 'Stay up', title: 'Field and prop bets ride every roll until the line is decided' },
                  { value: 'once', label: 'Once', title: 'Field and prop bets come down after one roll' },
                ]}
                value={propsStay ? 'stay' : 'once'}
                disabled={live || auto.running}
                onChange={(v) => change(() => setPropsStay(v === 'stay'))}
              />
            </div>
          </div>

          <dl className="og-stats">
            <dt>{lineSide === 'pass' ? 'Pass wins' : 'Don’t Pass wins'}</dt>
            <dd>{fmtChance(lineChance)}</dd>
            <dt>Layout RTP</dt>
            <dd>{stratStats ? pct(stratStats.rtp) : '–'}</dd>
            <dt>{phase === 'point' ? 'In play this round' : 'Total bet'}</dt>
            <dd>{money(phase === 'point' || phase === 'over' ? st.wagered + (phase === 'point' ? charges.total : 0) : tableTotal)}</dd>
          </dl>

          {!autoMode ? (
            <>
              {phase === 'point' && (
                <ActionButton kind="secondary" disabled={!canTakeOdds} onClick={takeMaxOdds} title="Take the full odds behind your line bet (M)">
                  {canTakeOdds ? 'Take max odds' : 'Odds at max'}
                </ActionButton>
              )}
              <ActionButton
                disabled={rolling || (phase === 'over' ? totalOf(st.base) > balance + 1e-9 : !!rollBlocked)}
                onClick={() => (phase === 'over' ? void betAgain() : void roll())}
              >
                {actionLabel}
              </ActionButton>
              {rollBlocked && phase !== 'over' && !rolling && <p className={'cr-blocked' + (tableTotal > 0 ? ' err' : '')}>{rollBlocked}</p>}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!layoutBet.blocked || live}>
              <Label hint="when a point is set">Odds in auto</Label>
              <Chips
                label="Odds in auto"
                options={[
                  { value: 'none', label: 'None' },
                  { value: '1x', label: '1×' },
                  { value: '2x', label: '2×' },
                  { value: 'max', label: 'Max' },
                ]}
                value={autoOdds}
                disabled={auto.running}
                onChange={(v) => setAutoOdds(v as AutoOdds)}
              />
              <p className="cr-auto-note">
                {idleTotal > 0
                  ? `Each auto bet plays one full round with your come-out chips (${ALL_IDS.filter((id) => comeOutTable[id])
                      .map((id) => `${BET_NAME[id]} ${money(comeOutTable[id]!)}`)
                      .join(' · ')}). On win / on loss scale the whole layout.`
                  : 'Place chips on the table first; every auto bet repeats that come-out layout.'}
              </p>
            </AutoBetControls>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          {
            label: lineSide === 'pass' ? 'Pass wins' : 'Don’t Pass wins',
            value: fmtChance(lineChance),
            sub: phase === 'point' && st.point !== null ? `${lineSide === 'pass' ? WAYS[st.point] : 6} ways vs ${lineSide === 'pass' ? 6 : WAYS[st.point]}` : lineSide === 'pass' ? 'from the come-out' : 'plus 1/36 push on 12',
            tone: 'chance',
          },
          {
            label: phase === 'point' ? 'In play' : phase === 'over' ? 'Wagered' : 'On the table',
            value: money(phase === 'point' ? st.wagered + charges.total : phase === 'over' ? st.wagered : tableTotal),
            sub: phase === 'point' ? `${st.rolls} roll${st.rolls === 1 ? '' : 's'} so far` : phase === 'over' ? `${st.rolls} roll${st.rolls === 1 ? '' : 's'} this round` : 'come-out bets',
            tone: 'cash',
          },
          phase === 'over'
            ? { label: 'Returned', value: money(st.returned), sub: `${fmtMult(st.wagered > 0 ? st.returned / st.wagered : 0)} of the stake`, tone: 'prize' }
            : {
                label: 'Line pays',
                value: linePays > 0 ? money(linePays) : '—',
                sub: phase === 'point' ? `if the ${lineSide === 'pass' ? st.point : '7'} rolls first` : 'stake back included',
                tone: 'prize',
              },
        ]}
      />

      <Board className="cr-board">
        <DiceTray rots={rots} ms={rollMs} throwKey={throwKey} rolling={rolling} dice={dice} verdict={verdict} tone={trayTone} />
        <PointTrack
          point={phase === 'over' || phase === 'idle' ? null : st.point}
          resolved={phase === 'over' && st.endPoint !== null ? { p: st.endPoint, made: st.outcome === 'pointMade' } : null}
        />
      </Board>

      <div className="cr-slot">
        {autoMode && autoLast && !rolling && (phase === 'over' || phase === 'idle') ? (
          <InstantResult multiplier={autoLast.mult} stake={autoLast.stake} id={autoLast.id} />
        ) : !autoMode && phase === 'over' ? (
          <RoundOver
            key={history[0]?.id}
            title={titleOf(st)}
            multiplier={st.wagered > 0 ? st.returned / st.wagered : 0}
            stake={st.wagered}
            nextBet={totalOf(st.base)}
            blocked={totalOf(st.base) > balance + 1e-9 ? 'Not enough balance' : undefined}
            onBetAgain={() => void betAgain()}
            onClear={clearBoard}
            placement="inline"
          />
        ) : phase === 'point' && st.point !== null ? (
          <ChanceBar
            p={pointChance(st.point)}
            label={`Point ${st.point} before a 7`}
            note={`${WAYS[st.point]} of the 36 rolls make the point, 6 seven out; the other ${36 - WAYS[st.point] - 6} roll again.`}
          />
        ) : (
          <Caption>
            {hb && hoverInfo ? (
              <>
                <b>{BET_NAME[hb]}</b>
                {hoverInfo.ch === null ? ' works once a point is set' : ` wins ${fmtChance(hoverInfo.ch)} of the time`} · RTP {pct(hoverInfo.rtp)}
              </>
            ) : (
              <>
                Come-out: 7 or 11 wins the Pass line, 2, 3 or 12 loses. Anything else is the point. Pass {pct(PASS_RTP)} · Don&rsquo;t Pass {pct(DONT_RTP)} · odds
                100%.
              </>
            )}
          </Caption>
        )}
      </div>

      <Table
        over={phase === 'over'}
        table={st.table}
        working={st.working}
        point={phase === 'point' || phase === 'rolling' ? st.point : phase === 'over' ? st.endPoint : null}
        field={field}
        marks={rolling ? null : st.marks}
        canAdd={(id) => !busy && canAdd(id, phase === 'over' ? { ...IDLE } : st)}
        oddsMax={oddsMax}
        disabled={busy}
        onAdd={addChip}
        onRemove={removeChip}
        onHover={setHover}
        money={money}
      />

      <div className="cr-recent">
        <span className="cr-recent-label">Rolls</span>
        <div className="cr-rolls" aria-label="Recent rolls">
          {recent.length === 0 && <span className="cr-none">No rolls yet</span>}
          {recent.slice(0, 18).map((r) => (
            <span key={r.id} className={`cr-roll ${r.tag}`} title={`${r.d[0]} + ${r.d[1]} = ${r.d[0] + r.d[1]}`}>
              <b>{r.d[0] + r.d[1]}</b>
            </span>
          ))}
        </div>
        <div className="cr-counts" title={`Last ${recent.length} rolls`}>
          <span className="seven">7s {counts.seven}</span>
          <span className="craps">Craps {counts.craps}</span>
        </div>
      </div>

      {infoOpen && (
        <InfoModal title="Craps" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Two dice decide the line. Back the <b>Pass Line</b> to win on a 7 or 11 straight away, or on your point rolled again before a 7. Back <b>Don&rsquo;t Pass</b> to
              take the other side. Add true-odds bets behind the line and one-roll bets in the middle.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a chip value (presets 1–5) and click the table to place chips; right-click or Shift-click removes one.</li>
              <li>
                Press Roll (Space) for the <b>come-out</b>. 7 or 11 is a natural: Pass wins. 2, 3 or 12 is craps: Pass loses, Don&rsquo;t Pass wins on 2 or 3 and pushes on 12.
              </li>
              <li>Any other total becomes the <b>point</b> and the puck turns ON. Keep rolling: the point again wins for Pass, a 7 first (seven out) wins for Don&rsquo;t Pass.</li>
              <li>While the point is on, add <b>odds</b> behind your line bet (Take max odds, or M) and play field or prop bets on any roll.</li>
              <li>The round ends when the line is decided. Bet again replays the same come-out chips; Clear board goes back to the table. Auto repeats it with your stop rules.</li>
            </ol>
            <p>
              Keys: <b>Space</b> roll · <b>P</b> pass · <b>N</b> don&rsquo;t pass · <b>O</b>/<b>L</b> odds / lay odds · <b>M</b> max odds · <b>F</b> field · <b>7</b> any 7 ·{' '}
              <b>A</b> any craps · <b>Y</b> yo (Shift removes) · <b>Z</b> undo · <b>X</b> clear · <b>D</b>/<b>H</b> double / halve · <b>R</b> rebet · <b>1–5</b> chip ·{' '}
              <b>Esc</b> clear board.
            </p>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The dice are fair, so all 36 rolls are equally likely: a total t comes up in {`{1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1}`} of them for t = 2…12. The thin bar along the foot
              of each table cell is that bet&rsquo;s chance to win. On the point track, each box&rsquo;s bar is the chance that point is made before a 7.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Once the point is p, only p and 7 matter: it is made first with probability w / (w + 6), where w is the number of ways to roll p (3 for 4 and 10, 4 for 5 and 9, 5 for
              6 and 8). Summing over the come-out (a Markov chain with one absorbing step): P(Pass) = 8/36 + Σ (w/36)·w/(w+6) = 244/495, so Pass returns 2 × 244/495 = 488/495 ={' '}
              {pct(PASS_RTP)}. Don&rsquo;t Pass wins 949/1980 and pushes 1/36: {pct(DONT_RTP)}. Odds pay 6:w behind Pass and w:6 behind Don&rsquo;t, exactly the true odds, so
              they return 100%.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <table className="cr-paytable">
              <thead>
                <tr>
                  <th>Bet</th>
                  <th>Pays</th>
                  <th>Wins</th>
                  <th>RTP</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Pass Line', 'pass', '1:1'],
                    ["Don't Pass (bar 12)", 'dontPass', '1:1'],
                    ['Pass odds', 'passOdds', '2:1 · 3:2 · 6:5'],
                    ['Lay odds', 'layOdds', '1:2 · 2:3 · 5:6'],
                    ['Field', 'field', field === 'triple' ? '1:1, 2 at 2:1, 12 at 3:1' : '1:1, 2 & 12 at 2:1'],
                    ['Any 7', 'any7', '4:1'],
                    ['Any Craps', 'anyCraps', '7:1'],
                    ['Yo 11 / Ace-Deuce', 'yo', '15:1'],
                    ['Aces / Twelve', 'aces', '30:1'],
                  ] as [string, BetId, string][]
                ).map(([name, id, pays]) => (
                  <tr key={id}>
                    <td>{name}</td>
                    <td>{pays}</td>
                    <td>{isOdds(id) ? 'true odds' : fmtChance(betChance(id, null))}</td>
                    <td>{pct(betRtp(id, field))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Payouts are &ldquo;to one&rdquo;: a win also returns your chip. Odds are capped at the Max odds setting (3-4-5×: 3× on 4/10, 4× on 5/9, 5× on 6/8; lay odds may win
              the same multiple). The best bets are the line with full odds; the top payout is a 30:1 hop at {fmtMult(MAX_MULTIPLIER)}. Each roll is drawn the moment you press
              Roll; the tumble only shows it. Point boxes: {POINTS.map((p) => `${p} ${fmtChance(pointChance(p))}`).join(' · ')}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}

