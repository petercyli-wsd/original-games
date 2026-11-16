// The blind slot player's tool: `npm run slots:review -- play <alias> "<steps>"`.
// Expands the slot helper steps into scripts/play.mjs steps, runs play.mjs in
// --blind mode on the aliased game (with the dev query and the slot sandbox
// from play-hook.mjs), then lays the spin screenshots out as contact sheets so
// a player can look at 60 spins without opening 60 images.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLAY_MJS, ROOT } from './paths';

/**
 * Button labels in the slot kit (`@originals/slots/ui`). play.mjs's `text:` step clicks the
 * first enabled button whose text contains the label (case-insensitive).
 */
export const LABELS = { spin: 'Spin', turbo: 'Turbo', autoplay: 'Auto', paytable: 'Paytable', close: 'Close' };
/** Waits after a spin press, in ms: manual reels stop by 1.6 s (+0.7 s anticipation) and a win counts up for up to 3 s; Turbo about a quarter. */
export const SPIN_WAIT = { normal: 3200, turbo: 1100 };
export const WATCH_WAIT = 1500;
export const MAX_SPINS_PER_CALL = 40;
export const SHEET = { cols: 2, rows: 3, thumbW: 640, thumbH: 400 };

export interface Expanded {
  /** play.mjs steps. */
  steps: string[];
  /** The dev query for this call ("feature=1" or ""). */
  query: string;
  /** For each `text:` step in order, what it was for (to count presses from play.mjs's output). */
  textTags: ('spin' | 'turbo' | 'autoplay' | 'paytable' | 'close' | 'other')[];
  counts: { spins: number; watches: number; turbo: boolean; autoplay: boolean; feature: boolean; paytable: boolean };
}

const REPEAT = /^(spin|watch)\s*(?:[×x*]\s*(\d+))?(?:@(\d+))?$/i;

/** Expands the player's steps. Throws on an unknown or disallowed step. */
export function expandSteps(input: string): Expanded {
  const raw = input
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const out: Expanded = { steps: [], query: '', textTags: [], counts: { spins: 0, watches: 0, turbo: false, autoplay: false, feature: false, paytable: false } };
  let turbo = false;
  const text = (label: string, tag: Expanded['textTags'][number]) => {
    out.steps.push(`text:${label}`);
    out.textTags.push(tag);
  };
  for (const step of raw) {
    const lower = step.toLowerCase();
    const rep = REPEAT.exec(step);
    if (rep) {
      const kind = rep[1].toLowerCase();
      const n = Number(rep[2] ?? 1);
      if (!(n >= 1)) throw new Error(`"${step}": the count must be at least 1`);
      if (kind === 'spin') {
        if (out.counts.spins + n > MAX_SPINS_PER_CALL) throw new Error(`At most ${MAX_SPINS_PER_CALL} spins per call (split them over several calls).`);
        const ms = Number(rep[3] ?? (turbo ? SPIN_WAIT.turbo : SPIN_WAIT.normal));
        for (let i = 0; i < n; i++) {
          out.counts.spins++;
          text(LABELS.spin, 'spin');
          out.steps.push(`wait:${ms}`, `shot:spin-${String(out.counts.spins).padStart(3, '0')}`);
        }
      } else {
        if (out.counts.watches + n > MAX_SPINS_PER_CALL) throw new Error(`At most ${MAX_SPINS_PER_CALL} watch shots per call.`);
        const ms = Number(rep[3] ?? WATCH_WAIT);
        for (let i = 0; i < n; i++) {
          out.counts.watches++;
          out.steps.push(`wait:${ms}`, `shot:watch-${String(out.counts.watches).padStart(3, '0')}`);
        }
      }
      continue;
    }
    if (lower === 'turbo') {
      turbo = !turbo;
      out.counts.turbo = true;
      text(LABELS.turbo, 'turbo');
      out.steps.push('wait:300');
    } else if (lower === 'autoplay' || lower === 'auto') {
      out.counts.autoplay = true;
      text(LABELS.autoplay, 'autoplay');
      out.steps.push('wait:400');
    } else if (lower === 'feature') {
      out.query = 'feature=1';
      out.counts.feature = true;
    } else if (lower === 'paytable') {
      out.counts.paytable = true;
      text(LABELS.paytable, 'paytable');
      out.steps.push('wait:700', 'shot:paytable');
    } else if (lower === 'close') {
      out.steps.push('key:Escape', 'wait:300');
    } else if (/^(shot|mouse|key|wait)(:|$)/i.test(step)) {
      out.steps.push(step);
    } else if (/^text:/i.test(step)) {
      out.steps.push(step);
      out.textTags.push('other');
    } else {
      throw new Error(`Step "${step}" is not allowed. Use spin, spin×N, turbo, autoplay, watch×N, feature, paytable, close, shot:<name>, text:<label>, mouse:<x>,<y>, key:<key> or wait:<ms>.`);
    }
  }
  return out;
}

function chromePath(): string | undefined {
  return [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(
    (p) => p && existsSync(p),
  );
}

/** Lays out screenshots as contact sheets (2 × 3 per sheet, half size), numbered as taken. Returns the sheet paths. */
export function contactSheets(dir: string, shots: string[]): string[] {
  const chrome = chromePath();
  if (!chrome || !shots.length) return [];
  const per = SHEET.cols * SHEET.rows;
  const sheets: string[] = [];
  for (let i = 0; i < shots.length; i += per) {
    const group = shots.slice(i, i + per);
    const n = sheets.length + 1;
    const html = join(dir, `.sheet-${n}.html`);
    const png = join(dir, `sheet-${String(n).padStart(2, '0')}.png`);
    const cells = group
      .map((s) => `<figure><img src="${pathToFileURL(join(dir, s)).href}"><figcaption>${s.replace(/\.png$/, '')}</figcaption></figure>`)
      .join('');
    writeFileSync(
      html,
      `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${SHEET.cols},${SHEET.thumbW}px);font:14px/1 system-ui;color:#fff}
figure{margin:0;position:relative;width:${SHEET.thumbW}px;height:${SHEET.thumbH}px;outline:1px solid #444}
img{width:100%;height:100%;display:block}
figcaption{position:absolute;left:0;top:0;background:#000c;padding:3px 6px}
</style>${cells}`,
    );
    const rows = Math.ceil(group.length / SHEET.cols);
    spawnSync(
      chrome,
      ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--allow-file-access-from-files', `--window-size=${SHEET.cols * SHEET.thumbW},${rows * SHEET.thumbH}`, `--screenshot=${png}`, pathToFileURL(html).href],
      { stdio: 'ignore', timeout: 60_000 },
    );
    rmSync(html, { force: true });
    if (existsSync(png)) sheets.push(png);
  }
  return sheets;
}

export interface PlayLogEntry {
  run: number;
  date: string;
  spins: number;
  spinsOk: number;
  watches: number;
  turbo: boolean;
  autoplay: boolean;
  feature: boolean;
  paytable: boolean;
  failedClicks: number;
}

/** Totals over every play call of one blind player: what the review checks the session against. */
export function playTotals(log: PlayLogEntry[]) {
  return {
    calls: log.length,
    spins: log.reduce((s, e) => s + e.spinsOk, 0),
    watches: log.reduce((s, e) => s + e.watches, 0),
    turbo: log.some((e) => e.turbo),
    autoplay: log.some((e) => e.autoplay),
    feature: log.some((e) => e.feature),
    paytable: log.some((e) => e.paytable),
  };
}

/** What a blind session lacks against the brief (≥ 60 spins incl. Turbo and Autoplay, a feature, the paytable). */
export function sessionShortfalls(log: PlayLogEntry[]): string[] {
  const t = playTotals(log);
  const out: string[] = [];
  // Autoplay spins are watched, not pressed: each watch shot counts as about one spin.
  if (t.spins + t.watches < 60) out.push(`about ${t.spins + t.watches} spins (< 60)`);
  if (!t.turbo) out.push('no Turbo');
  if (!t.autoplay) out.push('no Autoplay');
  if (!t.feature) out.push('no feature run');
  if (!t.paytable) out.push('never opened the paytable');
  return out;
}

export const readPlayLog = (aliasDir: string): PlayLogEntry[] => {
  const f = join(aliasDir, 'plays.json');
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as PlayLogEntry[]) : [];
};

/** Runs one play call for the game behind an alias; prints what the player may see. */
export function runPlay(gameId: string, aliasDir: string, input: string): { ok: boolean; output: string } {
  const ex = expandSteps(input);
  const uiDir = join(aliasDir, 'ui');
  mkdirSync(uiDir, { recursive: true });
  const run = readdirSync(uiDir).filter((f) => f.startsWith('run-')).length + 1;
  const out = join(uiDir, `run-${run}`);
  const hook = pathToFileURL(join(import.meta.dirname, 'play-hook.mjs')).href;
  const r = spawnSync(process.execPath, ['--import', hook, PLAY_MJS, gameId, '--blind', '--size', '1280x800', '--out', out, '--steps', ex.steps.join(';')], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, SLOT_PLAY_QUERY: ex.query, SLOT_PLAY_SANDBOX: 'slot' },
    maxBuffer: 32 * 1024 * 1024,
  });
  const lines = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n');
  const textLines = lines.filter((l) => /^text\s/.test(l.trim()));
  const spinsOk = textLines.filter((l, i) => ex.textTags[i] === 'spin' && l.includes('✓')).length;
  const failedClicks = textLines.filter((l) => l.includes('✗')).length;
  const sandboxBroken = lines.some((l) => l.includes('slot sandbox patch did not apply'));
  // What the player sees: clicks that failed, screenshots, errors (details hidden by --blind). Successful spin clicks are summarised.
  const shown = lines
    .map((l) => l.trim())
    .filter((l) => /^(shot|✗|✓)|not allowed/.test(l) || (/^text\s/.test(l) && (l.includes('✗') || !l.startsWith(`text  ${LABELS.spin} `))))
    .map((l) => l.replace(/^shot\s+/, 'screenshot: ').replaceAll('\\', '/'));
  const shots = existsSync(out) ? readdirSync(out).filter((f) => /^\d+-(spin|watch)-\d+\.png$/.test(f)).sort() : [];
  const sheets = contactSheets(out, shots);
  const log = readPlayLog(aliasDir);
  log.push({
    run,
    date: new Date().toISOString(),
    spins: ex.counts.spins,
    spinsOk,
    watches: ex.counts.watches,
    turbo: ex.counts.turbo,
    autoplay: ex.counts.autoplay,
    feature: ex.counts.feature,
    paytable: ex.counts.paytable,
    failedClicks,
  });
  writeFileSync(join(aliasDir, 'plays.json'), `${JSON.stringify(log, null, 2)}\n`);
  const t = playTotals(log);
  const summary = [
    `Run ${run}${ex.query ? ' (feature forced: the next spin triggers the bonus feature)' : ''}: ${ex.counts.spins ? `${spinsOk} of ${ex.counts.spins} spin presses worked. ` : ''}`,
    ...shown,
    ...(sheets.length ? [`Contact sheets (the spin and watch screenshots of this run, 6 per image, in order):`, ...sheets.map((s) => `sheet: ${s.replaceAll('\\', '/')}`)] : []),
    `Session so far: ${t.calls} calls, ${t.spins} spins pressed, ${t.watches} autoplay watch shots, Turbo ${t.turbo ? 'yes' : 'no'}, Autoplay ${t.autoplay ? 'yes' : 'no'}, feature ${t.feature ? 'yes' : 'no'}, paytable ${t.paytable ? 'yes' : 'no'}.`,
  ];
  if (sandboxBroken) summary.push('✗ The sandbox could not be set up; stop and report this.');
  return { ok: r.status === 0 && !sandboxBroken, output: summary.join('\n') };
}
