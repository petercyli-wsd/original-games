// ReelWindow: the themed reel window. Draws any grid up to 8×8, with a different row count per
// reel (megaways), and animates it through an imperative handle that `SlotGame` drives:
//
//   spin(opts)    reels scroll (no blur) and stop left to right on the real result; the passing
//                 symbols come from the real strips when given, else a fixed cycle (never random)
//   tumble(...)   winning cells pop out, survivors fall, new symbols drop in, one step at a time
//   set(board)    shows a board with no animation (idle and reset)
//   slam()        finishes every running animation now (Space while spinning)
//
// Props draw the state around it: `win` (cells highlighted, all others dimmed), `line` (a payline path),
// `overlays` (value badges on cells, e.g. orb multipliers), `feature` (the feature palette).
// Board convention is the engine's: board[col][row], row 0 on top.

import { forwardRef, memo, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { CellOverlayInfo, SlotSymbolArt, SlotSymbols, SlotTheme } from './types';
import type { ReactNode } from 'react';
import { fillerSymbol, mixHex, reelTimings } from './util';

interface Cell {
  k: number;
  s: number;
}

interface PlanItem extends Cell {
  h: number;
}

interface Plan {
  items: PlanItem[];
  total: number;
}

export interface SpinOpts {
  /** The final board, board[col][row]. */
  board: number[][];
  /** Per reel: the strip, and the stop (strip index of row 0), so passing symbols are the real neighbours. Optional. */
  strips?: { strip: number[]; stop: number }[] | null;
  turbo: boolean;
  /** Per reel: slow down for real anticipation (see `anticipationPlan`). Ignored in Turbo. */
  anticipate?: boolean[];
  /** Only these reels spin (a respin: the others stay as they are). Default: all. */
  only?: ReadonlySet<number>;
  /** Multiplies every duration (< 1 is faster); long cascades and respins speed up with it. Default 1. */
  speed?: number;
}

export interface ReelWindowHandle {
  set(board: number[][]): void;
  spin(opts: SpinOpts): Promise<void>;
  /** `removed`: the cells (in the current board) that pop. `next`: the board after survivors fall and new symbols drop in. */
  tumble(next: number[][], removed: [number, number][], turbo: boolean, speed?: number): Promise<void>;
  slam(): void;
  /** Flips these cells (all at once) from what they show into `next`'s symbols: the mystery reveal. */
  reveal(next: number[][], cells: [number, number][], turbo: boolean): Promise<void>;
}

export interface ReelWindowProps {
  cols: number;
  /** The tallest reel the game can show; sets the window's height. */
  maxRows: number;
  symbols: SlotSymbols;
  theme: SlotTheme;
  /** Symbol ids used for the passing symbols when no strip is given. */
  fillerIds: number[];
  initial: number[][];
  /** Highlighted cells as "col,row" keys. Others are dimmed. */
  win?: ReadonlySet<string> | null;
  /** A payline path through cells, in reel order. */
  line?: [number, number][] | null;
  /** "col,row" → badge text. */
  overlays?: ReadonlyMap<string, string> | null;
  /** The feature palette (flat swap). */
  feature?: boolean;
  /** A modifier chain (respins): the chain palette, a light tint of the base unless the theme sets one. */
  chain?: boolean;
  /** Draws over a symbol's tile (see `SlotGameProps.renderOverlay`). */
  renderOverlay?: (cell: CellOverlayInfo) => ReactNode;
  /** The spin's decor, passed to `renderOverlay` once the final board shows. */
  overlayDecor?: Record<string, unknown>;
}

const backdropFnPresent = (t: SlotTheme) => !!(t.backdrop || t.featureBackdrop);

const Glyph = memo(function Glyph({ art, size }: { art: SlotSymbolArt; size: number }) {
  return art.render(size);
});

const CellOverlay = ({ node }: { node: ReactNode }) => (node == null || node === false ? null : <div className="sl-ov">{node}</div>);

const EASE_SPIN = 'cubic-bezier(0.4, 0, 0.2, 1)';
const EASE_FALL = 'cubic-bezier(0.5, 0, 0.9, 0.55)';

export const ReelWindow = forwardRef<ReelWindowHandle, ReelWindowProps>(function ReelWindow(
  { cols, maxRows, symbols, theme, fillerIds, initial, win, line, overlays, feature, chain, renderOverlay, overlayDecor },
  ref,
) {
  const keySeq = useRef(0);
  const mk = (s: number): Cell => ({ k: ++keySeq.current, s });
  const toCells = (b: number[][]) => b.map((col) => col.map(mk));

  const [board, setBoard] = useState<Cell[][]>(() => toCells(initial));
  const boardRef = useRef(board);
  const [plans, setPlans] = useState<(Plan | null)[]>(() => new Array(cols).fill(null));
  const [ant, setAnt] = useState<boolean[]>(() => new Array(cols).fill(false));
  const [width, setWidth] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const stripEls = useRef<(HTMLDivElement | null)[]>([]);
  const cellEls = useRef(new Map<number, HTMLElement>());
  const anims = useRef<Animation[]>([]);
  const alive = useRef(true);
  const afterCommit = useRef<(() => void)[]>([]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      anims.current.forEach((a) => a.cancel());
    };
  }, []);

  // Measure the reels' width; the height follows from the aspect ratio.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Work queued by the handle that must run after the DOM has the new layout (before paint).
  useLayoutEffect(() => {
    const q = afterCommit.current;
    if (q.length) {
      afterCommit.current = [];
      q.forEach((f) => f());
    }
  });
  const nextCommit = () => new Promise<void>((res) => afterCommit.current.push(res));

  const cellW = width / cols;
  const height = (width * maxRows) / cols;
  const geo = useRef({ cellW, height });
  geo.current = { cellW, height };

  const commitBoard = (b: Cell[][]) => {
    boardRef.current = b;
    setBoard(b);
  };
  const track = (a: Animation) => {
    anims.current.push(a);
    void a.finished.then(
      () => (anims.current = anims.current.filter((x) => x !== a)),
      () => (anims.current = anims.current.filter((x) => x !== a)),
    );
    return a;
  };

  useImperativeHandle(ref, () => ({
    set(b) {
      commitBoard(toCells(b));
    },

    slam() {
      anims.current.slice().forEach((a) => a.finish());
    },

    async spin({ board: next, strips, turbo, anticipate, only, speed = 1 }) {
      const { height: H } = geo.current;
      const old = boardRef.current;
      const t = reelTimings(cols, turbo);
      const newCells = toCells(next);
      const spinning = (c: number) => !only || only.has(c);

      // Stop times: base + k × stagger (k counts the spinning reels), plus the suspense of every anticipating reel up to this one.
      const dur: number[] = [];
      const anticip: boolean[] = [];
      let extra = 0;
      let k = 0;
      for (let c = 0; c < cols; c++) {
        if (!spinning(c)) continue;
        anticip[c] = !turbo && !!anticipate?.[c];
        if (anticip[c]) extra += t.suspense;
        dur[c] = Math.max(120, (t.base + k * t.stagger + extra) * speed);
        k++;
      }

      const nextPlans: (Plan | null)[] = [];
      for (let c = 0; c < cols; c++) {
        if (!spinning(c)) {
          nextPlans.push(null);
          continue;
        }
        const rowsNew = next[c].length;
        const hNew = H / rowsNew;
        const nFill = Math.max(6, Math.round(dur[c] / 45) + 3);
        const items: PlanItem[] = newCells[c].map((x) => ({ ...x, h: hNew }));
        const sp = strips?.[c];
        for (let i = 0; i < nFill; i++) {
          // Row `rowsNew + i` below the final window: strip positions after the window's last row.
          const s = sp && sp.strip.length ? sp.strip[(sp.stop + rowsNew + i) % sp.strip.length] : fillerSymbol(fillerIds, c, i);
          items.push({ ...mk(s), h: hNew });
        }
        const hOld = H / Math.max(1, old[c]?.length ?? rowsNew);
        for (const x of old[c] ?? []) items.push({ ...x, h: hOld });
        nextPlans.push({ items, total: items.reduce((a, x) => a + x.h, 0) });
      }

      setPlans(nextPlans);
      await nextCommit();
      if (!alive.current) return;

      const stopped = new Array<boolean>(cols).fill(false);
      const nextSpinning = (c: number) => {
        for (let r = c + 1; r < cols; r++) if (spinning(r)) return r;
        return -1;
      };
      const finish = (c: number) => {
        if (!alive.current || stopped[c]) return;
        stopped[c] = true;
        boardRef.current = boardRef.current.map((col, i) => (i === c ? newCells[c] : col));
        setBoard(boardRef.current);
        setPlans((p) => p.map((x, i) => (i === c ? null : x)));
        setAnt((a) => a.map((x, i) => (i === c ? false : x)));
        const nx = nextSpinning(c);
        if (nx >= 0 && anticip[nx]) setAnt((a) => a.map((x, i) => (i === nx ? true : x)));
      };
      const first = nextSpinning(-1);
      if (first >= 0 && anticip[first]) setAnt((a) => a.map((x, i) => (i === first ? true : x)));

      const runs = nextPlans.map((p, c) => {
        if (!p) return Promise.resolve();
        const el = stripEls.current[c];
        if (!el) {
          finish(c);
          return Promise.resolve();
        }
        const a = track(el.animate([{ transform: `translateY(${-(p.total - H)}px)` }, { transform: 'translateY(0)' }], { duration: dur[c], easing: EASE_SPIN }));
        return a.finished.then(
          () => finish(c),
          () => undefined,
        );
      });
      await Promise.all(runs);
      if (!alive.current) return;
      for (let c = 0; c < cols; c++) if (spinning(c)) finish(c);
    },

    async reveal(next, cells, turbo) {
      const old = boardRef.current;
      const ms = turbo ? 80 : 240;
      const flip = (c: number, r: number, from: number, to: number) => {
        const cell = boardRef.current[c]?.[r];
        const sym = cell && cellEls.current.get(cell.k)?.querySelector('.sl-sym');
        return sym ? track(sym.animate([{ transform: `scaleX(${from})` }, { transform: `scaleX(${to})` }], { duration: ms, easing: 'ease-in-out', fill: 'forwards' })).finished.catch(() => undefined) : Promise.resolve();
      };
      await Promise.all(cells.map(([c, r]) => flip(c, r, 1, 0)));
      if (!alive.current) return;
      const fresh = new Set<number>();
      const rebuilt = old.map((col, c) =>
        col.map((cell, r) => {
          if (!cells.some(([cc, rr]) => cc === c && rr === r)) return cell;
          const x = mk(next[c][r]);
          fresh.add(x.k);
          return x;
        }),
      );
      commitBoard(rebuilt);
      await nextCommit();
      if (!alive.current) return;
      const ins: Promise<unknown>[] = [];
      rebuilt.forEach((col) =>
        col.forEach((cell) => {
          const sym = fresh.has(cell.k) ? cellEls.current.get(cell.k)?.querySelector('.sl-sym') : null;
          if (sym) ins.push(track(sym.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: ms, easing: 'ease-in-out' })).finished.catch(() => undefined));
        }),
      );
      await Promise.all(ins);
    },

    async tumble(next, removed, turbo, speed = 1) {
      const { height: H } = geo.current;
      const old = boardRef.current;
      const gone = new Set(removed.map(([c, r]) => `${c},${r}`));
      const popMs = (turbo ? 80 : 320) * speed;
      const dropMs = (turbo ? 120 : 420) * speed;

      // 1. Pop: the winning symbols swell and vanish.
      const pops: Promise<unknown>[] = [];
      for (const [c, r] of removed) {
        const cell = old[c]?.[r];
        const sym = cell && cellEls.current.get(cell.k)?.querySelector('.sl-sym');
        if (!sym) continue;
        const a = track(sym.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14)', offset: 0.3 }, { transform: 'scale(0)' }], { duration: popMs, easing: 'ease-in', fill: 'forwards' }));
        pops.push(a.finished.catch(() => undefined));
      }
      await Promise.all(pops);
      if (!alive.current) return;

      // 2. Rebuild: survivors keep their keys and fall; everything above is new.
      const moves = new Map<number, number>(); // key → pixels to start above its final spot
      const rebuilt: Cell[][] = next.map((col, c) => {
        const oldCol = old[c] ?? [];
        const keep = oldCol.filter((_, r) => !gone.has(`${c},${r}`));
        const nNew = col.length - keep.length;
        const matches = oldCol.length === col.length && nNew >= 0 && keep.every((x, i) => x.s === col[nNew + i]);
        if (!matches) {
          // Not a plain fall: if the column is unchanged keep it, otherwise the whole column drops in.
          const same = oldCol.length === col.length && oldCol.every((x, i) => x.s === col[i]) && !removed.some(([rc]) => rc === c);
          if (same) return oldCol;
          const fresh = col.map((s) => mk(s));
          const h = H / Math.max(1, col.length);
          fresh.forEach((x) => moves.set(x.k, col.length * h));
          return fresh;
        }
        const hNew = H / Math.max(1, col.length);
        const out: Cell[] = [];
        for (let i = 0; i < nNew; i++) {
          const x = mk(col[i]);
          moves.set(x.k, nNew * hNew); // new symbols start stacked above the window
          out.push(x);
        }
        keep.forEach((x) => {
          const oldRow = oldCol.indexOf(x);
          const newRow = out.length;
          const hOld = H / Math.max(1, oldCol.length);
          const dy = oldRow * hOld - newRow * hNew;
          if (Math.abs(dy) > 0.5) moves.set(x.k, -dy);
          out.push(x);
        });
        return out;
      });
      commitBoard(rebuilt);
      await nextCommit();
      if (!alive.current) return;

      // 3. Fall: each moved cell animates from its old offset to its place.
      const falls: Promise<unknown>[] = [];
      rebuilt.forEach((col, c) => {
        const h = H / Math.max(1, col.length);
        col.forEach((cell, r) => {
          const dy = moves.get(cell.k);
          const el = cellEls.current.get(cell.k);
          if (dy === undefined || !el) return;
          const to = r * h;
          const a = track(el.animate([{ transform: `translateY(${to - dy}px)` }, { transform: `translateY(${to}px)` }], { duration: dropMs + c * (turbo ? 6 : 28) * speed, easing: EASE_FALL }));
          falls.push(a.finished.catch(() => undefined));
        });
      });
      await Promise.all(falls);
    },
  }));

  const t = theme.palette;
  const w = theme.window;
  const style = {
    '--sl-bg': chain ? (t.chainBg ?? mixHex(t.bg, '#ffffff', 0.1)) : feature && t.featureBg ? t.featureBg : t.bg,
    '--sl-frame': chain ? (t.chainFrame ?? mixHex(t.frame, '#ffffff', 0.18)) : feature && t.featureFrame ? t.featureFrame : t.frame,
    '--sl-tile': chain ? (t.chainTile ?? mixHex(t.tile ?? t.frame, '#ffffff', 0.12)) : feature && t.featureTile ? t.featureTile : (t.tile ?? t.frame),
    '--sl-hi': t.colors[0],
    '--sl-ink': t.ink ?? 'var(--text)',
    '--sl-fw': `${w.frameWidth}px`,
    '--sl-r': `${w.radius}px`,
    '--sl-cr': `${w.cellRadius}px`,
    '--sl-ratio': `${cols} / ${maxRows}`,
    '--sl-w': String(cols / maxRows),
  } as CSSProperties;

  // A margin around the grid, inside the window, where the backdrop shows even with tiles and small gaps.
  const margin = backdropFnPresent(theme) ? Math.max(0, Math.min(48, w.backdropMargin ?? 0)) : 0;
  const backdropFn = feature && theme.featureBackdrop ? theme.featureBackdrop : theme.backdrop;
  const dimmed = !!win && win.size > 0;
  const renderCell = (cell: Cell, c: number, r: number, h: number) => {
    const art = symbols[cell.s];
    const size = Math.max(8, Math.min(cellW, h) * 0.88);
    const id = `${c},${r}`;
    const isWin = !!win?.has(id);
    const badge = overlays?.get(id);
    return (
      <div
        key={cell.k}
        ref={(el) => {
          if (el) cellEls.current.set(cell.k, el);
          else cellEls.current.delete(cell.k);
        }}
        className={'sl-cell' + (isWin ? ' win' : dimmed ? ' dim' : '')}
        style={{ height: h, transform: `translateY(${r * h}px)` }}
      >
        <div className="sl-tile">
          <div className="sl-sym" role="img" aria-label={art?.name ?? `Symbol ${cell.s}`}>
            {art && <Glyph art={art} size={size} />}
          </div>
          {renderOverlay && <CellOverlay node={renderOverlay({ col: c, row: r, symbol: cell.s, decor: overlayDecor })} />}
          {badge && (
            <span className="sl-badge" style={{ fontSize: Math.max(10, Math.min(18, size * 0.3)) }}>
              {badge}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`sl-frame sep-${w.separators} cell-${w.cell}` + (feature ? ' feature' : '') + (chain ? ' chain' : '')} style={style}>
      <div className="sl-reels" role="group" aria-label="Reels" style={{ padding: margin }}>
        {width > 0 && backdropFn && (
          <svg className="sl-backdrop" viewBox={`0 0 ${width + 2 * margin} ${height + 2 * margin}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            {backdropFn(width + 2 * margin, height + 2 * margin)}
          </svg>
        )}
        <div ref={rootRef} className="sl-grid">
        {width > 0 &&
          Array.from({ length: cols }, (_, c) => {
            const plan = plans[c];
            const col = board[c] ?? [];
            const h = height / Math.max(1, col.length);
            return (
              <div key={c} className={'sl-reel' + (ant[c] ? ' ant' : '')} style={{ left: c * cellW, width: cellW }} data-reel={c}>
                {plan ? (
                  <div
                    className="sl-strip"
                    aria-hidden="true"
                    ref={(el) => {
                      stripEls.current[c] = el;
                    }}
                    style={{ height: plan.total, transform: `translateY(${-(plan.total - height)}px)` }}
                  >
                    {plan.items.map((it, i) => {
                      const art = symbols[it.s];
                      const size = Math.max(8, Math.min(cellW, it.h) * 0.88);
                      return (
                        <div key={it.k + ':' + i} className="sl-item" style={{ height: it.h }}>
                          <div className="sl-tile">
                            <div className="sl-sym">{art && <Glyph art={art} size={size} />}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  col.map((cell, r) => renderCell(cell, c, r, h))
                )}
              </div>
            );
          })}
        {width > 0 && line && line.length > 1 && (
          <svg className="sl-line" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            {(() => {
              const pts = line.map(([c, r]) => {
                const rows = Math.max(1, board[c]?.length ?? maxRows);
                return [(c + 0.5) * cellW, ((r + 0.5) * height) / rows] as const;
              });
              return (
                <>
                  <polyline className="case" points={pts.map((p) => p.join(',')).join(' ')} />
                  <polyline points={pts.map((p) => p.join(',')).join(' ')} />
                  {pts.map((p, i) => (
                    <circle key={i} cx={p[0]} cy={p[1]} r={5} />
                  ))}
                </>
              );
            })()}
          </svg>
        )}
        </div>
      </div>
    </div>
  );
});
