// The kit's stylesheet. Pass it to defineReactGame together with the game's
// own CSS: defineReactGame(Game, { styles: kitStyles + styles }).
// It lives inside the game's shadow root, so it uses :host, not :root.

export const kitStyles = /* css */ `
:host {
  display: block;
  height: 100%;
  color: var(--og-text, #f6f6f6);
  font-family: var(--og-font, 'Outfit', system-ui, sans-serif);
}
* { box-sizing: border-box; }

.og-shell { height: 100%; container-type: inline-size; }

.og-game {
  --bg: var(--og-bg, #07070b);
  --card: var(--og-bg-card, #101016);
  --raised: var(--og-bg-raised, #15151c);
  --hover: var(--og-bg-hover, #21212a);
  --line: var(--og-border, rgba(255, 255, 255, 0.14));
  --line-strong: var(--og-border-strong, rgba(255, 255, 255, 0.24));
  --text: var(--og-text, #f6f6f6);
  --muted: var(--og-text-muted, #aaa7b2);
  --red: var(--og-red, #e9113c);
  --green: var(--og-green, #00e701);
  --gold: var(--og-gold, #f5a623);
  --accent: #7c5cff;
  --radius: var(--og-radius, 8px);
  --radius-lg: var(--og-radius-lg, 12px);

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
  transition: filter 0.15s ease, transform 0.1s ease, background 0.15s ease, color 0.15s ease;
}
.og-game button:disabled { opacity: 0.45; cursor: not-allowed; }
.og-game button:not(:disabled):active { transform: scale(0.98); }
.og-game button:focus-visible, .og-game input:focus-visible, .og-game summary:focus-visible, .og-game [tabindex]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* ---------- Control panel ---------- */
.og-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px;
  background: var(--raised);
  min-width: 0;
  overflow-y: auto;
}
.og-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-top: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}
.og-panel > .og-label:first-child { margin-top: 0; }
.og-hint { font-size: 12px; font-weight: 500; opacity: 0.85; font-variant-numeric: tabular-nums; text-align: right; }
.og-hint b { color: var(--text); }

.og-bet-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 52px 52px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg);
}
.og-bet-row input {
  min-width: 0;
  padding: 11px 12px;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.og-bet-row button { border-radius: 0; border-left: 1px solid var(--line); background: var(--raised); font-weight: 700; }
.og-bet-row button:not(:disabled):hover { background: var(--hover); }

.og-chips { display: flex; gap: 4px; padding: 4px; background: var(--bg); border-radius: var(--radius); }
.og-chips.wrap { flex-wrap: wrap; }
.og-chips.wrap .og-chip { flex: 1 0 calc(25% - 4px); }
.og-chip {
  flex: 1;
  min-width: 0;
  padding: 8px 4px;
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  background: transparent;
  border-radius: 6px !important;
  white-space: nowrap;
}
.og-chip:not(:disabled):hover { color: var(--text); }
.og-chip.on { color: var(--text); background: var(--hover); box-shadow: inset 0 -2px 0 var(--accent); }

.og-range { width: 100%; height: 22px; margin: 0; background: transparent; appearance: none; -webkit-appearance: none; }
.og-range::-webkit-slider-runnable-track { height: 6px; border-radius: 99px; background: var(--hover); }
.og-range::-moz-range-track { height: 6px; border-radius: 99px; background: var(--hover); }
.og-range.risk::-webkit-slider-runnable-track { background: linear-gradient(90deg, var(--red), var(--gold), var(--green)); }
.og-range.risk::-moz-range-track { background: linear-gradient(90deg, var(--red), var(--gold), var(--green)); }
.og-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px; height: 18px; margin-top: -6px;
  border-radius: 50%; background: #fff; border: 0;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 35%, transparent), 0 2px 8px #0008;
}
.og-range::-moz-range-thumb {
  width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 0;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 35%, transparent), 0 2px 8px #0008;
}
.og-range:disabled { opacity: 0.5; }

.og-vol {
  padding: 2px 8px;
  border-radius: 99px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  background: var(--hover);
}
.og-vol.low { color: var(--green); }
.og-vol.medium { color: var(--accent); }
.og-vol.high { color: var(--gold); }
.og-vol.extreme { color: var(--red); }

.og-btn { padding: 14px; font-size: 15px; font-weight: 700; }
.og-btn.bet {
  margin-top: 10px;
  color: var(--og-text-on-accent, #07070b);
  background: var(--green);
  box-shadow: 0 0 24px -6px var(--og-green-glow, rgba(0, 231, 1, 0.45));
}
.og-btn.cash {
  margin-top: 10px;
  display: flex;
  justify-content: center;
  gap: 8px;
  color: var(--og-text-on-accent, #07070b);
  background: var(--gold);
  box-shadow: 0 0 24px -6px color-mix(in srgb, var(--gold) 60%, transparent);
  font-variant-numeric: tabular-nums;
}
.og-btn.secondary { color: var(--text); background: var(--hover); }
.og-btn:not(:disabled):hover { filter: brightness(1.1); }

.og-ghost { background: transparent; border: 1px solid var(--line) !important; padding: 8px 10px; color: var(--muted); }
.og-ghost:not(:disabled):hover { color: var(--text); border-color: var(--line-strong) !important; }

.og-panel-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding-top: 12px;
}
.og-toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); cursor: pointer; }
.og-toggle input { width: 16px; height: 16px; accent-color: var(--accent); }
.og-info-btn { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
.og-info-btn .i {
  display: grid; place-items: center;
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--accent); color: var(--bg);
  font-size: 12px; font-weight: 800; font-style: italic;
}

.og-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin: 4px 0 0; font-size: 12px; color: var(--muted); }
.og-stats dt { margin: 0; }
.og-stats dd { margin: 0; text-align: right; color: var(--text); font-weight: 700; font-variant-numeric: tabular-nums; }

/* ---------- Stage ---------- */
.og-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 18px clamp(14px, 3cqi, 32px);
  background: radial-gradient(ellipse at 50% 40%, color-mix(in srgb, var(--accent) 7%, var(--card)) 0%, var(--card) 65%);
}
.og-stage-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 30px; }
.og-status {
  flex-shrink: 0;
  padding: 5px 12px;
  border-radius: 99px;
  font-size: 13px;
  font-weight: 700;
  color: var(--muted);
  background: var(--raised);
  border: 1px solid var(--line);
}
.og-status.live { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
.og-status.won { color: var(--green); border-color: color-mix(in srgb, var(--green) 50%, transparent); }
.og-status.lost { color: var(--red); border-color: color-mix(in srgb, var(--red) 50%, transparent); }
.og-history { display: flex; gap: 4px; overflow: hidden; justify-content: flex-end; min-width: 0; }
.og-hist {
  flex-shrink: 0;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  background: var(--raised);
  color: var(--muted);
}
.og-hist.w { color: var(--green); background: color-mix(in srgb, var(--green) 14%, transparent); }
.og-hist.p { color: var(--gold); background: color-mix(in srgb, var(--gold) 14%, transparent); }
.og-hist.l { color: var(--red); background: color-mix(in srgb, var(--red) 14%, transparent); }

.og-readouts { display: grid; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); gap: 8px; }
.og-readout {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  border-radius: var(--radius);
  background: var(--bg);
  border: 1px solid var(--line);
  min-width: 0;
}
.og-readout > span { font-size: 12px; font-weight: 600; color: var(--muted); }
.og-readout > b { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.og-readout > small { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.og-readout.chance > b { color: var(--accent); }
.og-readout.cash > b { color: var(--gold); }
.og-readout.prize > b { color: var(--green); }

.og-chance { display: flex; flex-direction: column; gap: 6px; }
.og-chance-head { display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; color: var(--muted); }
.og-chance-head b { color: var(--text); font-variant-numeric: tabular-nums; }
.og-chance-track { height: 10px; border-radius: 99px; background: color-mix(in srgb, var(--red) 30%, var(--bg)); overflow: hidden; }
.og-chance-track i { display: block; height: 100%; border-radius: 99px; background: var(--green); transition: width 0.3s var(--og-ease, ease); }
.og-chance small { font-size: 12px; color: var(--muted); }

.og-board {
  position: relative;
  flex: 1;
  display: grid;
  place-items: center;
  min-height: 280px;
}
.og-board > svg { display: block; width: 100%; height: 100%; max-height: 62vh; overflow: visible; }
.og-caption { margin: 0; text-align: center; font-size: 13px; line-height: 1.5; color: var(--muted); }


/* ---------- Manual / Auto ---------- */
.og-mode-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; background: var(--bg); border-radius: 99px; margin-bottom: 4px; }
.og-mode-tabs button { padding: 8px 0; border-radius: 99px !important; font-size: 13px; font-weight: 700; color: var(--muted); background: transparent; }
.og-mode-tabs button.on { color: var(--text); background: var(--hover); }
.og-autobet { display: flex; flex-direction: column; gap: 8px; }
.og-num-field { display: flex; align-items: center; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg); overflow: hidden; }
.og-num-field input { flex: 1; min-width: 0; padding: 10px 12px; border: 0; outline: none; background: transparent; font-weight: 600; font-variant-numeric: tabular-nums; }
.og-num-field input:disabled { opacity: 0.5; }
.og-num-suffix { padding: 0 12px; color: var(--muted); font-weight: 700; }
.og-on-outcome { display: grid; grid-template-columns: minmax(0, 1fr) 92px; gap: 6px; }
.og-on-outcome .og-chip { font-size: 12px; padding: 8px 2px; }
.og-stop-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
.og-stop-row > div { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.og-stop-row .og-label { margin-top: 0; }
.og-auto-profit { text-align: center; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
.og-auto-profit.up b { color: var(--green); }
.og-auto-profit.down b { color: var(--red); }

/* ---------- Instant result pill ---------- */
.og-instant {
  position: absolute; top: 12px; left: 50%; z-index: 4;
  display: flex; align-items: baseline; gap: 10px; padding: 8px 16px;
  border-radius: 99px; background: rgba(16, 16, 22, 0.9); border: 1.5px solid var(--gold);
  font-variant-numeric: tabular-nums; transform: translateX(-50%);
  animation: og-instant-in 0.25s cubic-bezier(0.2, 0.8, 0.3, 1.2) both;
  pointer-events: none;
}
.og-instant b { font-size: 22px; font-weight: 800; color: var(--gold); }
.og-instant span { font-size: 13px; font-weight: 600; color: var(--muted); }
.og-instant.win { border-color: var(--green); box-shadow: 0 0 30px -10px var(--green); }
.og-instant.win b { color: var(--green); }
.og-instant.lose { border-color: var(--red); }
.og-instant.lose b { color: var(--red); }
@keyframes og-instant-in { from { opacity: 0; transform: translateX(-50%) translateY(-6px) scale(0.92); } }

/* ---------- Info modal ---------- */
.og-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 24px 16px;
  background: color-mix(in srgb, var(--og-bg, #07070b) 72%, transparent);
  backdrop-filter: blur(4px);
  animation: og-fade 0.2s ease;
}
.og-modal {
  --bg: var(--og-bg, #07070b);
  --line: var(--og-border, rgba(255, 255, 255, 0.14));
  --muted: var(--og-text-muted, #aaa7b2);
  width: min(620px, 100%);
  max-height: min(86vh, 860px);
  display: flex;
  flex-direction: column;
  color: var(--og-text, #f6f6f6);
  background: var(--og-bg-card, #101016);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 30px 80px #000a;
  animation: og-pop 0.25s ease;
}
.og-modal-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 22px; border-bottom: 1px solid var(--line); }
.og-modal-head h2 { margin: 0; font-size: 22px; font-weight: 800; }
.og-modal-body { overflow-y: auto; padding: 4px 22px 18px; font-size: 15px; line-height: 1.55; color: color-mix(in srgb, var(--og-text, #f6f6f6) 86%, var(--muted)); }
.og-modal-body p { margin: 0 0 8px; }
.og-modal-body ul, .og-modal-body ol { margin: 0 0 8px; padding-left: 20px; }
.og-modal-body li { margin-bottom: 4px; }
.og-info-section h3 { margin: 18px 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 1.2px; color: var(--muted); }
.og-modal-foot { padding: 12px 22px 16px; border-top: 1px solid var(--line); }
.og-modal-foot .og-btn { width: 100%; margin: 0; }
@keyframes og-fade { from { opacity: 0; } }
@keyframes og-pop { from { transform: translateY(12px) scale(0.98); opacity: 0; } }

/* ---------- Narrow frames: board first, controls below ---------- */
@container (max-width: 760px) {
  .og-game { grid-template-columns: minmax(0, 1fr); height: auto; }
  .og-stage { order: -1; }
  .og-panel { overflow: visible; }
  .og-board { min-height: 240px; }
  .og-readout > b { font-size: 18px; }
  .og-readout { padding: 8px 10px; }
}

@media (prefers-reduced-motion: reduce) {
  .og-game *, .og-modal * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
`;
