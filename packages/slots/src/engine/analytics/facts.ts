// The measured facts of a slot: `games/<id>/src/slot-facts.json`, written by `npm run slots:eval`.
// The platform and the slot review read it. Pure (no Node APIs): eval.ts does the IO and hashing.
//
// Schema slot_facts_v1. Top-level fields the coordinator reads (exact names):
//   rtp            fraction (the capped round RTP, docs/SLOTS.md §2.6–2.7)
//   rtpTier        'exact' | 'exact_mixture' | 'mc'
//   rtpSe          fraction; 0 when the tier is exact (always present, so a tolerant reader never
//                  picks up a nested `se` as the RTP's), rtpN when mc
//   hitRate        fraction of paid rounds that pay anything
//   volatility     the band word the measured SD falls in: low | medium | high | extreme
//   volatilitySd   SD of the round win in stakes (uncapped)
//   maxWin         the declared cap in stakes
//   featureFreq    N of "1 in N" rounds (null without a feature)
//   featureShare   fraction of the RTP from the feature (0 for a pure base game)
// Also top level, in the names scripts/slots/review-lib/facts.ts reads: winOverStakeRate,
// avgFeatureWin, pWin100, pMaxWin (+ pMaxWinBounds), dryStreakP95, sessionMedian. Then the full §3
// table under `stats` (one row per measure: value, display, tier, se, n, band, pass, gate, method),
// volatilityDeclared, rtpUncapped, capLoss, rtpSplit, the feature summary, bandsPassed / bandsFailed /
// gateFailed, the oracle check and the specHash (sha256 of `canonicalJson(spec text)`, the hash the
// oracle records). Deterministic: no timestamps.

import type { SlotConfig } from './config';
import type { CapLoss, SlotStats, StatRow, Tier } from './stats';

export const FACTS_SCHEMA = 'slot_facts_v1';

export interface OracleCheckItem {
  /** 'base' or the feature's oracle name. */
  name: string;
  file: string;
  ok: boolean;
  specHash?: string;
  oracleHash?: string;
  packRtp?: number;
  packTier?: string;
  tsRtp?: number;
  tsTier?: string;
  diff?: number;
  tolerance?: number;
  detail: string;
}

export interface OracleCheck {
  status: 'pass' | 'fail' | 'missing' | 'stale';
  detail: string;
  checks: OracleCheckItem[];
}

export interface SlotFactsRow extends Omit<StatRow, 'band' | 'value'> {
  value: number | null;
  band: { lo: number; hi: number | null; text: string } | null;
}

export interface SlotFacts {
  schema: typeof FACTS_SCHEMA;
  game: string;
  generatedBy: string;
  specHash: string;
  featureSpecHash: string | null;

  rtp: number;
  rtpTier: Tier;
  rtpSe: number;
  rtpN?: number;
  hitRate: number;
  volatility: SlotStats['volatilityMeasured'];
  volatilitySd: number;
  maxWin: number;
  featureFreq: number | null;
  featureShare: number;

  volatilityDeclared: SlotStats['volatilityDeclared'];
  winOverStakeRate: number;
  avgFeatureWin: number | null;
  pWin100: number;
  /** Best evidence for P(reaching the cap) per round (the exact lower bound, or the MC estimate when it saw hits). */
  pMaxWin: number;
  pMaxWinBounds: { lower: number; upper: number; tier: Tier };
  dryStreakP95: number;
  sessionMedian: number;
  sessionBustRate: number;

  rtpUncapped: number;
  rtpUncappedTier: Tier;
  rtpUncappedSe?: number;
  capLoss: CapLoss;
  rtpSplit: { base: number; baseTier: Tier; feature: number; capLoss: number };
  feature: null | {
    kind: 'free_spins';
    spec: string;
    awards: Record<string, number>;
    retrigger: Record<string, number> | null;
    maxSpins: number;
    multiplier: unknown;
    tier: Tier;
    triggerP: number;
    expectedSpins: number;
    averageWinStakes: number;
    sdWinStakes: number;
    pZero: number;
    featureRtp: number;
    buy: boolean;
    buyPriceStakes: number | null;
    byK: { k: number; pK: number; spins: number; expectedSpins: number; averageWinStakes: number; pZero: number }[];
  };
  stats: SlotFactsRow[];
  bandsPassed: string[];
  bandsFailed: string[];
  gateFailed: string[];
  oracle: OracleCheck;
  distributions: SlotStats['distributions'];
  mc: SlotStats['mc'];
}

const finite = (x: number | null | undefined): number | null => (x === null || x === undefined || !Number.isFinite(x) ? null : x);

export function buildSlotFacts(args: {
  game: string;
  specHash: string;
  featureSpecHash?: string | null;
  config: SlotConfig;
  stats: SlotStats;
  oracle: OracleCheck;
  generatedBy?: string;
}): SlotFacts {
  const { stats: s, config } = args;
  const f = s.feature;
  const cfg = config.feature ?? null;
  return {
    schema: FACTS_SCHEMA,
    game: args.game,
    generatedBy: args.generatedBy ?? 'npm run slots:eval (scripts/slots/eval.ts, packages/slots/src/engine/analytics)',
    specHash: args.specHash,
    featureSpecHash: args.featureSpecHash ?? null,

    rtp: s.rtp,
    rtpTier: s.rtpTier,
    rtpSe: s.rtpTier === 'mc' ? s.rtpSe ?? 0 : 0,
    ...(s.rtpTier === 'mc' && s.rtpN !== undefined ? { rtpN: s.rtpN } : {}),
    hitRate: s.hitRate,
    volatility: s.volatilityMeasured,
    volatilitySd: s.sdStakes,
    maxWin: s.maxWinStakes,
    featureFreq: f ? finite(f.frequency) : null,
    featureShare: f ? f.share : 0,

    volatilityDeclared: s.volatilityDeclared,
    winOverStakeRate: s.winOverStake.value,
    avgFeatureWin: f ? f.averageWinStakes : null,
    pWin100: s.pWin100.value,
    pMaxWin: s.reach.best,
    pMaxWinBounds: { lower: s.reach.lowerBound, upper: s.reach.upperBound, tier: s.reach.boundTier },
    dryStreakP95: s.dryStreakP95,
    sessionMedian: s.session.medianStakes,
    sessionBustRate: s.session.pBust,

    rtpUncapped: s.rtpUncapped,
    rtpUncappedTier: s.rtpUncappedTier,
    ...(s.rtpUncappedSe !== undefined ? { rtpUncappedSe: s.rtpUncappedSe } : {}),
    capLoss: s.capLoss,
    rtpSplit: { base: s.baseRtp, baseTier: s.baseRtpTier, feature: s.featureRtp, capLoss: s.rtpUncapped - s.rtp },
    feature:
      f && cfg
        ? {
            kind: 'free_spins',
            spec: cfg.spec,
            awards: cfg.awards,
            retrigger: cfg.retrigger ?? null,
            maxSpins: cfg.maxSpins,
            multiplier: cfg.multiplier,
            tier: f.tier,
            triggerP: f.triggerP,
            expectedSpins: f.expectedSpins,
            averageWinStakes: f.averageWinStakes,
            sdWinStakes: f.sdWinStakes,
            pZero: f.pZero,
            featureRtp: f.featureRtp,
            buy: !!cfg.buy,
            buyPriceStakes: f.buyPriceStakes,
            byK: f.byK,
          }
        : null,
    stats: s.rows.map((r) => ({ ...r, value: finite(r.value), band: r.band ? { lo: r.band.lo, hi: finite(r.band.hi), text: r.band.text } : null })),
    bandsPassed: s.bandsPassed,
    bandsFailed: s.bandsFailed,
    gateFailed: s.gateFailed,
    oracle: args.oracle,
    distributions: s.distributions,
    mc: s.mc,
  };
}

// --------------------------------------------------------------------------- canonical JSON

// The oracle's specHash is sha256 of Python's
//   json.dumps(spec, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
// of the parsed spec file. JSON.parse loses what Python keeps (1.0 vs 1, big ints), so
// `canonicalJson` re-reads the TEXT, keeping each number's lexeme, and prints Python's way:
//   int lexeme   → the integer (arbitrary size); float lexeme (has . or e) → repr(float):
//                  shortest round-trip digits, fixed notation for exponents −4..15 with ".0" when
//                  integral, else d.ddde±XX; ±inf → Infinity / -Infinity
//   strings      → ensure_ascii: \" \\ \n \r \t \b \f, everything outside ' '..'~' as \uXXXX (lowercase)
//   objects      → keys sorted, the last duplicate wins

type JNode =
  | { t: 'num'; lex: string }
  | { t: 'str'; v: string }
  | { t: 'lit'; v: 'true' | 'false' | 'null' }
  | { t: 'arr'; v: JNode[] }
  | { t: 'obj'; v: Map<string, JNode> };

function parseLossless(text: string): JNode {
  let i = 0;
  const ws = () => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
  };
  const fail = (what: string): never => {
    throw new Error(`canonicalJson: ${what} at offset ${i}`);
  };
  const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const str = (): string => {
    const start = i;
    i++; // opening quote
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= text.length) fail('unterminated string');
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const val = (): JNode => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const m = new Map<string, JNode>();
      ws();
      if (text[i] === '}') {
        i++;
        return { t: 'obj', v: m };
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('expected a key');
        const k = str();
        ws();
        if (text[i] !== ':') fail("expected ':'");
        i++;
        m.set(k, val());
        ws();
        if (text[i] === ',') i++;
        else if (text[i] === '}') {
          i++;
          return { t: 'obj', v: m };
        } else fail("expected ',' or '}'");
      }
    }
    if (c === '[') {
      i++;
      const a: JNode[] = [];
      ws();
      if (text[i] === ']') {
        i++;
        return { t: 'arr', v: a };
      }
      for (;;) {
        a.push(val());
        ws();
        if (text[i] === ',') i++;
        else if (text[i] === ']') {
          i++;
          return { t: 'arr', v: a };
        } else fail("expected ',' or ']'");
      }
    }
    if (c === '"') return { t: 'str', v: str() };
    for (const lit of ['true', 'false', 'null'] as const) {
      if (text.startsWith(lit, i)) {
        i += lit.length;
        return { t: 'lit', v: lit };
      }
    }
    NUM.lastIndex = i;
    const m = NUM.exec(text);
    if (!m) return fail('unexpected character');
    i += m[0].length;
    return { t: 'num', lex: m[0] };
  };
  const root = val();
  ws();
  if (i !== text.length) fail('trailing characters');
  return root;
}

/** Python's repr(float). */
export function pyFloatRepr(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const sign = x < 0 ? '-' : '';
  const [mant, ex] = Math.abs(x).toExponential().split('e');
  const digits = mant.replace('.', '');
  const e = Number(ex);
  if (e >= -4 && e < 16) {
    if (e >= 0) {
      const intPart = digits.length > e + 1 ? digits.slice(0, e + 1) : digits.padEnd(e + 1, '0');
      return `${sign}${intPart}.${digits.slice(e + 1) || '0'}`;
    }
    return `${sign}0.${'0'.repeat(-e - 1)}${digits}`;
  }
  const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  return `${sign}${m}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
}

function pyString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i];
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (c === 0x08) out += '\\b';
    else if (c === 0x0c) out += '\\f';
    else if (c < 0x20 || c > 0x7e) out += `\\u${c.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return out + '"';
}

function emit(n: JNode): string {
  switch (n.t) {
    case 'num':
      return /[.eE]/.test(n.lex) ? pyFloatRepr(Number(n.lex)) : BigInt(n.lex).toString();
    case 'str':
      return pyString(n.v);
    case 'lit':
      return n.v;
    case 'arr':
      return `[${n.v.map(emit).join(',')}]`;
    case 'obj': {
      const keys = [...n.v.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${keys.map((k) => `${pyString(k)}:${emit(n.v.get(k)!)}`).join(',')}}`;
    }
  }
}

/** Python's json.dumps(json.loads(text), sort_keys=True, separators=(",", ":"), ensure_ascii=True). */
export function canonicalJson(text: string): string {
  return emit(parseLossless(text));
}
