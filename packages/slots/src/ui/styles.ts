// The slot UI's stylesheet. It adds to the kit's (docs/SLOT-STYLE.md): the chrome keeps the site's
// tokens; only the reel window and the symbols are themed, through --sl-* variables set from the
// game's SlotTheme. Flat: no gradients, glows, shadows, blur or glass.
//
//   defineReactGame(Game, { styles: slotGameStyles + gameCss })

import { kitStyles } from '@originals/game-sdk/ui';

export const slotStyles = /* css */ `
/* ---------- Stage ---------- */
.sl-stage {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
}

/* ---------- The reel window (themed) ---------- */
.sl-frame {
  width: min(100%, calc(60vh * var(--sl-w, 1.6)));
  padding: var(--sl-fw, 8px);
  background: var(--sl-frame);
  border-radius: var(--sl-r, 8px);
}
.sl-reels {
  position: relative;
  width: 100%;
  overflow: hidden;
  background: var(--sl-bg);
  border-radius: max(0px, calc(var(--sl-r, 8px) - 3px));
}
.sl-grid { position: relative; width: 100%; aspect-ratio: var(--sl-ratio, 5 / 3); }
.sl-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.sl-ov { position: absolute; inset: 0; pointer-events: none; }
.sl-reel { position: absolute; top: 0; bottom: 0; overflow: hidden; }
.sep-line .sl-reel + .sl-reel { border-left: 1px solid var(--sl-frame); }
.sl-strip { position: absolute; left: 0; top: 0; width: 100%; will-change: transform; }
.sl-item { position: relative; width: 100%; }
.sl-cell { position: absolute; left: 0; top: 0; width: 100%; will-change: transform; }

.sl-tile {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  border-radius: var(--sl-cr, 4px);
}
.sep-gap .sl-tile { inset: 2px; }
.cell-tile .sl-tile { background: var(--sl-tile); }
.sl-sym { display: grid; place-items: center; width: 100%; height: 100%; }
.sl-sym svg { display: block; }

/* Win: the winners get a frame in the theme's first colour and everything else steps back. */
.sl-cell.win .sl-tile { outline: 3px solid var(--sl-hi); outline-offset: -3px; }
.sl-cell.dim .sl-tile { opacity: 0.4; }
/* A held cell stays put with a lock frame; over a spinning reel it is drawn on top of the strip. */
.sl-cell.held .sl-tile { outline: 3px solid var(--sl-lock); outline-offset: -3px; }
.sl-cell.over { z-index: 2; }
.cell-plain .sl-cell.over .sl-tile { background: var(--sl-bg); }
/* Landing effects: a flat burst that grows and goes. */
.sl-fx { position: absolute; z-index: 4; pointer-events: none; display: grid; place-items: center; animation: sl-pop 520ms ease-out both; }
.sl-fx svg { display: block; width: 100%; height: 100%; }
.sl-burst { position: absolute; left: 50%; top: 50%; z-index: 5; pointer-events: none; margin: 0; transform: translate(-50%, -50%); animation: sl-burst 700ms ease-out both; }
@keyframes sl-pop { from { transform: scale(0.4); opacity: 1; } to { transform: scale(1.35); opacity: 0; } }
@keyframes sl-burst { from { transform: translate(-50%, -50%) scale(0.3); opacity: 1; } to { transform: translate(-50%, -50%) scale(1.15); opacity: 0; } }

/* Real anticipation: the reel that can still complete the trigger is outlined while it spins. */
.sl-reel.ant { outline: 2px solid var(--sl-hi); outline-offset: -2px; }

.sl-wild { position: absolute; left: 3px; bottom: 3px; padding: 0 4px; border-radius: 3px; background: var(--sl-bg); border: 1px solid var(--sl-hi); color: var(--sl-ink); font-weight: 700; letter-spacing: 0.04em; line-height: 1.3; pointer-events: none; }
.sl-fold { position: absolute; right: 2px; top: 2px; pointer-events: none; }
.sl-badge {
  position: absolute;
  right: 3px;
  bottom: 3px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--sl-bg);
  border: 1.5px solid var(--sl-hi);
  color: var(--sl-ink);
  font-weight: 600;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.sl-line { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
/* The line has a dark casing so it reads over symbols of its own colour. */
.sl-line polyline { fill: none; stroke: var(--sl-hi); stroke-width: 3.5; stroke-linejoin: round; stroke-linecap: round; }
.sl-line polyline.case { stroke: var(--sl-bg); stroke-width: 8; }
.sl-line circle { fill: var(--sl-hi); stroke: var(--sl-bg); stroke-width: 2.5; }

/* ---------- Multiplier reel ---------- */
.sl-mreel { display: flex; align-items: center; justify-content: center; gap: var(--sp-1); flex-wrap: nowrap; max-width: 100%; }
.sl-mreel-label { flex-shrink: 0; margin-right: var(--sp-2); font-size: var(--fs-1); font-weight: 600; color: var(--muted); }
.sl-mreel-v { min-width: 0; padding: 4px var(--sp-2); white-space: nowrap; text-align: center; border: 1px solid var(--line); border-radius: 4px; font-size: var(--fs-2); font-weight: 600; font-variant-numeric: tabular-nums; color: var(--muted); }
.sl-mreel-v.on.dim { color: var(--muted); border-color: var(--line-strong); background: transparent; }
.sl-mreel-v.on { color: var(--text); border-color: var(--text); background: var(--hover); }

.sl-dim { color: var(--muted); }
.sl-pt-note { margin: 0 0 var(--sp-1); font-size: var(--fs-2); }
.sl-top { flex-wrap: wrap; }
.sl-hist { position: relative; display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: var(--sp-1) var(--sp-2); margin-left: auto; min-width: 0; max-width: 100%; }
.sl-hist .og-history { overflow: visible; justify-content: flex-start; flex-wrap: nowrap; }
.sl-hist-toggle { padding: 2px var(--sp-1); background: transparent; border: 0; font-size: var(--fs-1); font-weight: 600; color: var(--muted); cursor: pointer; }
.sl-hist-toggle:hover { color: var(--text); }
.sl-hist .og-hist { border-color: transparent; }
.sl-hist .og-hist.now { border-color: currentColor; }
.sl-hist .og-hist:first-child { border-color: currentColor; }
.sl-hist-log { position: absolute; right: 0; top: calc(100% + 4px); z-index: 8; min-width: 280px; border-collapse: collapse; background: var(--raised); border: 1px solid var(--line-strong); border-radius: var(--radius); font-size: var(--fs-1); font-variant-numeric: tabular-nums; }
.sl-hist-log th, .sl-hist-log td { padding: 4px var(--sp-3); text-align: right; border-bottom: 1px solid var(--line); }
.sl-hist-log th { font-weight: 600; color: var(--muted); }
.sl-hist-log td:first-child, .sl-hist-log th:first-child { text-align: left; }
@container (max-width: 760px) { .sl-hist .og-hist:nth-child(n+7) { display: none; } .sl-hist { justify-content: flex-start; margin-left: 0; } }
.sl-hist-label { flex-shrink: 0; align-self: center; margin-right: var(--sp-1); font-size: var(--fs-1); font-weight: 600; color: var(--muted); }
.sl-ways { font-size: var(--fs-2); font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; }
.sl-ways b { color: var(--text); }

/* ---------- Under the window: the win chip ---------- */
.sl-winbar {
  min-height: 38px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
}
.sl-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 6px var(--sp-3);
  background: var(--raised);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  font-size: var(--fs-2);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  animation: og-fade var(--dur-ui) ease both;
}
.sl-chip.event { border-color: var(--text); }
.sl-mini { display: inline-grid; place-items: center; width: 26px; height: 26px; background: var(--sl-tile); border-radius: 4px; }
.sl-mini svg { display: block; }
.sl-breakdown { flex-basis: 100%; margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; justify-content: center; gap: 2px var(--sp-4); font-size: var(--fs-1); color: var(--muted); font-variant-numeric: tabular-nums; }
.sl-hint { font-size: var(--fs-1); color: var(--muted); }

/* ---------- Cards over the window ---------- */
.sl-card {
  position: absolute;
  left: 50%;
  top: calc(50% - 19px);
  z-index: 6;
  transform: translate(-50%, -50%);
  width: max-content;
  min-width: min(280px, 88%);
  max-width: 92%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-5);
  text-align: center;
  background: var(--raised);
  border: 1px solid var(--text);
  border-radius: var(--radius-lg);
  animation: og-fade var(--dur-ui) ease both;
}
.sl-card.t2 { border-width: 2px; }
.sl-card.at-top { top: calc(28% - 19px); }
.sl-card.at-below { position: relative; left: auto; top: auto; transform: none; width: 100%; max-width: 100%; padding: var(--sp-3) var(--sp-4); flex-direction: row; flex-wrap: wrap; justify-content: center; gap: var(--sp-1) var(--sp-4); }
.sl-card.at-below .og-btn { margin-top: 0; }
.sl-card.at-bottom { top: calc(72% - 19px); }
.sl-card-kicker { font-size: var(--fs-1); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.sl-card-title { font-size: var(--fs-5); font-weight: 700; line-height: 1.15; }
.sl-card-amount { font-size: var(--fs-6); font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
.sl-card-line { font-size: var(--fs-2); color: var(--muted); font-variant-numeric: tabular-nums; }
.sl-card .og-btn { margin-top: var(--sp-2); min-width: 160px; }

/* ---------- Panel ---------- */
.sl-auto { display: flex; flex-direction: column; gap: var(--sp-2); }
.sl-note { margin: 0; font-size: var(--fs-1); color: var(--muted); text-align: center; }
.sl-roll { font-variant-numeric: tabular-nums; }
.og-btn.sl-skip { margin-top: var(--sp-2); }

/* ---------- Paytable sheet ---------- */
.sl-pt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--sp-3); }
.sl-pt-sym, .sl-pt-special { display: flex; gap: var(--sp-3); align-items: flex-start; }
.sl-pt-special { margin-bottom: var(--sp-3); }
.sl-pt-special p { margin: 0 0 var(--sp-1); font-size: var(--fs-2); }
.sl-pt-art { flex: none; display: grid; place-items: center; width: 56px; height: 56px; background: var(--sl-tile); border-radius: var(--radius); }
.sl-pt-art svg { display: block; }
.sl-pt-sym b { font-size: var(--fs-2); font-weight: 600; }
.sl-pays { list-style: none; margin: var(--sp-1) 0 0; padding: 0; display: flex; flex-direction: column; gap: 1px; font-size: var(--fs-1); font-variant-numeric: tabular-nums; }
.sl-pays li { display: flex; gap: var(--sp-3); margin: 0; }
.sl-pays li span { min-width: 34px; color: var(--muted); }
.sl-pays li b { font-size: var(--fs-1); font-weight: 600; color: var(--text); }
.sl-pays.inline { flex-direction: row; flex-wrap: wrap; gap: var(--sp-1) var(--sp-4); }
.sl-pays.inline li { gap: var(--sp-2); }
.sl-pays.inline li span { min-width: 0; }
.sl-pays.inline li span::after { content: ' pay'; }
.sl-pl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: var(--sp-2); }
.sl-pl { width: 100%; height: auto; background: var(--bg); border: 1px solid var(--line); border-radius: 4px; }
.sl-pl .d { fill: var(--line-strong); }
.sl-pl polyline { fill: none; stroke: var(--text); stroke-width: 1.8; stroke-linejoin: round; stroke-linecap: round; }
.sl-facts { margin: 0; display: grid; gap: var(--sp-1); }
.sl-facts > div { display: flex; justify-content: space-between; gap: var(--sp-4); padding: var(--sp-1) 0; border-bottom: 1px solid var(--line); font-size: var(--fs-2); }
.sl-facts dt { color: var(--muted); }
.sl-facts dd { margin: 0; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }

/* Paytable, round 14: how to win, special-symbol cards, compact pay rows. */
.sl-pt-how { display: flex; align-items: center; gap: var(--sp-4); }
.sl-pt-how p { margin: 0 0 var(--sp-1); }
.sl-wd { flex: none; width: 112px; height: auto; }
.sl-wd rect { fill: var(--line); }
.sl-wd rect.on { fill: var(--text); }
.sl-wd polyline { fill: none; stroke: var(--bg); stroke-width: 2.2; stroke-linejoin: round; stroke-linecap: round; }
.sl-pt-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-3); }
.sl-pt-card { display: flex; gap: var(--sp-3); align-items: flex-start; padding: var(--sp-3); background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius); }
.sl-pt-card p { margin: 0 0 2px; font-size: var(--fs-2); }
.sl-pt-card b { font-size: var(--fs-2); }
.sl-pt-chips { display: flex; flex-wrap: wrap; gap: 2px var(--sp-3); margin-top: var(--sp-1); font-size: var(--fs-1); color: var(--muted); font-variant-numeric: tabular-nums; }
.sl-pt-chips b { color: var(--text); font-size: var(--fs-1); }
.sl-pr { display: grid; grid-template-columns: 52px minmax(0, 1fr) repeat(var(--tiers, 3), minmax(46px, auto)); align-items: center; column-gap: var(--sp-2); padding: var(--sp-2) 0; border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }
.sl-pr.head { padding: 0 0 var(--sp-1); font-size: var(--fs-1); font-weight: 600; color: var(--muted); }
.sl-pr.head .sl-pr-v { font-weight: 600; color: var(--muted); }
.sl-pr-unit { font-weight: 500; }
.sl-pr-name { font-size: var(--fs-2); font-weight: 600; min-width: 0; }
.sl-pr.big .sl-pr-name { font-size: var(--fs-3); }
.sl-pr-v { text-align: right; font-size: var(--fs-2); color: var(--muted); }
.sl-pr.big .sl-pr-v { font-size: var(--fs-3); }
.sl-pr-v.top { font-weight: 700; color: var(--text); }
.sl-pr:not(.big):not(.head) { padding: 6px 0; }
.sl-pt-art.small { width: 36px; height: 36px; }
.sl-pr .sl-pt-art { width: 48px; height: 48px; }
.sl-pr .sl-pt-art.small { width: 34px; height: 34px; }
.sl-pr > .sl-pt-note { grid-column: 2 / -1; margin: 2px 0 0; font-size: var(--fs-1); color: var(--muted); }
.sl-pr-group { margin: var(--sp-4) 0 var(--sp-1); font-size: var(--fs-1); font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.sl-pr-all { grid-column: 1 / -1; margin-top: var(--sp-1); font-size: var(--fs-1); }
.sl-pr-all summary { cursor: pointer; color: var(--muted); width: max-content; }
.sl-pr-all summary:hover { color: var(--text); }
.sl-pr-list { list-style: none; margin: var(--sp-2) 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 2px var(--sp-3); }
.sl-pr-list li { display: flex; justify-content: space-between; gap: var(--sp-2); margin: 0; }
.sl-pr-list span { color: var(--muted); }
.sl-pr-list b { font-weight: 600; font-size: var(--fs-1); }
.sl-cap { margin-left: 3px; font-size: 9px; font-style: normal; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); vertical-align: super; }
.sl-pt-foot { margin: var(--sp-2) 0 0; font-size: var(--fs-1); color: var(--muted); }
@container (max-width: 760px) { .sl-pt-cards { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 560px) {
  .sl-pt-cards { grid-template-columns: minmax(0, 1fr); }
  .sl-wd { width: 84px; }
  .sl-pr { grid-template-columns: 40px minmax(0, 1fr) repeat(var(--tiers, 3), minmax(40px, auto)); column-gap: var(--sp-1); }
  .sl-pr .sl-pt-art { width: 40px; height: 40px; }
  .sl-pr .sl-pt-art.small { width: 32px; height: 32px; }
  .sl-pr-v, .sl-pr.big .sl-pr-v { font-size: var(--fs-1); }
  .sl-pr.big .sl-pr-name { font-size: var(--fs-2); }
}

@container (max-width: 760px) {
  .sl-mreel { gap: 5px; }
  .sl-mreel-v { flex: 1 1 0; padding: 4px 3px; font-size: var(--fs-1); }
  .sl-mreel-label { margin-right: var(--sp-1); }
  .sl-card { padding: var(--sp-4); }
  .sl-card-amount { font-size: var(--fs-5); }
  .sl-card-title { font-size: var(--fs-4); }
}
`;

/** The kit's styles plus the slot UI's: pass it to `defineReactGame(Game, { styles })`. */
export const slotGameStyles = kitStyles + slotStyles;
