import { formatAmount } from '@originals/game-sdk';
import { useBalance, useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  Board,
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
  fmtMult,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
  type BetInput,
} from '@originals/game-sdk/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DiceTray, DieFace, FACE_ROT, Table, type Rot } from './Board';
import {
  BETS,
  BET_BY_ID,
  MAX_MULTIPLIER,
  RTP,
  TOTAL_PAYS,
  betStats,
  isTriple,
  layoutStats,
  paysLabel,
  placedIds,
  returnOf,
  rollDice,
  scaleLayout,
  settle,
  sumOf,
  totalOf,
  volatilityOf,
  type Dice,
  type Layout,
} from './math';

const ACCENT = '#fb7185';
const CHIP_VALUES = [0.1, 1, 5, 25, 100];
const KEY_OF: Record<string, string> = { s: 'small', b: 'big', o: 'odd', e: 'even', a: 'anyTriple' };

const cents = (x: number) => Math.round(x * 100) / 100;
const money = (x: number) => formatAmount(x, 2);
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

interface Last {
  id: number;
  dice: Dice;
  layout: Layout;
  winners: string[];
  paid: number;
  multiplier: number;
  stake: number;
}

interface Recent {
  id: number;
  dice: Dice;
}

function typing(e: KeyboardEvent) {
  const t = e.composedPath()[0] as HTMLElement | undefined;
  if (!t || !t.tagName) return false;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true;
  return t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type);
}

const tagOf = (d: Dice) => (isTriple(d) ? 'triple' : sumOf(d) <= 10 ? 'small' : 'big');
const describe = (d: Dice) => (isTriple(d) ? `Triple ${d[0]}` : `${sumOf(d) <= 10 ? 'Small' : 'Big'} · ${sumOf(d) % 2 ? 'Odd' : 'Even'}`);

const INITIAL: Dice = [4, 2, 6];
const restRot = (d: Dice): Rot[] => d.map((n, i) => ({ ...FACE_ROT[n], z: [-8, 6, -4][i] }));

export default function Game() {
  const { rng } = useHost();
  const balance = useBalance();
  const chip = useBetInput(1);
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [layout, setLayoutState] = useState<Layout>({});
  const [undoStack, setUndoStack] = useState<Layout[]>([]);
  const [rebetLayout, setRebetLayout] = useState<Layout | null>(null);
  const [rolling, setRolling] = useState(false);
  const [faces, setFaces] = useState<Dice>(INITIAL);
  const [rots, setRots] = useState<Rot[]>(() => restRot(INITIAL));
  const [hop, setHop] = useState(0);
  const [last, setLast] = useState<Last | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // The layout auto-bet scales (on win / on loss), and the one the player built.
  const layoutRef = useRef(layout);
  const baseRef = useRef(layout);
  const rotsRef = useRef(rots);
  rotsRef.current = rots;

  // The drawn outcome's multiplier, set the instant the dice are drawn. If the
  // game unmounts mid-tumble, the open ticket settles at this value (win or loss).
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  const total = totalOf(layout);
  const stats = useMemo(() => layoutStats(layout), [layout]);
  const rollMs = turbo.turbo ? 380 : 1300;

  // ---------- Layout editing ----------
  function commit(next: Layout) {
    setUndoStack((u) => [...u.slice(-79), layoutRef.current]);
    layoutRef.current = next;
    baseRef.current = next;
    setLayoutState(next);
    setLast(null); // a change after a round clears the result off the table
  }
  const addChip = (id: string) => {
    if (!(chip.value > 0)) return;
    commit({ ...layoutRef.current, [id]: cents((layoutRef.current[id] ?? 0) + chip.value) });
  };
  const removeChip = (id: string) => {
    const cur = layoutRef.current[id] ?? 0;
    if (cur <= 0) return;
    const next = { ...layoutRef.current };
    const v = cents(cur - chip.value);
    if (v > 0) next[id] = v;
    else delete next[id];
    commit(next);
  };
  const scaleAll = (f: number) => {
    const cur = layoutRef.current;
    if (totalOf(cur) <= 0) return;
    const next: Layout = {};
    for (const id of placedIds(cur)) next[id] = Math.max(0.01, cents(cur[id] * f));
    commit(next);
  };
  const clearAll = () => {
    if (totalOf(layoutRef.current) > 0) commit({});
  };
  const rebet = () => {
    if (rebetLayout && totalOf(rebetLayout) > 0) commit({ ...rebetLayout });
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

  // ---------- One roll ----------
  async function playOnce(stake: number): Promise<number | null> {
    let lay = layoutRef.current;
    if (Math.abs(totalOf(lay) - stake) > 0.005) {
      lay = scaleLayout(baseRef.current, stake);
      layoutRef.current = lay;
      setLayoutState(lay);
    }
    const t = totalOf(lay);
    if (!(t > 0)) return null;
    if (!(await ticket.place(t))) return null;

    const dice = rollDice(rng.next(), rng.next(), rng.next());
    const res = settle(lay, dice);
    resolved.current = res.multiplier;

    // Cosmetic tumble: two or three full turns on each axis, landing on the drawn face.
    const next = rotsRef.current.map((r, i) => {
      const f = FACE_ROT[dice[i]];
      const turnsX = 2 + Math.floor(rng.next() * 2);
      const turnsY = 1 + Math.floor(rng.next() * 2);
      return {
        x: Math.ceil(r.x / 360) * 360 + 360 * turnsX + f.x,
        y: Math.ceil(r.y / 360) * 360 + 360 * turnsY + f.y,
        z: Math.ceil(r.z / 360) * 360 + 360 + Math.round(-14 + 28 * rng.next()),
      };
    });

    setLast(null);
    setRolling(true);
    setHop((h) => h + 1);
    setRots(next);
    // Unmounted mid-tumble: the ticket was already settled at the drawn result.
    if (!(await timers.wait(rollMs + 90))) return null;
    ticket.settle(res.multiplier);
    setFaces(dice);
    setRebetLayout(lay);
    setLast({ id: ++seq.current, dice, layout: lay, winners: res.winners, paid: res.paid, multiplier: res.multiplier, stake: t });
    setRecent((r) => [{ id: seq.current, dice }, ...r].slice(0, 60));
    pushHistory(res.multiplier);
    setRolling(false);
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
  const busy = rolling || auto.running;
  const canBet = !busy && !layoutBet.blocked;

  const bet = () => {
    if (auto.mode === 'manual' && canBet) void playOnce(total);
  };
  useHotkeys({ space: bet }, !infoOpen);

  // Letter shortcuts: S/B/O/E/A add a chip (Shift removes), Z undo, X clear, D double, H halve, R rebet, 1–5 chip value.
  const keys = useRef({ addChip, removeChip, undo, clearAll, scaleAll, rebet, busy, setChip: (v: number) => chip.setText(money(v)) });
  keys.current = { addChip, removeChip, undo, clearAll, scaleAll, rebet, busy, setChip: (v: number) => chip.setText(money(v)) };
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
      else if (key === 'x') h.clearAll();
      else if (key === 'd') h.scaleAll(2);
      else if (key === 'h') h.scaleAll(0.5);
      else if (key === 'r') h.rebet();
      else if (/^[1-5]$/.test(e.key)) h.setChip(CHIP_VALUES[Number(e.key) - 1]);
    };
    window.addEventListener('keydown', onDown);
    return () => window.removeEventListener('keydown', onDown);
  }, [infoOpen]);

  // ---------- Derived display ----------
  const shown = last?.layout ?? layout;
  const showResult = !!last && !rolling;
  const hits = useMemo(() => (showResult && last ? new Set(BETS.filter((b) => returnOf(b, last.dice) > 0).map((b) => b.id)) : null), [showResult, last]);
  const paidBy = useMemo(() => {
    const out: Record<string, number> = {};
    if (last) for (const id of last.winners) out[id] = cents(last.layout[id] * returnOf(BET_BY_ID[id], last.dice));
    return out;
  }, [last]);

  const vol = volatilityOf(stats.sd);
  const status = rolling
    ? 'Rolling…'
    : last
      ? `Rolled ${last.dice.join(' · ')} = ${sumOf(last.dice)}`
      : total > 0
        ? `Total bet ${money(total)} · press Bet`
        : 'Place chips on the table';

  const hb = hover ? BET_BY_ID[hover] : null;
  const hs = hb ? betStats(hb.id) : null;
  const counts = { small: 0, big: 0, triple: 0 };
  for (const r of recent) counts[tagOf(r.dice)]++;

  return (
    <GameLayout
      name="Sic Bo"
      accent={ACCENT}
      className="sb-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={rolling} />

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
          <div className="sb-denoms" role="group" aria-label="Chip presets">
            {CHIP_VALUES.map((v, i) => (
              <button
                key={v}
                type="button"
                className={`sb-denom t${i + 1}` + (Math.abs(chip.value - v) < 1e-9 ? ' on' : '')}
                disabled={busy}
                onClick={() => chip.setText(money(v))}
                title={`Chip ${money(v)} (key ${i + 1})`}
              >
                {v < 1 ? v.toFixed(1) : v}
              </button>
            ))}
          </div>

          <Label hint={total > 0 ? <VolBadge level={vol} /> : undefined}>Your chips</Label>
          <div className="sb-tools">
            <button type="button" className="og-ghost" disabled={busy || !undoStack.length} onClick={undo} title="Undo (Z)">
              Undo
            </button>
            <button type="button" className="og-ghost" disabled={busy || !rebetLayout || total > 0} onClick={rebet} title="Put back the last round's chips (R)">
              Rebet
            </button>
            <button type="button" className="og-ghost" disabled={busy || total <= 0} onClick={() => scaleAll(0.5)} title="Halve every chip (H)">
              ½
            </button>
            <button type="button" className="og-ghost" disabled={busy || total <= 0} onClick={() => scaleAll(2)} title="Double every chip (D)">
              2×
            </button>
            <button type="button" className="og-ghost" disabled={busy || total <= 0} onClick={clearAll} title="Clear the table (X)">
              Clear
            </button>
          </div>
          <dl className={'og-stats' + (auto.mode === 'auto' ? ' sb-stats-tight' : '')}>
            <dt>Total bet</dt>
            <dd>{money(total)}</dd>
            <dt>Chance to win</dt>
            <dd>{total > 0 ? fmtChance(stats.pHit) : '–'}</dd>
            <dt>Best payout</dt>
            <dd>{total > 0 ? `${money(stats.maxMult * total)}` : '–'}</dd>
            <dt>Layout RTP</dt>
            <dd>{total > 0 ? pct(stats.rtp) : '–'}</dd>
          </dl>

          {auto.mode === 'manual' ? (
            <ActionButton disabled={!canBet} onClick={bet}>
              {rolling ? 'Rolling…' : total > 0 ? `Bet ${money(total)}` : 'Bet'}
            </ActionButton>
          ) : (
            <AutoBetControls auto={auto} disabled={!!layoutBet.blocked || rolling} />
          )}
          {layoutBet.blocked && !busy && <p className={'sb-blocked' + (total > 0 ? ' err' : '')}>{layoutBet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={rolling ? 'live' : last ? (last.multiplier >= 1 ? 'won' : 'lost') : 'idle'} history={history} />

      <Board className="sb-board">
        <InstantResult multiplier={showResult ? last!.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />
        <DiceTray rots={rots} ms={rollMs} hop={hop} rolling={rolling} faces={faces} state={showResult ? (last!.multiplier >= 1 ? 'win' : 'lose') : 'idle'} />
        <div className={'sb-verdict' + (showResult ? ' on' : '')} aria-live="polite">
          {showResult && last ? (
            <>
              <b className="sb-sum">{sumOf(last.dice)}</b>
              <span className={`sb-tag ${tagOf(last.dice)}`}>{describe(last.dice)}</span>
            </>
          ) : (
            <span className="sb-hint">{rolling ? 'Dice in the air…' : 'Three dice · 216 equally likely rolls'}</span>
          )}
        </div>
      </Board>

      <Table
        layout={shown}
        hits={hits}
        paid={paidBy}
        disabled={busy}
        onAdd={addChip}
        onRemove={removeChip}
        onHover={setHover}
        money={money}
      />

      <div className="sb-info" aria-live="polite">
        {hb && hs ? (
          <>
            <p>
              <b>{hb.name}</b> pays {paysLabel(hb)}
              {hb.kind === 'single' ? ' (1, 2 or 3 dice)' : ''} · wins on <b>{hs.wins}</b> of 216 rolls ({pct(hs.chance)}) · RTP {pct(hs.rtp)}
            </p>
            <div className="sb-cover">
              <i style={{ width: `${hs.chance * 100}%` }} />
            </div>
          </>
        ) : total > 0 ? (
          <>
            <p>
              Your chips pay on <b>{Math.round(stats.pHit * 216)}</b> of 216 rolls ({pct(stats.pHit)}), profit on {Math.round(stats.pProfit * 216)} · layout RTP {pct(stats.rtp)}
            </p>
            <div className="sb-cover">
              <i style={{ width: `${stats.pHit * 100}%` }} />
              <i className="profit" style={{ width: `${stats.pProfit * 100}%` }} />
            </div>
          </>
        ) : (
          <>
            <p>Click a cell to place a chip; right-click or Shift-click removes one. The bar in each cell is its chance.</p>
            <div className="sb-cover empty" />
          </>
        )}
      </div>

      <div className="sb-recent">
        <span className="sb-recent-label">Previous</span>
        <div className="sb-rolls" aria-label="Recent rolls">
          {recent.length === 0 && <span className="sb-none">No rolls yet</span>}
          {recent.slice(0, 16).map((r) => (
            <span key={r.id} className={`sb-roll ${tagOf(r.dice)}`} title={`${r.dice.join(' · ')} = ${sumOf(r.dice)}`}>
              <span className="sb-roll-faces">
                {r.dice.map((n, i) => (
                  <DieFace key={i} n={n} size={12} />
                ))}
              </span>
              <b>{sumOf(r.dice)}</b>
            </span>
          ))}
        </div>
        <div className="sb-counts" title={`Last ${recent.length} rolls`}>
          <span className="small">S {counts.small}</span>
          <span className="big">B {counts.big}</span>
          <span className="triple">T {counts.triple}</span>
        </div>
      </div>

      {infoOpen && (
        <InfoModal title="Sic Bo" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Three dice are rolled. Put chips on what you think they will show: Big or Small, Odd or Even, an exact total, a number, a pair of numbers, a double or a triple.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a chip value (or a preset, keys 1–5), then click cells on the table to place chips. Click again to add more; right-click or Shift-click removes one.</li>
              <li>Back as many cells as you like in the same roll. Undo, ½, 2× and Clear edit the whole layout; Rebet puts back last round's chips.</li>
              <li>Press Bet (or Space). Your chips stay on the table, so Space again rolls the same layout. Auto repeats it for the number of bets you set; On win / On loss scale every chip together, and it stops early on your profit or loss limit.</li>
            </ol>
            <p>
              Keys: <b>Space</b> bet · <b>S B O E A</b> chip on Small, Big, Odd, Even, Any triple (Shift removes) · <b>Z</b> undo · <b>D</b> double · <b>H</b> halve ·{' '}
              <b>X</b> clear · <b>R</b> rebet · <b>1–5</b> chip value.
            </p>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Each die is fair, so all 6 × 6 × 6 = 216 rolls are equally likely. Every cell shows how many of them it wins on as a thin bar along its foot (its share of the
              cell width is its chance), and hovering a cell spells it out. The bar under the table shows the share of rolls your whole layout pays on.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              A bet's return is (Σ payouts over the 216 rolls) ÷ 216. Totals count compositions of t into three parts from 1 to 6; Small and Big lose on the three triples in
              their range; a single number shows on exactly k dice in C(3,k)·5^(3−k) rolls; a pair needs both faces, 216 − 125 − 125 + 64 = 30 rolls (inclusion–exclusion).
              Chips on different cells are independent bets on the same roll, so by linearity of expectation a layout returns the stake-weighted average of its bets' RTPs.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <table className="sb-paytable">
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
                    ['Small / Big (not triples)', 'small'],
                    ['Odd / Even (not triples)', 'odd'],
                    ...[4, 5, 6, 7, 8, 9, 10].map((t) => [`Total ${t} or ${21 - t}`, `total-${t}`]),
                    ['Single number', 'single-1'],
                    ['Two-dice combination', 'combo-1-2'],
                    ['Specific double', 'double-1'],
                    ['Specific triple', 'triple-1'],
                    ['Any triple', 'anyTriple'],
                  ] as [string, string][]
                ).map(([name, id]) => {
                  const b = BET_BY_ID[id];
                  const s = betStats(id);
                  return (
                    <tr key={id}>
                      <td>{name}</td>
                      <td>{b.kind === 'single' ? '1:1 / 2:1 / 3:1' : b.kind === 'total' ? `${TOTAL_PAYS[b.a!]}:1` : `${b.pays}:1`}</td>
                      <td>{s.wins} / 216</td>
                      <td>{pct(s.rtp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p>
              Payouts are "to one": a win also returns your chip. The best bets are Small, Big, Odd and Even at {pct(RTP)}; the top payout is a specific triple at{' '}
              {fmtMult(MAX_MULTIPLIER)} your chip. The dice are drawn the moment you bet; the tumble only shows them.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
