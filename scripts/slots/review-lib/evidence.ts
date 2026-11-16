// A slot game's evidence for the review: manifest, spec, config, facts, oracle
// summary, theme/symbol source and the code hash. Read from games/<id>/src/.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bandRows, factGateFailures, normaliseFacts, wideMisses, type BandRow, type Declared, type SlotFactsN, type Volatility } from './facts';
import { GAMES_DIR, ROOT } from './paths';
import { featureQueries } from './play';

/** Files the review writes or that are regenerated from the spec: left out of the code hash. */
export const NOT_HASHED = new Set(['slot-review.json', 'slot-facts.json']);

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

export const srcDir = (id: string) => join(GAMES_DIR, id, 'src');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

/** Every file under the game's src, as relative paths, sorted. */
export const srcFiles = (id: string) => walk(srcDir(id)).map((p) => relative(srcDir(id), p).replaceAll('\\', '/'));

/** The slot kit and engine (`@originals/slots`): every slot is drawn and played by it, so it is part of the code hash. */
export const KIT_SRC = join(ROOT, 'packages', 'slots', 'src');
/**
 * Files that can't change the player's game, left out of the code hash wherever they are: tests,
 * test fixtures, tools, and the oracle (the pack's reference spins, `oracle.json` / `oracle.json.gz`,
 * which tests read; the review reads it through evidence, and slots:eval's parity check through
 * slot-facts.json).
 */
const NEVER_HASHED = /(\.test\.tsx?$|(^|\/)(fixtures|tools)\/|(^|\/)oracle\.json(\.gz)?$)/;
/** Kit files left out besides those: the analytics (slots:eval's maths; its results reach the review through slot-facts.json). */
const KIT_NOT_HASHED = /^engine\/analytics\//;
/** The game's runtime entries (package.json exports and the dev page) and the JSON that defines the slot. */
const GAME_ENTRIES = ['index.ts', 'index.tsx', 'manifest.ts', 'dev.ts', 'dev.tsx'];
const GAME_DEFINITION = /^(slot\.spec|slot\.config|feature[^/]*\.spec)\.json$/;

/**
 * The game's files that reach the player: the entries, the slot's spec and config, and every file
 * they import (relative imports, followed transitively). A helper only tests import (an exact-maths
 * model, say) is left out.
 */
export function gameRuntimeFiles(id: string): string[] {
  const dir = srcDir(id);
  const all = new Set(srcFiles(id));
  const seen = new Set<string>();
  const queue = [...all].filter((f) => GAME_ENTRIES.includes(f) || GAME_DEFINITION.test(f));
  const resolve = (from: string, spec: string): string | undefined => {
    const base = relative(dir, join(dir, from, '..', spec.split('?')[0])).replaceAll('\\', '/');
    return [base, ...['.ts', '.tsx', '.js', '.jsx', '.json', '/index.ts', '/index.tsx'].map((x) => base + x)].find((c) => all.has(c));
  };
  while (queue.length) {
    const f = queue.shift()!;
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/\.(tsx?|jsx?|mjs)$/.test(f)) continue;
    const code = readFileSync(join(dir, f), 'utf8');
    for (const m of code.matchAll(/(?:from\s+|import\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const r = resolve(f, m[1]);
      if (r && !seen.has(r)) queue.push(r);
    }
  }
  return [...seen].filter((f) => !NOT_HASHED.has(f.split('/').pop()!) && !NEVER_HASHED.test(f)).sort();
}

/**
 * Hash of what changes the player's game: the game's runtime files (gameRuntimeFiles: not the
 * review, the facts, the oracle, tests, tools or test-only helpers), plus the slot kit and engine
 * (packages/slots/src minus tests, fixtures, tools and engine/analytics), so a kit or engine change
 * makes every slot review stale. Line endings normalised, as for Originals.
 */
export function slotCodeHash(id: string): string {
  const h = createHash('sha256');
  const add = (root: string, f: string, label: string) => {
    const buf = readFileSync(join(root, f));
    const text = /\.(tsx?|jsx?|json|css|svg|md|html)$/.test(f) ? buf.toString('utf8').replace(/\r\n/g, '\n') : buf.toString('base64');
    h.update(`${label}\n${text}\n`);
  };
  for (const f of gameRuntimeFiles(id)) add(srcDir(id), f, f);
  for (const f of walk(KIT_SRC).map((p) => relative(KIT_SRC, p).replaceAll('\\', '/')))
    if (!NEVER_HASHED.test(f) && !KIT_NOT_HASHED.test(f)) add(KIT_SRC, f, `@originals/slots/${f}`);
  return h.digest('hex').slice(0, 16);
}

export function readJsonFile<T = unknown>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
}

export interface Manifest {
  id: string;
  name: string;
  tagline?: string;
  collection?: string;
  status?: string;
  rtp?: number;
  maxMultiplier?: number;
  volatility?: string[];
  mechanic?: string;
  [k: string]: unknown;
}

/** The manifest, by importing manifest.ts (as the Originals evaluator does). */
export async function loadManifest(id: string): Promise<Manifest> {
  const file = join(srcDir(id), 'manifest.ts');
  if (!existsSync(file)) throw new Error(`No game "${id}" (missing games/${id}/src/manifest.ts)`);
  const mod = (await import(pathToFileURL(file).href)) as { default: Manifest };
  return mod.default;
}

/** Slot games: every games/<id> whose manifest has collection 'slots'. Read by text so it stays fast. */
export function slotGameIds(): string[] {
  if (!existsSync(GAMES_DIR)) return [];
  return readdirSync(GAMES_DIR).filter((id) => {
    const m = join(GAMES_DIR, id, 'src', 'manifest.ts');
    return existsSync(m) && /collection:\s*['"]slots['"]/.test(readFileSync(m, 'utf8'));
  });
}

/** Older hand-built slots in the Originals lobby (mechanic 'slots', not on the engine). */
export function legacySlotIds(): string[] {
  if (!existsSync(GAMES_DIR)) return [];
  return readdirSync(GAMES_DIR).filter((id) => {
    const m = join(GAMES_DIR, id, 'src', 'manifest.ts');
    if (!existsSync(m)) return false;
    const t = readFileSync(m, 'utf8');
    return /mechanic:\s*['"]slots['"]/.test(t) && !/collection:\s*['"]slots['"]/.test(t);
  });
}

export interface OracleSummary {
  present: boolean;
  schema?: string;
  packVersion?: string;
  context?: string;
  families: string[];
  level?: string;
  baseRtp?: number;
  baseTier?: string;
  baseSe?: number;
  seeds?: number;
  specHash?: string;
  features: { name: string; context?: string; families: string[]; rtp?: number; tier?: string }[];
  problems: string[];
}

export function summariseOracle(raw: unknown): OracleSummary {
  if (raw === undefined) return { present: false, families: [], features: [], problems: ['no oracle.json'] };
  const o = isObj(raw) ? raw : {};
  const base = isObj(o.base) ? o.base : o;
  const ana = isObj(base.analytics) ? base.analytics : {};
  const problems: string[] = [];
  if (!isObj(o.base)) problems.push('oracle.json has no "base" entry');
  if (typeof ana.rtp !== 'number') problems.push('oracle.json has no base analytics RTP (was it run with --no-analytics?)');
  const feats = isObj(o.features) ? o.features : {};
  return {
    present: isObj(o.base),
    schema: typeof o.schema === 'string' ? o.schema : undefined,
    packVersion: typeof o.packVersion === 'string' ? o.packVersion : undefined,
    context: typeof base.context === 'string' ? base.context : undefined,
    families: Array.isArray(base.families) ? base.families.map(String) : [],
    level: typeof base.level === 'string' ? base.level : undefined,
    baseRtp: typeof ana.rtp === 'number' ? ana.rtp : undefined,
    baseTier: typeof ana.tier === 'string' ? ana.tier : undefined,
    baseSe: typeof ana.rtp_se === 'number' ? ana.rtp_se : undefined,
    seeds: typeof base.seeds === 'number' ? base.seeds : undefined,
    specHash: typeof base.specHash === 'string' ? base.specHash : undefined,
    features: Object.entries(feats).map(([name, v]) => {
      const f = isObj(v) ? v : {};
      const a = isObj(f.analytics) ? f.analytics : {};
      return {
        name,
        context: typeof f.context === 'string' ? f.context : undefined,
        families: Array.isArray(f.families) ? f.families.map(String) : [],
        rtp: typeof a.rtp === 'number' ? a.rtp : undefined,
        tier: typeof a.tier === 'string' ? a.tier : undefined,
      };
    }),
    problems,
  };
}

const VOLS = ['low', 'medium', 'high', 'extreme'];

/** What the game declares: volatility, feature, max win, mechanism and size. */
export function declaredOf(manifest: Manifest, spec: Json | undefined, config: Json | undefined): Declared {
  const cfgVol = typeof config?.volatility === 'string' && VOLS.includes(config.volatility) ? (config.volatility as Volatility) : undefined;
  const manVol = manifest.volatility?.length === 1 && VOLS.includes(manifest.volatility[0]) ? (manifest.volatility[0] as Volatility) : undefined;
  const feature = isObj(config?.feature) ? String(config.feature.kind ?? 'feature') : null;
  const geometry = isObj(spec?.geometry) ? spec.geometry : {};
  const rows = Array.isArray(geometry.rows) ? (geometry.rows as number[]) : [];
  return {
    volatility: cfgVol ?? manVol,
    feature,
    maxWin: typeof config?.maxWinStakes === 'number' ? config.maxWinStakes : manifest.maxMultiplier,
    evaluation: isObj(spec?.evaluation) && typeof spec.evaluation.kind === 'string' ? spec.evaluation.kind : undefined,
    cols: typeof geometry.cols === 'number' ? geometry.cols : undefined,
    rows: rows.length && rows.every((r) => r === rows[0]) ? rows[0] : undefined,
  };
}

/** The mechanism signature §5 uses for "reskin": evaluation law, modifier set, volatility band. */
export interface Signature {
  law: string;
  modifiers: string[];
  band: string;
}

export function signatureOf(spec: Json | undefined, oracle: OracleSummary, declared: Declared, featureFamilies: string[] = [], config?: Json): Signature {
  const specMods = Array.isArray(spec?.mechanics) ? (spec.mechanics as unknown[]).map((m) => (isObj(m) ? String(m.id ?? m.family ?? '') : '')).filter(Boolean) : [];
  const mods = new Set([...(oracle.families.length ? oracle.families : specMods), ...featureFamilies]);
  if (declared.feature) mods.add(`feature:${declared.feature}`);
  // The feature's multiplier law is part of the modifier set; a constant ×1 is no multiplier.
  const mult = isObj(config?.feature) && isObj(config.feature.multiplier) ? config.feature.multiplier : undefined;
  if (mult && !(mult.kind === 'constant' && mult.value === 1)) mods.add(`feature-multiplier:${String(mult.kind)}`);
  // The board size is part of the law: a 3×3 and a 5×3 payline game play differently.
  const geometry = isObj(spec?.geometry) ? spec.geometry : {};
  const rows = Array.isArray(geometry.rows) ? (geometry.rows as number[]) : [];
  const size = typeof geometry.cols === 'number' && rows.length ? `${geometry.cols}×${rows.every((r) => r === rows[0]) ? rows[0] : rows.join('/')}` : '';
  const law = oracle.context ?? declared.evaluation ?? 'unknown';
  return {
    law: size ? `${law} ${size}` : law,
    modifiers: [...mods].sort(),
    band: declared.volatility ?? 'undeclared',
  };
}

export const sameSignature = (a: Signature, b: Signature) =>
  a.law === b.law && a.band === b.band && a.modifiers.length === b.modifiers.length && a.modifiers.every((m, i) => m === b.modifiers[i]);

export const signatureText = (s: Signature) => `${s.law}; modifiers: ${s.modifiers.length ? s.modifiers.join(', ') : 'none'}; volatility: ${s.band}`;

/**
 * Trademarked mechanic names (docs/SLOTS.md §4): the mechanic is fine, the word is not. Pack family
 * ids such as megaways_collector_terminal are identifiers, not names, so a match must not touch
 * another word character.
 */
export const TRADEMARKS: { name: string; re: RegExp }[] = [
  { name: 'Megaways', re: /(?<!\w)mega[\s-]?ways(?!\w)/i },
  { name: 'Hold & Win', re: /(?<!\w)hold\s*(?:&|and|'n'|n|'n)\s*win(?!\w)/i },
  { name: 'Cash Collect', re: /(?<!\w)cash[\s-]?collect(?!\w)/i },
];

const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

/** Trademarked names in the game's code (comments left out) and manifest: "Megaways in Game.tsx". */
export function trademarkHits(id: string): string[] {
  const hits: string[] = [];
  for (const f of srcFiles(id).filter((f) => /\.(tsx?|html)$/.test(f) && !/\.test\.tsx?$/.test(f))) {
    const text = stripComments(readFileSync(join(srcDir(id), f), 'utf8'));
    for (const t of TRADEMARKS) if (t.re.test(text)) hits.push(`${t.name} in ${f}`);
  }
  return hits;
}

/** Source files worth showing the rules-card writer: code, JSON (not the oracle's spins), CSS, SVG. */
const SHOW = /\.(tsx?|json|css|svg)$/;
const HIDE = /(^|\/)(oracle\.json|slot-review\.json|slot-facts\.json)$|\.test\.tsx?$/;
const PER_FILE = 40_000;
const TOTAL = 220_000;

export function themeSources(id: string): { path: string; content: string; truncated: boolean }[] {
  const files = srcFiles(id).filter((f) => SHOW.test(f) && !HIDE.test(f));
  // The spec and config are shown separately in full; the rest in a size budget, smallest first.
  const rest = files.filter((f) => !/^(slot\.spec|slot\.config)\.json$/.test(f));
  const sized = rest.map((f) => ({ path: f, content: readFileSync(join(srcDir(id), f), 'utf8') })).sort((a, b) => a.content.length - b.content.length);
  let used = 0;
  const out: { path: string; content: string; truncated: boolean }[] = [];
  for (const f of sized) {
    const room = Math.max(0, Math.min(PER_FILE, TOTAL - used));
    const truncated = f.content.length > room;
    const content = truncated ? `${f.content.slice(0, room)}\n… [truncated: ${f.content.length - room} more characters]` : f.content;
    used += Math.min(f.content.length, room);
    out.push({ path: f.path, content, truncated });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * What slots:eval itself found about the oracle (slot_facts_v1 records its parity check), and
 * whether the facts were measured from the spec the oracle holds. Gate failures; empty when fine.
 * Facts without the parity check (`oracle.status`) or the `specHash` weren't written by slots:eval
 * (hand-written, or a game-local script), so nothing shows the oracle reproduced: a gate failure.
 */
export function factsIntegrity(factsRaw: Json | undefined, oracle: OracleSummary): string[] {
  if (!factsRaw) return [];
  const out: string[] = [];
  const check = isObj(factsRaw.oracle) ? factsRaw.oracle : undefined;
  if (typeof check?.status !== 'string' || typeof factsRaw.specHash !== 'string')
    out.push('facts not from slots:eval (slot-facts.json has no oracle check or specHash; run npm run slots:eval)');
  if (check && typeof check.status === 'string' && check.status !== 'pass') out.push(`oracle check ${check.status} in slots:eval${typeof check.detail === 'string' && check.detail ? `: ${check.detail}` : ''}`);
  if (typeof factsRaw.specHash === 'string' && oracle.specHash && factsRaw.specHash !== oracle.specHash)
    out.push('slot-facts.json and oracle.json were made from different specs (rerun npm run slots:oracle and slots:eval)');
  return out;
}

export interface SlotEvidence {
  id: string;
  manifest: Manifest;
  codeHash: string;
  spec?: Json;
  config?: Json;
  featureSpecs: { file: string; spec: Json }[];
  factsRaw?: Json;
  facts: SlotFactsN;
  factsMissing: string[];
  oracle: OracleSummary;
  declared: Declared;
  signature: Signature;
  bands: BandRow[];
  wideMisses: string[];
  factFailures: string[];
  /** The game's RTP for the gate: slot-facts (the whole game) if present, else the oracle's base RTP for a pure base game. */
  rtp: number | null;
  rtpSource: string;
  hasFeature: boolean;
  /** How the review forces each feature, in order (play.ts featureQueries); empty for a pure base game. */
  features: string[];
  /** Trademarked mechanic names found in the code (§4): a gate fail. */
  trademarks: string[];
  warnings: string[];
}

export async function buildEvidence(id: string): Promise<SlotEvidence> {
  const src = srcDir(id);
  const manifest = await loadManifest(id);
  const warnings: string[] = [];
  if (manifest.collection !== 'slots') warnings.push(`manifest collection is ${JSON.stringify(manifest.collection)}, not 'slots'`);
  const spec = readJsonFile<Json>(join(src, 'slot.spec.json'));
  if (!spec) warnings.push('no slot.spec.json');
  const config = readJsonFile<Json>(join(src, 'slot.config.json'));
  if (!config) warnings.push('no slot.config.json');
  const featureSpecs = srcFiles(id)
    .filter((f) => /^feature.*\.spec\.json$/.test(f))
    .map((f) => ({ file: f, spec: readJsonFile<Json>(join(src, f))! }));
  const factsRaw = readJsonFile<Json>(join(src, 'slot-facts.json'));
  if (!factsRaw) warnings.push(`no slot-facts.json (run npm run slots:eval -- ${id})`);
  const { facts, missing } = normaliseFacts(factsRaw ?? {});
  const oracle = summariseOracle(readJsonFile(join(src, 'oracle.json')));
  if (oracle.present && spec && oracle.seeds !== undefined && oracle.seeds < 2000) warnings.push(`oracle.json records ${oracle.seeds} seeds (< 2000)`);
  const declared = declaredOf(manifest, spec, config);
  const fv = factsRaw?.volatilityDeclared;
  if (!declared.volatility && typeof fv === 'string' && ['low', 'medium', 'high', 'extreme'].includes(fv)) declared.volatility = fv as Volatility;
  if (!declared.volatility) warnings.push('no declared volatility (slot.config.json volatility, or a single manifest volatility)');
  const featureFamilies = oracle.features.flatMap((f) => f.families);
  const signature = signatureOf(spec, oracle, declared, featureFamilies, config);
  const bands = bandRows(facts, declared);
  // The features a blind player must see (free spins, a respin chain in the base game, or what
  // slot.config.json review.featureQuery lists). A respin-only game is not a pure base game.
  let features: string[] = [];
  try {
    features = featureQueries(config, spec);
  } catch (err) {
    warnings.push((err as Error).message);
  }
  const hasFeature = !!declared.feature || features.length > 0;
  // The oracle's base RTP is the whole game's only without a separate free-spins spec.
  const baseOnly = !declared.feature;
  const rtp = facts.rtp ?? (baseOnly && oracle.baseRtp !== undefined ? oracle.baseRtp : null);
  const rtpSource = facts.rtp !== undefined ? 'slot-facts.json' : rtp != null ? 'oracle.json (base game, no free spins)' : 'none';
  if (facts.rtp !== undefined && baseOnly && oracle.baseRtp !== undefined && Math.abs(facts.rtp - oracle.baseRtp) > Math.max(1e-6, 4 * (facts.rtpSe ?? 0)))
    warnings.push(`slot-facts RTP ${facts.rtp} differs from the pack's ${oracle.baseRtp} for a pure base game`);
  return {
    id,
    manifest,
    codeHash: slotCodeHash(id),
    spec,
    config,
    featureSpecs,
    factsRaw,
    facts,
    factsMissing: missing,
    oracle,
    declared,
    signature,
    bands,
    wideMisses: wideMisses(bands),
    factFailures: [...factGateFailures(bands), ...factsIntegrity(factsRaw, oracle)],
    rtp,
    rtpSource,
    hasFeature,
    features,
    trademarks: trademarkHits(id),
    warnings,
  };
}
