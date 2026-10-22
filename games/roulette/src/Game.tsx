import { formatAmount } from '@originals/game-sdk';
import { useBalance, useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
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
  VolBadge,
  fmtChance,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
  type BetInput,
} from '@originals/game-sdk/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CALL_BETS,
  CALL_KEYS,
  KIND_NAMES,
  PAYTABLE,
  RTP,
  SPOT_BY_ID,
  WHEEL_INDEX,
  addCall,
  addNeighbours,
  addTo,
  callChipCount,
  callNumbers,
  colourOf,
  describe,
  layoutStats,
  neighbours,
  scaleLayout,
  spin,
  spotsOf,
  takeFrom,
  totalOf,
  volatilityOf,
  type CallBet,
  type Layout,
} from './math';
import { ChipDisc, Table, type Orientation } from './Table';
import { Wheel, type WheelHandle } from './Wheel';

const ACCENT = '#dc2626';
const CHIP_VALUES = [0.1, 0.5, 1, 5, 10, 25, 100, 500];
const NEIGHBOUR_OPTIONS = [0, 1, 2, 3, 4];

const cents = (x: number) => Math.round(x * 100) / 100;
const money = (x: number) => formatAmount(x, 2);
const sameLayout = (a: Layout, b: Layout) => {
  const ka = spotsOf(a);
  const kb = spotsOf(b);
  return ka.length === kb.length && ka.every((k) => Math.abs((b[k] ?? 0) - a[k]) < 0.005);
};

interface Last {
  id: number;
  pocket: number;
  winners: Set<string>;
  layout: Layout;
  paid: number;
  multiplier: number;
  stake: number;
}

function typing(e: KeyboardEvent) {
  const t = e.composedPath()[0] as HTMLElement | undefined;
  if (!t || !t.tagName) return false;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true;
  return t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type);
}

/** Picks the table's orientation from its container width (rotated on phones). */
function useOrientation() {
  const ref = useRef<HTMLDivElement>(null);
  const [o, setO] = useState<Orientation>('h');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setO(e.contentRect.width < 560 ? 'v' : 'h'));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, o] as const;
}

export default function Game() {
  const { rng } = useHost();
  const balance = useBalance();
  const chip = useBetInput(1);
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);
  const wheel = useRef<WheelHandle>(null);
  const [tableRef, orientation] = useOrientation();

  const [layout, setLayoutState] = useState<Layout>({});
  const [undoStack, setUndoStack] = useState<Layout[]>([]);
  const [lastSpun, setLastSpun] = useState<Layout | null>(null);
  const [nb, setNb] = useState(2);
  const [spinning, setSpinning] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [recent, setRecent] = useState<{ id: number; n: number }[]>([]);
  const [hover, setHover] = useState<number[] | null>(null);
  const [wheelHover, setWheelHover] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // The layout auto-bet scales (on win / on loss) and the layout the player built.
  const layoutRef = useRef(layout);
  const baseRef = useRef(layout);

  const resolved = useRef(0);
  const ticket = useTicket(() => (spinning ? resolved.current : 0));

  const total = cents(totalOf(layout));
  const stats = useMemo(() => layoutStats(layout), [layout]);
  const spinMs = turbo.turbo ? 1000 : 4200;

  // ---------- Layout editing ----------
  const commit = useCallback((next: Layout) => {
    setUndoStack((u) => [...u.slice(-79), layoutRef.current]);
    layoutRef.current = next;
    baseRef.current = next;
    setLayoutState(next);
    setLast(null); // any change after a spin clears the result off the board
  }, []);
  const room = () => balance - totalOf(layoutRef.current) + 1e-9;
  const add = (id: string) => {
    if (!(chip.value > 0) || chip.value > room()) return;
    commit(addTo(layoutRef.current, id, chip.value));
  };
  const remove = (id: string) => {
    if (!layoutRef.current[id]) return;
    commit(takeFrom(layoutRef.current, id, chip.value > 0 ? chip.value : layoutRef.current[id]));
  };
  const addCallBet = (c: CallBet) => {
    if (!(chip.value > 0) || chip.value * callChipCount(c) > room()) return;
    commit(addCall(layoutRef.current, c, chip.value));
  };
  const addNb = (n: number) => {
    if (!(chip.value > 0) || chip.value * (2 * nb + 1) > room()) return;
    commit(addNeighbours(layoutRef.current, n, nb, chip.value));
  };
  const scaleAll = (f: number) => {
    const t = totalOf(layoutRef.current);
    if (!(t > 0) || (f > 1 && t * f > balance + 1e-9)) return;
    const next: Layout = {};
    for (const id of spotsOf(layoutRef.current)) next[id] = Math.max(0.01, cents(layoutRef.current[id] * f));
    commit(next);
  };
  const clearAll = () => {
    if (totalOf(layoutRef.current) > 0) commit({});
  };
  const undo = () => {
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((u) => u.slice(0, -1));
    layoutRef.current = prev;
    baseRef.current = prev;
    setLayoutState(prev);
    setLast(null);
  };
  const canRebet = !!lastSpun && !sameLayout(lastSpun, layout) && totalOf(lastSpun) <= balance + 1e-9;
  const rebet = () => {
    if (canRebet && lastSpun) commit({ ...lastSpun });
  };

  // ---------- One spin ----------
  async function playOnce(stake: number): Promise<number | null> {
    let lay = layoutRef.current;
    if (Math.abs(totalOf(lay) - stake) > 0.005) {
      lay = scaleLayout(baseRef.current, stake);
      layoutRef.current = lay;
      setLayoutState(lay);
    }
    const t = cents(totalOf(lay));
    if (!(t > 0)) return null;
    if (!(await ticket.place(t))) return null;

    const res = spin(lay, rng.next());
    const cosmetic = rng.next();
    resolved.current = res.multiplier;
    setLast(null);
    setHover(null);
    setSpinning(true);
    wheel.current?.spin(WHEEL_INDEX[res.pocket], spinMs, cosmetic);
    if (!(await timers.wait(spinMs + 60))) return null;
    ticket.settle(res.multiplier);
    const id = ++seq.current;
    setLast({ id, pocket: res.pocket, winners: new Set(res.winners), layout: lay, paid: res.paid, multiplier: res.multiplier, stake: t });
    setLastSpun(lay);
    setRecent((r) => [{ id, n: res.pocket }, ...r].slice(0, 100));
    pushHistory(res.multiplier);
    setSpinning(false);
    return res.multiplier;
  }

  // Auto-bet scales the whole layout: its "bet" is the layout's total.
  const layoutBet: BetInput = {
    text: money(total),
    value: total,
    blocked: !(total > 0) ? 'Place chips on the table first' : total > balance + 1e-9 ? 'Not enough balance' : undefined,
    setText: (text: string) => {
      const v = Number(text);
      if (!(v > 0)) return;
      const next = scaleLayout(baseRef.current, v);
      layoutRef.current = next;
      setLayoutState(next);
    },
    half: () => scaleAll(0.5),
    double: () => scaleAll(2),
    normalize: () => {},
  };
  const auto = useAutoBet({ bet: layoutBet, play: playOnce, turbo: turbo.turbo });
  const busy = spinning || auto.running;
  const canBet = !busy && !layoutBet.blocked;

  const bet = () => {
    if (auto.mode === 'manual' && canBet) void playOnce(total);
  };
  useHotkeys({ space: bet }, !infoOpen);

  // Letter shortcuts: Z undo, X clear, D double, H halve, R rebet, 1–8 chip value.
  const keys = useRef({ undo, clearAll, scaleAll, rebet, busy, setChip: (v: number) => chip.setText(money(v)) });
  keys.current = { undo, clearAll, scaleAll, rebet, busy, setChip: (v: number) => chip.setText(money(v)) };
  useEffect(() => {
    if (infoOpen) return;
    const onDown = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const h = keys.current;
      if (h.busy) return;
      const key = e.key.toLowerCase();
      if (key === 'z' || e.key === 'Backspace') h.undo();
      else if (key === 'x') h.clearAll();
      else if (key === 'd') h.scaleAll(2);
      else if (key === 'h') h.scaleAll(0.5);
      else if (key === 'r') h.rebet();
      else if (/^[1-8]$/.test(e.key)) h.setChip(CHIP_VALUES[Number(e.key) - 1]);
    };
    window.addEventListener('keydown', onDown);
    return () => window.removeEventListener('keydown', onDown);
  }, [infoOpen]);

  // ---------- Derived view ----------
  const shownLayout = last && !busy ? last.layout : layout;
  const coveredNums = useMemo(() => {
    const s = new Set<number>();
    for (const id of spotsOf(shownLayout)) for (const n of SPOT_BY_ID[id].nums) s.add(n);
    return s;
  }, [shownLayout]);
  const hoverNums = useMemo(() => {
    if (busy) return new Set<number>();
    if (wheelHover !== null) return new Set(neighbours(wheelHover, nb));
    return new Set(hover ?? []);
  }, [hover, wheelHover, nb, busy]);
  const winner = last && !spinning ? last.pocket : null;
  // The result tile keeps the last number even after the board is cleared.
  const lastNum = spinning ? null : (recent[0]?.n ?? null);
  const vol = volatilityOf(stats.sd);

  const counts = { red: 0, black: 0, green: 0 };
  for (const r of recent) counts[colourOf(r.n)]++;
  const nRecent = Math.max(1, recent.length);

  const status = spinning
    ? 'No more bets…'
    : last
      ? describe(last.pocket)
      : total > 0
        ? `Total bet ${money(total)} · press Bet`
        : 'Place your chips on the table';

  const pickable = !busy && chip.value > 0;

  return (
    <GameLayout
      name="Roulette"
      accent={ACCENT}
      className="rl-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={spinning} />

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
          <div className="rl-denoms" role="group" aria-label="Chip presets">
            {CHIP_VALUES.map((v, i) => (
              <button
                key={v}
                type="button"
                className={'rl-denom' + (Math.abs(chip.value - v) < 1e-9 ? ' on' : '')}
                disabled={busy}
                onClick={() => chip.setText(money(v))}
                title={`Chip ${money(v)} (key ${i + 1})`}
                aria-label={`Chip ${money(v)}`}
              >
                <svg viewBox="-15 -15 30 30" aria-hidden="true">
                  <ChipDisc value={v} r={14} />
                </svg>
              </button>
            ))}
          </div>

          <Label hint="click a wheel pocket">Neighbours bet</Label>
          <Chips
            label="Neighbours either side"
            value={nb}
            disabled={busy}
            onChange={(v) => {
              setNb(v);
              setLast(null);
            }}
            options={NEIGHBOUR_OPTIONS.map((k) => ({ value: k, label: k === 0 ? 'Single' : `±${k}`, title: `${2 * k + 1} straight-ups centred on the pocket` }))}
          />

          <Label hint={total > 0 ? <VolBadge level={vol} /> : undefined}>Your bets</Label>
          <div className="rl-tools">
            <button type="button" className="og-ghost" disabled={busy || !undoStack.length} onClick={undo} title="Undo (Z)">
              Undo
            </button>
            <button type="button" className="og-ghost" disabled={busy || !canRebet} onClick={rebet} title="Repeat the last spin's chips (R)">
              Rebet
            </button>
            <button type="button" className="og-ghost" disabled={busy || total <= 0 || total * 2 > balance + 1e-9} onClick={() => scaleAll(2)} title="Double every chip (D)">
              2×
            </button>
            <button type="button" className="og-ghost" disabled={busy || total <= 0} onClick={clearAll} title="Clear the table (X)">
              Clear
            </button>
          </div>
          <dl className="og-stats">
            <dt>Total bet</dt>
            <dd>{money(total)}</dd>
            <dt>Numbers covered</dt>
            <dd>{total > 0 ? `${stats.covered} / 37` : '–'}</dd>
            <dt>Chance of profit</dt>
            <dd>{total > 0 ? fmtChance(stats.pProfit) : '–'}</dd>
            <dt>Best payout</dt>
            <dd>{total > 0 ? money(stats.maxMult * total) : '–'}</dd>
          </dl>

          {auto.mode === 'manual' ? (
            <ActionButton disabled={!canBet} onClick={bet}>
              {spinning ? 'Spinning…' : total > 0 ? `Bet ${money(total)}` : 'Bet'}
            </ActionButton>
          ) : (
            <AutoBetControls auto={auto} disabled={!!layoutBet.blocked || spinning}>
              <p className="rl-auto-note">
                {total > 0
                  ? `Each auto bet spins the chips on the table (${spotsOf(layout).length} ${spotsOf(layout).length === 1 ? 'bet' : 'bets'}, ${money(total)}). On win / on loss scale the whole layout.`
                  : 'Place chips on the table first; every auto bet repeats that layout.'}
              </p>
            </AutoBetControls>
          )}
          {layoutBet.blocked && !busy && <p className={'rl-blocked' + (total > 0 ? ' err' : '')}>{layoutBet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={spinning ? 'live' : last ? (last.multiplier >= 1 ? 'won' : 'lost') : 'idle'} history={history} />

      <Board className="rl-board">
        <InstantResult multiplier={last && !spinning ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />
        <div className="rl-wheel-wrap">
          <Wheel
            ref={wheel}
            highlight={hoverNums}
            covered={coveredNums}
            winner={winner}
            spinning={spinning}
            onPick={pickable ? addNb : null}
            onHover={(n) => setWheelHover(pickable ? n : null)}
          />
        </div>
        <div className="rl-side">
          <div className={'rl-last ' + (lastNum !== null ? colourOf(lastNum) : 'none')} key={spinning ? 'spin' : (recent[0]?.id ?? 0)}>
            <span>{spinning ? 'No more bets' : 'Last number'}</span>
            <b>{lastNum !== null ? lastNum : spinning ? '…' : '–'}</b>
            <small>{lastNum !== null ? describe(lastNum).split(' · ').slice(1).join(' · ') : spinning ? 'Ball in play' : 'No spin yet'}</small>
          </div>
          <div className="rl-recent" aria-label="Recent numbers">
            {recent.length === 0 && <span className="rl-none">Recent numbers appear here</span>}
            {recent.slice(0, 10).map((r, i) => (
              <span key={r.id} className={'rl-num ' + colourOf(r.n) + (i === 0 ? ' first' : '')}>
                {r.n}
              </span>
            ))}
          </div>
          <div className="rl-split" title={`Last ${recent.length} spins`}>
            <div className="rl-split-bar">
              <i className="red" style={{ flexGrow: recent.length ? counts.red : 18 }} />
              <i className="green" style={{ flexGrow: recent.length ? counts.green : 1 }} />
              <i className="black" style={{ flexGrow: recent.length ? counts.black : 18 }} />
            </div>
            <div className="rl-split-legend">
              <span>Red {recent.length ? Math.round((100 * counts.red) / nRecent) : 49}%</span>
              <span>Zero {recent.length ? Math.round((100 * counts.green) / nRecent) : 3}%</span>
              <span>Black {recent.length ? Math.round((100 * counts.black) / nRecent) : 49}%</span>
            </div>
            <small>{recent.length ? `Last ${recent.length} spins` : 'Expected share: 18 / 1 / 18 of 37'}</small>
          </div>
        </div>
      </Board>

      <div className="rl-table-wrap" ref={tableRef}>
        <Table
          orientation={orientation}
          layout={shownLayout}
          highlight={hoverNums}
          winner={winner}
          winners={last && !busy ? last.winners : null}
          disabled={busy}
          onAdd={add}
          onRemove={remove}
          onHover={setHover}
        />
      </div>

      <div className="rl-calls" role="group" aria-label="Announced bets">
        <span className="rl-calls-label">Racetrack</span>
        {CALL_KEYS.map((c) => (
          <button
            key={c}
            type="button"
            className="rl-call"
            disabled={busy || !(chip.value > 0)}
            onClick={() => addCallBet(c)}
            onPointerEnter={() => setHover(callNumbers(c))}
            onPointerLeave={() => setHover(null)}
            title={`${CALL_BETS[c].sub}: ${callChipCount(c)} chips covering ${callNumbers(c).length} numbers`}
          >
            <b>{CALL_BETS[c].name}</b>
            <small>
              {callChipCount(c)} chips · {money(chip.value * callChipCount(c))}
            </small>
          </button>
        ))}
      </div>

      {infoOpen && (
        <InfoModal title="Roulette" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A ball is spun around a single-zero wheel of 37 pockets (0–36) and settles in one. Put chips on the numbers or groups you think it will land in; every
              bet that covers the winning number pays.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a chip value (a preset, or type one), then click the table to place it. Click a line between numbers for a split, a corner for four numbers, the edge of a column for a street or six line.</li>
              <li>Right-click (or Shift-click) a bet to take a chip off. Undo, Rebet, 2× and Clear work on the whole table.</li>
              <li>Racetrack buttons place the classic announced bets (Voisins, Tiers, Orphelins, Zero game). Click a pocket on the wheel for a neighbours bet: one chip on it and on the chosen number of pockets either side.</li>
              <li>Press Bet (or Space). Chips stay on the table, so Space spins the same layout again. Auto repeats your layout with your stop rules.</li>
            </ol>
            <p>
              Keys: <b>Space</b> spin · <b>Z</b> undo · <b>X</b> clear · <b>D</b> double · <b>H</b> halve · <b>R</b> rebet · <b>1–8</b> chip value.
            </p>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Every pocket is equally likely, so a bet's chance is the count of numbers it covers out of 37. Hover any bet, racetrack button or wheel pocket to light the
              numbers it covers on the table and the wheel. The panel shows how many numbers your chips cover and your exact chance of a profit.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              A bet covering k numbers pays 36 ÷ k for 1 (stake included). Its expected return is (k ÷ 37) × (36 ÷ k) = 36 ÷ 37 = {(RTP * 100).toFixed(2)}% whatever k is.
              By linearity of expectation any mix of chips returns the same: the layout changes only how bumpy the results are. The house edge is the green zero, 1 ÷ 37 =
              2.70%.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <table className="rl-paytable">
              <thead>
                <tr>
                  <th>Bet</th>
                  <th>Numbers</th>
                  <th>Pays</th>
                  <th>Chance</th>
                </tr>
              </thead>
              <tbody>
                {PAYTABLE.map((p) => (
                  <tr key={p.kind}>
                    <td>
                      {p.kind === 'red' ? 'Red / Black, Odd / Even, 1–18 / 19–36' : p.kind === 'column' ? 'Column (2:1)' : KIND_NAMES[p.kind]}
                      {p.kind === 'trio' ? ' (0-1-2, 0-2-3)' : p.kind === 'basket' ? ' (0-1-2-3)' : ''}
                    </td>
                    <td>{p.covers}</td>
                    <td>{p.toOne} to 1</td>
                    <td>{fmtChance(p.covers / 37)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Every bet returns {(RTP * 100).toFixed(2)}%. Announced bets are bundles of ordinary table bets (Voisins 9 chips, Tiers 6, Orphelins 5, Zero game 4), so they
              return the same. The pocket is drawn the moment you bet; the wheel and ball only show it. The largest possible win is 36× a straight-up.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
