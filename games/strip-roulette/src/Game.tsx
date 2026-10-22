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
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  BET_KEYS,
  BET_NAMES,
  EMPTY_LAYOUT,
  RTP,
  STRIPS,
  STRIP_NAMES,
  chanceOf,
  layoutStats,
  payoutOf,
  scaleLayout,
  slotsCovered,
  spin,
  stripOrder,
  totalOf,
  volatilityOf,
  type BetKey,
  type Colour,
  type Layout,
  type StripSize,
} from './math';

const ACCENT = '#14b8a6';
const CHIP_VALUES = [0.1, 1, 5, 25, 100];
const KEY_OF: Record<string, BetKey> = { r: 'red', g: 'green', b: 'black', e: 'edge' };
const KEY_LABEL: Record<BetKey, string> = { red: 'R', green: 'G', black: 'B', edge: 'E' };

const cents = (x: number) => Math.round(x * 100) / 100;
/** 2.12142857 → "2.1214×", 14.85 → "14.85×". */
const fmtPay = (x: number) => `${Number(x.toFixed(4))}×`;
const money = (x: number) => formatAmount(x, 2);

/** Slots the strip must travel at least, so every spin is a proper run. */
const minTravel = (n: number) => Math.max(40, 2 * n);
/** Copies of the cycle to render: start in [n, 2n), travel, land within one more cycle, plus the visible margin. */
const copiesFor = (n: number) => Math.ceil((4 * n + minTravel(n) + 24) / n);
/** Rest position: the green slot of the second copy under the pointer. */
const restPos = (n: number) => n + 0.5;

interface Last {
  id: number;
  slot: number;
  colour: Colour;
  number: number;
  winners: BetKey[];
  layout: Layout;
  paid: number;
  multiplier: number;
  stake: number;
}

interface Recent {
  id: number;
  colour: Colour;
  number: number;
}

function typing(e: KeyboardEvent) {
  const t = e.composedPath()[0] as HTMLElement | undefined;
  if (!t || !t.tagName) return false;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true;
  return t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type);
}

export default function Game() {
  const { rng } = useHost();
  const balance = useBalance();
  const chip = useBetInput(1);
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [n, setN] = useState<StripSize>(15);
  const [layout, setLayoutState] = useState<Layout>(EMPTY_LAYOUT);
  const [undoStack, setUndoStack] = useState<Layout[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [pos, setPos] = useState({ p: restPos(15), ms: 0 });
  const [last, setLast] = useState<Last | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // The layout auto-bet scales (on win / on loss) and the layout the player built.
  const layoutRef = useRef(layout);
  const baseRef = useRef(layout);
  const posRef = useRef(pos.p);
  posRef.current = pos.p;

  // Fair value if the game unmounts mid-spin: the drawn result, read from a ref
  // (not render state) so leaving before the next render can't forfeit a win
  // or dodge a loss. It is set in the same tick the ticket is accepted.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  const total = cents(totalOf(layout));
  const stats = useMemo(() => layoutStats(layout, n), [layout, n]);
  const spinMs = turbo.turbo ? 650 : 2800;

  // ---------- Layout editing ----------
  function commit(next: Layout) {
    setUndoStack((u) => [...u.slice(-49), layoutRef.current]);
    layoutRef.current = next;
    baseRef.current = next;
    setLayoutState(next);
    setLast(null); // a settings change clears the result off the board
  }
  const addChip = (k: BetKey) => {
    if (!(chip.value > 0)) return;
    commit({ ...layoutRef.current, [k]: cents(layoutRef.current[k] + chip.value) });
  };
  const removeChip = (k: BetKey) => {
    const cur = layoutRef.current[k];
    if (cur <= 0) return;
    commit({ ...layoutRef.current, [k]: Math.max(0, cents(cur - chip.value)) });
  };
  const scaleAll = (f: number) => {
    if (total <= 0) return;
    const next = { ...EMPTY_LAYOUT };
    for (const k of BET_KEYS) next[k] = layoutRef.current[k] > 0 ? Math.max(0.01, cents(layoutRef.current[k] * f)) : 0;
    commit(next);
  };
  const clearAll = () => {
    if (total > 0) commit({ ...EMPTY_LAYOUT });
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
  const changeStrip = (size: StripSize) => {
    if (size === n) return;
    setN(size);
    setPos({ p: restPos(size), ms: 0 });
    setLast(null);
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
    resolved.current = 0;
    if (!(await ticket.place(t))) return null;

    const res = spin(lay, n, rng.next());
    resolved.current = res.multiplier;
    // Cosmetic: where inside the winning slot the pointer comes to rest.
    const offset = 0.14 + 0.72 * rng.next();
    const p0 = posRef.current;
    const travel = minTravel(n);
    let target = Math.floor((p0 + travel) / n) * n + res.slot + offset;
    if (target < p0 + travel) target += n;

    const slot = stripOrder(n)[res.slot];
    setLast(null);
    setSpinning(true);
    setPos({ p: target, ms: spinMs });
    await timers.wait(spinMs + 60);
    ticket.settle(res.multiplier);
    // Re-base the strip to an identical position in the second copy, without animating.
    setPos({ p: n + (target % n), ms: 0 });
    setLast({ id: ++seq.current, slot: res.slot, colour: slot.colour, number: slot.number, winners: res.winners, layout: lay, paid: res.paid, multiplier: res.multiplier, stake: t });
    setRecent((r) => [{ id: seq.current, colour: slot.colour, number: slot.number }, ...r].slice(0, 100));
    pushHistory(res.multiplier);
    setSpinning(false);
    return res.multiplier;
  }

  // Auto-bet scales the whole layout: its "bet" is the layout's total.
  const layoutBet: BetInput = {
    text: money(total),
    value: total,
    blocked: !(total > 0) ? 'Place chips on a bet first' : total > balance + 1e-9 ? 'Not enough balance' : undefined,
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

  // Letter shortcuts: R / G / B / E add a chip (Shift removes), Z undoes, X clears, D doubles.
  const keys = useRef({ addChip, removeChip, undo, clearAll, scaleAll, busy });
  keys.current = { addChip, removeChip, undo, clearAll, scaleAll, busy };
  useEffect(() => {
    if (infoOpen) return;
    const onDown = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const h = keys.current;
      if (h.busy) return;
      const key = e.key.toLowerCase();
      const k = KEY_OF[key];
      if (k) e.shiftKey ? h.removeChip(k) : h.addChip(k);
      else if (key === 'z' || e.key === 'Backspace') h.undo();
      else if (key === 'x') h.clearAll();
      else if (key === 'd') h.scaleAll(2);
    };
    window.addEventListener('keydown', onDown);
    return () => window.removeEventListener('keydown', onDown);
  }, [infoOpen]);

  // ---------- Strip ----------
  const order = stripOrder(n);
  const cells = useMemo(() => Array.from({ length: n * copiesFor(n) }, (_, j) => stripOrder(n)[j % n]), [n]);
  const hitIdx = last && !spinning ? Math.floor(pos.p) : -1;
  const h = (n - 1) / 2;

  const counts = { red: 0, green: 0, black: 0 } as Record<Colour, number>;
  for (const r of recent) counts[r.colour]++;

  const vol = volatilityOf(stats.sd);
  const shown = last?.layout ?? layout;

  const status = spinning
    ? 'Spinning…'
    : last
      ? `${last.colour === 'green' ? 'Green' : last.colour === 'red' ? 'Red' : 'Black'} ${last.number}${order[last.slot].edge ? ' · edge' : ''}`
      : total > 0
        ? `Total bet ${money(total)} · press Bet`
        : 'Place chips on a colour';

  return (
    <GameLayout
      name="Strip Roulette"
      accent={ACCENT}
      className="sr-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={spinning} />

          <Label hint={`Balance ${money(balance)}`}>Chip value</Label>
          <div className="og-bet-row">
            <input
              value={chip.text}
              inputMode="decimal"
              aria-label="Chip value"
              disabled={busy}
              onChange={(e) => chip.setText(e.target.value)}
              onBlur={chip.normalize}
            />
            <button type="button" disabled={busy} onClick={chip.half} aria-label="Halve chip">
              ½
            </button>
            <button type="button" disabled={busy} onClick={chip.double} aria-label="Double chip">
              2×
            </button>
          </div>
          <div className="sr-denoms" role="group" aria-label="Chip presets">
            {CHIP_VALUES.map((v) => (
              <button
                key={v}
                type="button"
                className={'sr-denom' + (Math.abs(chip.value - v) < 1e-9 ? ' on' : '')}
                disabled={busy}
                onClick={() => chip.setText(money(v))}
              >
                {v < 1 ? v.toFixed(2) : v}
              </button>
            ))}
          </div>

          <Label hint={`${STRIP_NAMES[n]} · 1 green in ${n}`}>Strip length</Label>
          <Chips
            label="Strip length"
            value={n}
            disabled={busy}
            onChange={(v) => changeStrip(v)}
            options={STRIPS.map((s) => ({ value: s, label: `${s}`, title: `${STRIP_NAMES[s]}: ${(s - 1) / 2} red, ${(s - 1) / 2} black, 1 green` }))}
          />

          <Label hint={total > 0 ? <VolBadge level={vol} /> : undefined}>Your bets</Label>
          <div className="sr-tools">
            <button type="button" className="og-ghost" disabled={busy || !undoStack.length} onClick={undo} title="Undo (Z)">
              Undo
            </button>
            <button type="button" className="og-ghost" disabled={busy || total <= 0} onClick={() => scaleAll(0.5)} title="Halve every bet">
              ½
            </button>
            <button type="button" className="og-ghost" disabled={busy || total <= 0} onClick={() => scaleAll(2)} title="Double every bet (D)">
              2×
            </button>
            <button type="button" className="og-ghost" disabled={busy || total <= 0} onClick={clearAll} title="Clear all bets (X)">
              Clear
            </button>
          </div>
          <dl className="og-stats">
            <dt>Total bet</dt>
            <dd>{money(total)}</dd>
            <dt>Chance to win</dt>
            <dd>{total > 0 ? fmtChance(stats.pHit) : '–'}</dd>
            <dt>Best payout</dt>
            <dd>{total > 0 ? money(stats.maxMult * total) : '–'}</dd>
          </dl>

          {auto.mode === 'manual' ? (
            <ActionButton disabled={!canBet} onClick={bet}>
              {spinning ? 'Spinning…' : total > 0 ? `Bet ${money(total)}` : 'Bet'}
            </ActionButton>
          ) : (
            <AutoBetControls auto={auto} disabled={!!layoutBet.blocked || spinning}>
              <p className="sr-auto-note">
                {total > 0 ? (
                  <>
                    Each auto bet spins your layout:{' '}
                    {BET_KEYS.filter((k) => layout[k] > 0)
                      .map((k) => `${BET_NAMES[k]} ${money(layout[k])}`)
                      .join(' · ')}
                    . On win / on loss scale the whole layout.
                  </>
                ) : (
                  'Place chips on the colours first; every auto bet repeats that layout.'
                )}
              </p>
            </AutoBetControls>
          )}
          {layoutBet.blocked && !busy && <p className={'sr-blocked' + (total > 0 ? ' err' : '')}>{layoutBet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={spinning ? 'live' : last ? (last.multiplier >= 1 ? 'won' : 'lost') : 'idle'} history={history} />

      <Board className="sr-board">
        <InstantResult multiplier={last && !spinning ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />
        <div className={'sr-viewport' + (last && !spinning ? ' landed ' + last.colour : '') + (spinning ? ' spinning' : '')}>
          <div
            className="sr-strip"
            style={{ transform: `translateX(calc(var(--slot) * ${-pos.p}))`, transitionDuration: `${pos.ms}ms` } as CSSProperties}
          >
            {cells.map((s, j) => (
              <div key={j} className={`sr-slot ${s.colour}` + (s.edge ? ' edge' : '') + (j === hitIdx ? ' hit' : '')}>
                <span>{s.number}</span>
              </div>
            ))}
          </div>
          <div className="sr-pointer" aria-hidden="true" />
        </div>

        <div className="sr-odds">
          <div className="sr-odds-bar" aria-label="Share of the strip per bet">
            {(
              [
                ['red', h - 1, 'red'],
                ['red edge', 1, 'red'],
                ['green', 1, 'green'],
                ['black edge', 1, 'black'],
                ['black', h - 1, 'black'],
              ] as const
            ).map(([cls, k, colour]) => {
              const isEdge = cls.endsWith('edge');
              const covered = shown[colour] > 0 || (isEdge && shown.edge > 0);
              const hit = last && !spinning && last.colour === colour && order[last.slot].edge === isEdge;
              return <i key={cls} className={`${cls}` + (covered ? ' on' : '') + (hit ? ' hit' : '')} style={{ flexGrow: k }} />;
            })}
          </div>
          <p className="sr-odds-cap">
            The bar is the strip: each colour's share is its chance. {total > 0 ? <>Your bets cover <b>{fmtChance(stats.pHit)}</b> of it.</> : 'Bright parts are covered by your bets.'}
          </p>
        </div>
      </Board>

      <div className="sr-bets">
        {BET_KEYS.map((k) => {
          const amt = shown[k];
          const won = !!last && !spinning && last.winners.includes(k);
          const lost = !!last && !spinning && amt > 0 && !won;
          return (
            <div key={k} className={`sr-bet ${k}` + (amt > 0 ? ' placed' : '') + (won ? ' won' : '') + (lost ? ' lost' : '')}>
              <button type="button" className="sr-bet-main" disabled={busy || !(chip.value > 0)} onClick={() => addChip(k)} aria-label={`Add ${money(chip.value)} on ${BET_NAMES[k]}`}>
                <span className="sr-bet-head">
                  <i className="sr-sw" />
                  <span>{BET_NAMES[k]}</span>
                  <kbd>{KEY_LABEL[k]}</kbd>
                </span>
                <b className="sr-bet-mult">{fmtPay(payoutOf(k, n))}</b>
                <small>
                  {slotsCovered(k, n)} of {n} · {fmtChance(chanceOf(k, n))}
                </small>
                <span className="sr-bet-stake">
                  {won ? <em>+{money(amt * payoutOf(k, n))}</em> : amt > 0 ? <span className="sr-chip">{money(amt)}</span> : <span className="sr-add">+ {money(chip.value)}</span>}
                </span>
              </button>
              {layout[k] > 0 && !busy && (
                <button type="button" className="sr-bet-minus" onClick={() => removeChip(k)} aria-label={`Remove a chip from ${BET_NAMES[k]}`} title="Remove a chip (Shift + key)">
                  <i aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="sr-recent">
        <span className="sr-recent-label">Previous</span>
        <div className="sr-dots" aria-label="Recent results">
          {recent.length === 0 && <span className="sr-none">No spins yet</span>}
          {recent.slice(0, 24).map((r) => (
            <i key={r.id} className={`sr-dot ${r.colour}`} title={`${r.colour} ${r.number}`} />
          ))}
        </div>
        <div className="sr-counts" title={`Last ${recent.length} spins`}>
          <span>
            <i className="sr-dot red" />
            {counts.red}
          </span>
          <span>
            <i className="sr-dot green" />
            {counts.green}
          </span>
          <span>
            <i className="sr-dot black" />
            {counts.black}
          </span>
        </div>
      </div>

      {infoOpen && (
        <InfoModal title="Strip Roulette" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A strip of coloured slots slides under the pointer and stops on one. Back the colour it lands on. On the classic strip there are 7 red, 7 black and a
              single green 0.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a chip value (or a preset), then click Red, Green, Black or Edge to put a chip there. Click again to add more; − removes one.</li>
              <li>Back any mix in the same spin. Edge wins when the strip stops on either slot touching the green (marked with a gold diamond).</li>
              <li>Choose the strip length: longer strips keep one green, so green gets rarer and pays more.</li>
              <li>Press Bet (or Space). Auto repeats your layout with your stop rules; on win / on loss scale every bet together.</li>
            </ol>
            <p>
              Keys: <b>Space</b> bet · <b>R G B E</b> add a chip (Shift removes) · <b>Z</b> undo · <b>D</b> double · <b>X</b> clear.
            </p>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Every slot is equally likely, so a bet's chance is simply the number of slots it covers divided by the strip length. The bar under the strip draws those
              shares to scale and lights the part your chips cover.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              A bet covering k of the N slots pays {(RTP * 100).toFixed(0)}% × N ÷ k, so its expected return is (k ÷ N) × 0.99 × N ÷ k = 0.99 exactly. Bets in the same
              spin are added together, and by linearity of expectation any mix returns 99% as well. Mixing only changes how bumpy the results are.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <table className="sr-paytable">
              <thead>
                <tr>
                  <th>Strip</th>
                  <th>Red / Black</th>
                  <th>Edge</th>
                  <th>Green</th>
                </tr>
              </thead>
              <tbody>
                {STRIPS.map((s) => (
                  <tr key={s}>
                    <td>
                      {s} · {STRIP_NAMES[s]}
                    </td>
                    <td>{fmtPay(payoutOf('red', s))}</td>
                    <td>{fmtPay(payoutOf('edge', s))}</td>
                    <td>{fmtPay(payoutOf('green', s))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>Every bet on every strip returns exactly 99%. Payouts include your stake. The slot is drawn the moment you bet; the slide only shows it.</p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
