// The kit's stylesheet. Pass it to defineReactGame together with the game's
// own CSS: defineReactGame(Game, { styles: kitStyles + styles }).
// It lives inside the game's shadow root, so it uses :host, not :root.
//
// The look is set by docs/STYLE.md: one neutral palette, one accent per game,
// fixed win / lose colours, a type scale and a spacing scale, all flat (no
// gradients, glows, drop shadows or blur). Games that don't use the kit's
// layout still take the tokens: defineReactGame(App, { styles: tokenStyles + styles }).

/** The design tokens only (docs/STYLE.md). Every colour, size and gap a game uses comes from here. */
export const tokenStyles = /* css */ `
:host {
  /* Neutral palette, darkest to lightest. */
  --bg: #0b0b0e;          /* wells: inputs, chip tracks, empty cells */
  --card: #121216;        /* the stage (board area) */
  --raised: #18181d;      /* the panel and any surface on the stage */
  --hover: #24242b;       /* hover, selected chip, neutral fills on the board */
  --line: #2b2b33;        /* every border and divider, 1px */
  --line-strong: #3d3d47; /* board outlines, hovered borders */
  --faint: #5f5f6a;       /* inactive marks on the board */
  --muted: #9a9aa5;       /* labels, secondary text */
  --text: #ececf0;        /* text, primary buttons, the player's neutral marks */

  /* Fixed outcome colours: the same in every game. Never use them for anything else. */
  --win: #3ecf74;
  --lose: #ef5b5b;

  /* One accent per game, set by GameLayout (or the game's root): the player's piece or choice on the board, focus rings. */
  --accent: #7b93ff;

  /* Kept so older game CSS still resolves; they map onto the tokens above. */
  --green: var(--win);
  --red: var(--lose);
  --gold: var(--text);

  /* Type scale. Weights: 500 body, 600 labels and numbers, 700 only for the one big number. */
  --fs-1: 12px;  /* hints, history, small labels */
  --fs-2: 14px;  /* body, buttons, readout labels */
  --fs-3: 16px;  /* inputs, board labels */
  --fs-4: 20px;  /* readout values */
  --fs-5: 28px;  /* round result */
  --fs-6: 44px;  /* a game's one hero number (crash multiplier, rolled value) */

  /* Spacing scale. */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 24px;
  --sp-6: 32px;

  --radius: 6px;     /* controls */
  --radius-lg: 8px;  /* surfaces */

  /* Motion: an event (a roll, a draw, a cut) in Manual takes --dur-event so the eye can follow it; turbo and Auto shorten it. */
  --dur-ui: 120ms;
  --dur-event: 600ms;
  --ease: cubic-bezier(0.2, 0.7, 0.2, 1);

  color: var(--text);
  font-family: var(--og-font, 'Outfit', system-ui, sans-serif);
  font-weight: 500;
}
`;

export const kitStyles =
  tokenStyles +
  /* css */ `
:host {
  display: block;
  height: 100%;
}
* { box-sizing: border-box; }

.og-shell { height: 100%; container-type: inline-size; }

.og-game {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  height: 100%;
  min-height: 600px;
  background: var(--card);
  border-radius: var(--radius-lg);
  overflow: hidden;
  color-scheme: dark;
}

.og-game button, .og-game input, .og-game select { font: inherit; color: inherit; }
.og-game button {
  cursor: pointer;
  border: 0;
  border-radius: var(--radius);
  transition: background var(--dur-ui) ease, color var(--dur-ui) ease, border-color var(--dur-ui) ease;
}
.og-game button:disabled { opacity: 0.4; cursor: not-allowed; }
.og-game button:focus-visible, .og-game input:focus-visible, .og-game summary:focus-visible, .og-game [tabindex]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* ---------- Control panel ---------- */
.og-panel > * { flex-shrink: 0; }
.og-panel {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-5) var(--sp-4);
  background: var(--raised);
  border-right: 1px solid var(--line);
  min-width: 0;
  overflow-y: auto;
}
.og-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
  font-size: var(--fs-1);
  font-weight: 600;
  color: var(--muted);
}
.og-panel > .og-label:first-child { margin-top: 0; }
.og-hint { font-size: var(--fs-1); font-weight: 500; font-variant-numeric: tabular-nums; text-align: right; }
.og-hint b { color: var(--text); font-weight: 600; }

.og-bet-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 48px 48px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg);
}
.og-bet-row input {
  min-width: 0;
  padding: 10px var(--sp-3);
  border: 0;
  outline: none;
  background: transparent;
  font-size: var(--fs-3);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.og-bet-row button { border-radius: 0; border-left: 1px solid var(--line); background: transparent; font-weight: 600; color: var(--muted); }
.og-bet-row button:not(:disabled):hover { background: var(--hover); color: var(--text); }

.og-chips { display: flex; gap: 2px; padding: 2px; background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius); }
.og-chips.wrap { flex-wrap: wrap; }
.og-chips.wrap .og-chip { flex: 1 0 calc(25% - 2px); }
.og-chip {
  flex: 1;
  min-width: 0;
  padding: 7px var(--sp-1);
  font-size: var(--fs-2);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  background: transparent;
  border-radius: 4px !important;
  white-space: nowrap;
}
.og-chip:not(:disabled):hover { color: var(--text); }
.og-chip.on { color: var(--text); background: var(--hover); }

.og-range { width: 100%; height: 20px; margin: 0; background: transparent; appearance: none; -webkit-appearance: none; }
.og-range::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: var(--hover); }
.og-range::-moz-range-track { height: 4px; border-radius: 2px; background: var(--hover); }
.og-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px; height: 16px; margin-top: -6px;
  border-radius: 50%; background: var(--text); border: 0;
}
.og-range::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: var(--text); border: 0; }
.og-range:disabled { opacity: 0.4; }

/* Volatility is a word, not a coloured badge. */
.og-vol {
  font-size: var(--fs-1);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}

/* One primary style (Bet, Cash out, Bet again) and one secondary style. No glows. */
.og-btn { padding: 13px var(--sp-3); font-size: var(--fs-3); font-weight: 600; }
.og-btn.bet, .og-btn.cash {
  margin-top: var(--sp-2);
  display: flex;
  justify-content: center;
  gap: var(--sp-2);
  color: var(--bg);
  background: var(--text);
  font-variant-numeric: tabular-nums;
}
.og-btn.bet:not(:disabled):hover, .og-btn.cash:not(:disabled):hover { background: #ffffff; }
.og-btn.secondary { color: var(--text); background: transparent; border: 1px solid var(--line-strong) !important; }
.og-btn.secondary:not(:disabled):hover { background: var(--hover); }

.og-game .og-ghost, .og-modal .og-ghost { background: transparent; border: 1px solid var(--line) !important; padding: 7px 10px; color: var(--muted); font-size: var(--fs-2); }
.og-game .og-ghost:not(:disabled):hover, .og-modal .og-ghost:not(:disabled):hover { color: var(--text); border-color: var(--line-strong) !important; }

.og-panel-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--sp-2);
  margin-top: auto;
  padding-top: var(--sp-3);
}
.og-toggle { display: flex; align-items: center; gap: var(--sp-2); font-size: var(--fs-2); color: var(--muted); cursor: pointer; }
.og-toggle input { width: 16px; height: 16px; accent-color: var(--text); }
.og-info-btn { display: inline-flex; align-items: center; gap: var(--sp-2); }

.og-stats { display: grid; grid-template-columns: 1fr auto; gap: var(--sp-1) var(--sp-3); margin: var(--sp-1) 0 0; font-size: var(--fs-1); color: var(--muted); }
.og-stats dt { margin: 0; }
.og-stats dd { margin: 0; text-align: right; color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }

/* ---------- Stage ---------- */
.og-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  min-width: 0;
  padding: var(--sp-5) clamp(var(--sp-4), 3cqi, var(--sp-6));
  background: var(--card);
}
.og-stage-top { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); min-height: 26px; }
.og-status {
  flex-shrink: 0;
  font-size: var(--fs-2);
  font-weight: 600;
  color: var(--muted);
}
.og-status.live { color: var(--text); }
.og-status.won { color: var(--win); }
.og-status.lost { color: var(--lose); }

/* History: plain numbers in the outcome colours; the newest one is boxed until the next result. */
.og-history { display: flex; gap: var(--sp-1); overflow: hidden; justify-content: flex-end; min-width: 0; }
.og-hist {
  flex-shrink: 0;
  padding: 3px 7px;
  border: 1px solid transparent;
  border-radius: 4px;
  font-size: var(--fs-1);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.og-hist.w { color: var(--win); }
.og-hist.l { color: var(--lose); }
.og-hist:first-child { border-color: currentColor; }

/* Readouts: one flat row of label over value. At most one probability (docs/STYLE.md). */
.og-readouts { display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-6); }
.og-readout {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.og-readout > span { font-size: var(--fs-1); font-weight: 600; color: var(--muted); }
.og-readout > b { font-size: var(--fs-4); font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.og-readout > small { font-size: var(--fs-1); color: var(--muted); font-variant-numeric: tabular-nums; }
.og-readout.win > b { color: var(--win); }
.og-readout.lose > b { color: var(--lose); }

/* A meter whose filled length is the probability: only when the board itself can't show it. */
.og-chance { display: flex; flex-direction: column; gap: var(--sp-2); }
.og-chance-head { display: flex; justify-content: space-between; font-size: var(--fs-1); font-weight: 600; color: var(--muted); }
.og-chance-head b { color: var(--text); font-variant-numeric: tabular-nums; }
.og-chance-track { height: 6px; border-radius: 3px; background: var(--hover); overflow: hidden; }
.og-chance-track i { display: block; height: 100%; background: var(--win); transition: width 0.3s var(--ease); }
.og-chance small { font-size: var(--fs-1); color: var(--muted); }

.og-board {
  position: relative;
  flex: 1;
  display: grid;
  place-items: center;
  min-height: 280px;
}
.og-board > svg { display: block; width: 100%; height: 100%; max-height: 62vh; overflow: visible; }

/* The one-sentence rule under the board. */
.og-caption { margin: 0; text-align: center; font-size: var(--fs-2); line-height: 1.5; color: var(--muted); }

/* ---------- Manual / Auto ---------- */
.og-mode-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; padding: 2px; background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius); margin-bottom: var(--sp-2); }
.og-mode-tabs button { padding: 7px 0; border-radius: 4px !important; font-size: var(--fs-2); font-weight: 600; color: var(--muted); background: transparent; }
.og-mode-tabs button.on { color: var(--text); background: var(--hover); }
.og-autobet { display: flex; flex-direction: column; gap: var(--sp-2); }
.og-num-field { display: flex; align-items: center; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg); overflow: hidden; }
.og-num-field input { flex: 1; min-width: 0; padding: 10px var(--sp-3); border: 0; outline: none; background: transparent; font-weight: 600; font-variant-numeric: tabular-nums; }
.og-num-field input:disabled { opacity: 0.4; }
.og-num-suffix { padding: 0 var(--sp-3); color: var(--muted); font-weight: 600; }
.og-on-outcome { display: grid; grid-template-columns: minmax(0, 1fr) 92px; gap: 6px; }
.og-on-outcome .og-chip { font-size: var(--fs-1); padding: 8px 2px; }
.og-stop-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--sp-2); }
.og-stop-row > div { min-width: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
.og-stop-row .og-label { margin-top: 0; }
.og-auto-profit { text-align: center; font-size: var(--fs-2); color: var(--muted); font-variant-numeric: tabular-nums; }
.og-auto-profit.up b { color: var(--win); }
.og-auto-profit.down b { color: var(--lose); }

/* ---------- Instant result: stays until the next result ---------- */
.og-instant {
  position: absolute; top: var(--sp-3); left: 50%; z-index: 4;
  display: flex; align-items: baseline; gap: 10px; padding: 6px 14px;
  border-radius: var(--radius); background: var(--raised); border: 1px solid var(--line-strong);
  font-variant-numeric: tabular-nums; transform: translateX(-50%);
  animation: og-fade var(--dur-ui) ease both;
  pointer-events: none;
}
.og-instant b { font-size: var(--fs-4); font-weight: 600; color: var(--text); }
.og-instant span { font-size: var(--fs-2); font-weight: 500; color: var(--muted); }
.og-instant.win { border-color: var(--win); }
.og-instant.win b { color: var(--win); }
.og-instant.lose { border-color: var(--lose); }
.og-instant.lose b { color: var(--lose); }

/* ---------- Info modal ---------- */
.og-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: var(--sp-5) var(--sp-4);
  background: rgb(0 0 0 / 0.6);
  animation: og-fade 0.15s ease;
}
.og-modal {
  width: min(620px, 100%);
  max-height: min(86vh, 860px);
  display: flex;
  flex-direction: column;
  color: var(--text);
  background: var(--raised);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
}
.og-modal-head { display: flex; justify-content: space-between; align-items: center; padding: var(--sp-4) var(--sp-5); border-bottom: 1px solid var(--line); }
.og-modal-head h2 { margin: 0; font-size: var(--fs-4); font-weight: 600; }
.og-modal-body { overflow-y: auto; padding: var(--sp-1) var(--sp-5) var(--sp-4); font-size: var(--fs-3); line-height: 1.55; color: var(--text); }
.og-modal-body p { margin: 0 0 var(--sp-2); }
.og-modal-body ul, .og-modal-body ol { margin: 0 0 var(--sp-2); padding-left: 20px; }
.og-modal-body li { margin-bottom: var(--sp-1); }
.og-info-section h3 { margin: var(--sp-4) 0 var(--sp-2); font-size: var(--fs-1); font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.og-modal-foot { padding: var(--sp-3) var(--sp-5) var(--sp-4); border-top: 1px solid var(--line); }
.og-modal-foot .og-btn { width: 100%; margin: 0; }
@keyframes og-fade { from { opacity: 0; } }

/* ---------- Narrow frames: board first, controls below ---------- */
@container (max-width: 760px) {
  .og-game { grid-template-columns: minmax(0, 1fr); height: auto; }
  .og-stage { order: -1; padding: var(--sp-4); }
  .og-panel { overflow: visible; border-right: 0; border-top: 1px solid var(--line); }
  /* Phones: the main action sits right under the board. */
  .og-mode-tabs { order: -3; }
  .og-panel > .og-btn.bet, .og-panel > .og-btn.cash, .og-panel > .og-btn.secondary { order: -2; margin-top: 0; }
  .og-board { min-height: 240px; }
  .og-readout > b { font-size: var(--fs-3); }
  .og-readouts { gap: var(--sp-2) var(--sp-5); }
}

@media (prefers-reduced-motion: reduce) {
  .og-game *, .og-modal * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
`;
