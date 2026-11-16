// The blind slot player's tool: `npm run slots:review -- play <alias> "<steps>"`.
// Expands the slot helper steps into scripts/play.mjs steps, runs play.mjs in
// --blind mode on the aliased game (with the slot sandbox and the feature and
// scroll helpers from play-hook.mjs), then lays the spin screenshots out as contact sheets so
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
export const LABELS = { spin: 'Spin', turbo: 'Turbo', autoplayTab: 'Autoplay', autoplayStart: 'Start autoplay', paytable: 'How to play' };
/** Waits after a spin press, in ms: manual reels stop by 1.6 s (+0.7 s anticipation) and a win counts up for up to 3 s; Turbo about a quarter. */
export const SPIN_WAIT = { normal: 3500, turbo: 1100 };
export const WATCH_WAIT = 1500;
export const MAX_SPINS_PER_CALL = 40;
export const SHEET = { cols: 2, rows: 3, thumbW: 640, thumbH: 400 };

/**
 * How the review forces each of a slot's features, as a kit dev query (engine-bridge.ts):
 * `feature=1` (the game's main feature, the same as `feature=main`), `feature=free` (free spins),
 * `feature=respin` (a respin chain) or `seed=<n>` (a known seed). play-hook.mjs turns each into one
 * fixed `window.__slotDev` call; the blind player never sees which.
 */
export const FEATURE_QUERY = /^(feature=(1|main|free|respin)|seed=\d{1,10})$/;

/**
 * The features a blind player must see, in the order the `feature` step forces them.
 * - `slot.config.json` `review.featureQuery` (a query or a list of them) decides when present.
 * - Otherwise: free spins (`config.feature`) as `feature=1`, plus `feature=respin` when the base spec
 *   has a respin mechanic (`*respin*`, e.g. hold_and_spin_lock_respin, sticky_respin).
 * Empty for a pure base game. Throws on a malformed `review.featureQuery`.
 */
export function featureQueries(config: unknown, spec?: unknown): string[] {
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const review = obj(config) && obj(config.review) ? config.review : undefined;
  const explicit = review?.featureQuery;
  if (explicit !== undefined) {
    const list = Array.isArray(explicit) ? explicit : [explicit];
    const bad = list.filter((q) => typeof q !== 'string' || !FEATURE_QUERY.test(q.replace(/^\?/, '')));
    if (!list.length || bad.length)
      throw new Error(`slot.config.json review.featureQuery must be one or more of "feature=1", "feature=free", "feature=respin" or "seed=<n>" (got ${JSON.stringify(explicit)})`);
    return list.map((q) => (q as string).replace(/^\?/, ''));
  }
  const out: string[] = [];
  if (obj(config) && obj(config.feature)) out.push('feature=1');
  const mechanics = obj(spec) && Array.isArray(spec.mechanics) ? spec.mechanics : [];
  if (mechanics.some((m) => obj(m) && /respin/i.test(String(m.id ?? m.family ?? '')))) out.push('feature=respin');
  return out;
}

export interface Expanded {
  /** play.mjs steps. */
  steps: string[];
  /** For each `text:` step in order, what it was for (to count presses from play.mjs's output). */
  textTags: ('spin' | 'turbo' | 'autoplay' | 'paytable' | 'close' | 'other')[];
  counts: { spins: number; watches: number; turbo: boolean; autoplay: boolean; feature: boolean; paytable: boolean };
  /** Which features (1-based, in featureQueries order) the run's `feature` steps forced. */
  features: number[];
}

const REPEAT = /^(spin|watch)\s*(?:[×x*]\s*(\d+))?(?:@(\d+))?$/i;

/**
 * Expands the player's steps. Throws on an unknown or disallowed step. Each `feature` step forces
 * the next of the game's `featureCount` features, counting on from `featuresDone` earlier ones.
 */
export function expandSteps(input: string, opts: { featureCount?: number; featuresDone?: number } = {}): Expanded {
  const featureCount = Math.max(1, opts.featureCount ?? 1);
  let featureNext = opts.featuresDone ?? 0;
  const raw = input
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const out: Expanded = { steps: [], textTags: [], counts: { spins: 0, watches: 0, turbo: false, autoplay: false, feature: false, paytable: false }, features: [] };
  let turbo = false;
  let pages = 0;
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
      // The kit's Autoplay tab, then its Start autoplay button.
      text(LABELS.autoplayTab, 'other');
      out.steps.push('wait:300');
      text(LABELS.autoplayStart, 'autoplay');
      out.steps.push('wait:400');
    } else if (lower === 'feature') {
      // The kit's dev hook for the game's next feature (featureQueries: window.__slotDev.feature(kind)
      // or .seed(n)): the next spin triggers it. play-hook.mjs turns this virtual key into that one
      // call. A feature search can take up to 5 s.
      const n = (featureNext++ % featureCount) + 1;
      out.counts.feature = true;
      out.features.push(n);
      out.steps.push(`key:SlotFeature${n}`, 'wait:300');
    } else if (lower === 'paytable') {
      // Open it and take three pages of it (the sheet scrolls).
      out.counts.paytable = true;
      text(LABELS.paytable, 'paytable');
      out.steps.push('wait:700', 'shot:paytable-1');
      for (const n of [2, 3]) out.steps.push('key:SlotScroll', 'wait:300', `shot:paytable-${n}`);
      pages = 3;
    } else if (lower === 'scroll') {
      pages++;
      out.steps.push('key:SlotScroll', 'wait:300', `shot:paytable-${pages}`);
    } else if (/^key:slot/i.test(step)) {
      throw new Error(`Step "${step}" is not allowed; use feature or scroll.`);
    } else if (lower === 'close') {
      out.steps.push('key:Escape', 'wait:300');
    } else if (/^(shot|mouse|key|wait)(:|$)/i.test(step)) {
      out.steps.push(step);
    } else if (/^text:/i.test(step)) {
      out.steps.push(step);
      out.textTags.push('other');
    } else {
      throw new Error(`Step "${step}" is not allowed. Use spin, spin×N, turbo, autoplay, watch×N, feature, paytable, scroll, close, shot:<name>, text:<label>, mouse:<x>,<y>, key:<key> or wait:<ms>.`);
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
  /** The features (1-based) this run forced, when a spin followed. Older logs have only `feature` (= feature 1). */
  features?: number[];
  paytable: boolean;
  failedClicks: number;
}

/** The distinct features (1-based) a session forced. */
const featuresSeen = (log: PlayLogEntry[]) => new Set(log.flatMap((e) => e.features ?? (e.feature ? [1] : [])));

/** Totals over every play call of one blind player: what the review checks the session against. */
export function playTotals(log: PlayLogEntry[]) {
  return {
    calls: log.length,
    spins: log.reduce((s, e) => s + e.spinsOk, 0),
    watches: log.reduce((s, e) => s + e.watches, 0),
    turbo: log.some((e) => e.turbo),
    autoplay: log.some((e) => e.autoplay),
    feature: log.some((e) => e.feature),
    /** How many of the game's features were forced (distinct). */
    features: featuresSeen(log).size,
    /** Feature steps forced so far (where the next `feature` step continues). */
    featureRuns: log.reduce((s, e) => s + (e.features?.length ?? (e.feature ? 1 : 0)), 0),
    paytable: log.some((e) => e.paytable),
  };
}

/**
 * What a blind session lacks against the brief (≥ 60 spins incl. Turbo and Autoplay, every feature,
 * the paytable). `featureCount` is the number of features the game has (featureQueries).
 */
export function sessionShortfalls(log: PlayLogEntry[], hasFeature = true, featureCount = 1): string[] {
  const t = playTotals(log);
  const out: string[] = [];
  // Autoplay spins are watched, not pressed: each watch shot counts as about one spin.
  if (t.spins + t.watches < 60) out.push(`about ${t.spins + t.watches} spins (< 60)`);
  if (!t.turbo) out.push('no Turbo');
  if (!t.autoplay) out.push('no Autoplay');
  if (hasFeature && !t.feature) out.push('no feature run');
  else if (hasFeature && featureCount > 1 && t.features < featureCount) out.push(`saw ${t.features} of ${featureCount} features`);
  if (!t.paytable) out.push('never opened the paytable');
  return out;
}

export const readPlayLog = (aliasDir: string): PlayLogEntry[] => {
  const f = join(aliasDir, 'plays.json');
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as PlayLogEntry[]) : [];
};

/** Runs one play call for the game behind an alias; prints what the player may see. */
export function runPlay(gameId: string, aliasDir: string, input: string, errorLog?: string, features: string[] = []): { ok: boolean; output: string } {
  // A pure base game still gets the kit's default hook, so a `feature` step does what it says.
  const queries = features.length ? features : ['feature=1'];
  const before = playTotals(readPlayLog(aliasDir));
  const ex = expandSteps(input, { featureCount: queries.length, featuresDone: before.featureRuns });
  const uiDir = join(aliasDir, 'ui');
  mkdirSync(uiDir, { recursive: true });
  const run = readdirSync(uiDir).filter((f) => f.startsWith('run-')).length + 1;
  const out = join(uiDir, `run-${run}`);
  const hook = pathToFileURL(join(import.meta.dirname, 'play-hook.mjs')).href;
  const once = () =>
    spawnSync(process.execPath, ['--import', hook, PLAY_MJS, gameId, '--blind', '--size', '1280x800', '--out', out, '--steps', ex.steps.join(';')], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, SLOT_PLAY_SANDBOX: 'slot', SLOT_PLAY_FEATURES: JSON.stringify(queries) },
      maxBuffer: 32 * 1024 * 1024,
    });
  const crashedIn = (x: ReturnType<typeof once>) => `${x.stdout ?? ''}${x.stderr ?? ''}`.split('\n').some((l) => /^(Error|TypeError|ReferenceError)\b|^\s+at /.test(l));
  let r = once();
  // The first load of a game can reload the page once (Vite re-optimising its dependencies),
  // which wipes the tool's helpers mid-run. Retry such a run once, from a clean folder.
  if (crashedIn(r)) {
    if (errorLog) writeFileSync(errorLog, `${new Date().toISOString()} run ${run} (retried)\n${r.stdout ?? ''}${r.stderr ?? ''}\n`, { flag: 'a' });
    rmSync(out, { recursive: true, force: true });
    r = once();
  }
  const lines = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n');
  const textLines = lines.filter((l) => /^text\s/.test(l.trim()));
  const worked = (tag: Expanded['textTags'][number]) => textLines.filter((l, i) => ex.textTags[i] === tag && l.includes('✓')).length;
  const spinsOk = worked('spin');
  const failedClicks = textLines.filter((l) => l.includes('✗')).length;
  const sandboxBroken = lines.some((l) => l.includes('slot sandbox patch did not apply'));
  // A crash of the tool itself (not a page error): its details may name the game, so they go to a log
  // outside the player's folder, and the player only learns that the run failed.
  const crashed = lines.some((l) => /^(Error|TypeError|ReferenceError)\b|^\s+at /.test(l));
  if (crashed && errorLog) writeFileSync(errorLog, `${new Date().toISOString()} run ${run}\n${r.stdout ?? ''}${r.stderr ?? ''}\n`, { flag: 'a' });
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
    // Counted only when the click worked (and, for the feature, a spin followed).
    turbo: worked('turbo') > 0,
    autoplay: worked('autoplay') > 0,
    feature: ex.counts.feature && spinsOk > 0,
    features: spinsOk > 0 ? ex.features : [],
    paytable: worked('paytable') > 0,
    failedClicks,
  });
  writeFileSync(join(aliasDir, 'plays.json'), `${JSON.stringify(log, null, 2)}\n`);
  const t = playTotals(log);
  const many = queries.length > 1;
  const forced = ex.features.length ? ` (${many ? `feature ${ex.features.join(', ')} of ${queries.length}` : 'feature'} forced: the spin after each feature step triggers it)` : '';
  const featureLine = many ? `features ${t.features} of ${queries.length}` : `feature ${t.feature ? 'yes' : 'no'}`;
  const summary = [
    `Run ${run}${forced}: ${ex.counts.spins ? `${spinsOk} of ${ex.counts.spins} spin presses worked. ` : ''}`,
    ...shown,
    ...(sheets.length ? [`Contact sheets (the spin and watch screenshots of this run, 6 per image, in order):`, ...sheets.map((s) => `sheet: ${s.replaceAll('\\', '/')}`)] : []),
    `Session so far: ${t.calls} calls, ${t.spins} spins pressed, ${t.watches} autoplay watch shots, Turbo ${t.turbo ? 'yes' : 'no'}, Autoplay ${t.autoplay ? 'yes' : 'no'}, ${featureLine}, paytable ${t.paytable ? 'yes' : 'no'}.`,
  ];
  if (sandboxBroken) summary.push('✗ The sandbox could not be set up; stop and report this.');
  if (crashed) summary.push('✗ The play tool failed during this run (details logged for the operator). Try once more; if it fails again, stop and report it.');
  return { ok: r.status === 0 && !sandboxBroken && !crashed, output: summary.join('\n') };
}
