// Measured facts for the slot review: reads games/<id>/src/slot-facts.json
// (written by `npm run slots:eval -- <id>`) tolerantly, checks them against
// the §3 bands of docs/SLOTS.md, and says which misses cap maths fit and which
// fail the gate.
//
// The reader accepts a few spellings per field (camelCase or snake_case, a
// percentage or a fraction, a probability or a "1 in N") so it doesn't break
// when the facts file grows; `missing` lists what it could not find.

export type Volatility = 'low' | 'medium' | 'high' | 'extreme';
export const VOLATILITY_BANDS: Record<Volatility, [number, number]> = {
  low: [2, 5],
  medium: [5, 10],
  high: [10, 20],
  extreme: [20, Infinity],
};

/** §3: the dry-streak p95 limit (longest losing run in 100 spins) by declared volatility. */
export const DRY_STREAK_MAX: Record<Volatility, number> = { low: 12, medium: 20, high: 26, extreme: 32 };

export interface SlotFactsN {
  rtp?: number; // fraction
  rtpTier?: string;
  rtpSe?: number; // fraction
  rtpN?: number;
  hitRate?: number; // fraction
  winOverStake?: number; // fraction of spins returning more than the stake
  sd?: number; // stakes per spin
  measuredVolatility?: string;
  featureOneIn?: number;
  featureShare?: number; // fraction of the RTP
  avgFeatureWin?: number; // stakes
  bigWinOneIn?: number; // 1 in N spins pays >= 100x
  maxWin?: number; // stakes (declared cap)
  maxWinOneIn?: number; // 1 in N spins reaches the cap
  dryStreakP95?: number; // spins
  sessionMedian?: number; // balance after 200 spins from 100
}

type Raw = Record<string, unknown>;
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (isObj(v)) {
    // { value: 0.31, se: ... } or { mean: ... } or { p: ... } wrappers
    for (const k of ['value', 'mean', 'estimate', 'p', 'x']) if (typeof v[k] === 'number' && Number.isFinite(v[k] as number)) return v[k] as number;
  }
  return undefined;
};

/** The first value found under any alias: top level first, then nested objects breadth-first. */
function find(raw: Raw, aliases: string[]): unknown {
  const want = aliases.map(norm);
  let level: Raw[] = [raw];
  for (let depth = 0; depth < 4 && level.length; depth++) {
    for (const a of want) {
      for (const o of level) {
        for (const [k, v] of Object.entries(o)) if (norm(k) === a && v != null) return v;
      }
    }
    level = level.flatMap((o) => Object.entries(o).filter(([k, v]) => isObj(v) && !/^(spins|samples|histogram|raw)$/i.test(k)).map(([, v]) => v as Raw));
  }
  return undefined;
}

const fraction = (v: number | undefined, pctAbove = 1.5) => (v === undefined ? undefined : v > pctAbove ? v / 100 : v);
/** A frequency as "1 in N": accepts N (≥ 1) or a probability (< 1). */
const oneIn = (v: number | undefined) => (v === undefined || v <= 0 ? undefined : v < 1 ? 1 / v : v);

/** Normalises a parsed slot-facts.json; `missing` names the §3 measures it could not find. */
export function normaliseFacts(raw: unknown): { facts: SlotFactsN; missing: string[] } {
  const r = isObj(raw) ? raw : {};
  const n = (aliases: string[]) => num(find(r, aliases));
  const s = (aliases: string[]) => {
    const v = find(r, aliases);
    return typeof v === 'string' ? v : undefined;
  };
  const prob = (probAliases: string[], oneInAliases: string[]) => {
    const p = n(probAliases);
    if (p !== undefined && p > 0) return p <= 1 ? 1 / p : p > 100 ? p : undefined;
    return oneIn(n(oneInAliases));
  };
  const rawRtp = n(['rtp', 'rtpTotal', 'totalRtp']);
  const facts: SlotFactsN = {
    rtp: fraction(rawRtp),
    rtpTier: s(['rtpTier', 'tier']),
    // The SE is in the RTP's units: a percentage RTP (96.02) has a percentage SE (0.03).
    rtpSe: (() => {
      const se = n(['rtpSe', 'se', 'rtp_se']);
      return se === undefined ? undefined : rawRtp !== undefined && rawRtp > 1.5 ? se / 100 : se;
    })(),
    rtpN: n(['rtpN', 'n', 'nMc', 'n_mc']),
    hitRate: fraction(n(['hitRate', 'hit_rate', 'winFreq', 'win_freq', 'hitFrequency'])),
    winOverStake: fraction(n(['winOverStakeRate', 'winOverStake', 'winAboveStake', 'profitRate', 'winGtStake', 'pWinOverStake'])),
    sd: n(['volatilitySd', 'sd', 'stdDev', 'stddev', 'sdPerSpin', 'volatility']),
    measuredVolatility: s(['volatilityBand', 'measuredVolatility', 'volatility']),
    featureOneIn: prob(['featureP', 'pFeature', 'featureProbability', 'triggerP', 'trigger_p'], ['featureOneIn', 'featureFreq', 'featureFrequency', 'featureEvery']),
    featureShare: fraction(n(['featureShare', 'featureRtpShare', 'featureShareOfRtp'])),
    avgFeatureWin: n(['avgFeatureWin', 'featureAvgWin', 'meanFeatureWin', 'featureMeanWin', 'averageFeatureWin']),
    bigWinOneIn: prob(['pWin100', 'pBigWin', 'pWinGe100', 'p100x', 'bigWinP'], ['bigWinOneIn', 'win100OneIn', 'oneIn100x', 'win100xOneIn']),
    maxWin: n(['maxWinStakes', 'maxWin', 'maxMultiplier', 'maxWinCap']),
    maxWinOneIn: prob(['pMaxWin', 'maxWinP', 'pCap', 'maxWinProbability', 'pHitMaxWin'], ['maxWinOneIn', 'capOneIn']),
    dryStreakP95: n(['dryStreakP95', 'dryP95', 'longestDryP95', 'dryStreak95']),
    sessionMedian: n(['sessionMedian', 'medianBalance200', 'sessionMedianBalance', 'session200Median']),
  };
  const labels: [keyof SlotFactsN, string][] = [
    ['rtp', 'RTP'],
    ['hitRate', 'hit rate'],
    ['winOverStake', 'win > stake rate'],
    ['sd', 'volatility (SD)'],
    ['maxWin', 'max win'],
    ['maxWinOneIn', 'P(max win)'],
    ['dryStreakP95', 'dry streak p95'],
    ['bigWinOneIn', 'P(win ≥ 100×)'],
    ['sessionMedian', 'session median'],
  ];
  return { facts, missing: labels.filter(([k]) => facts[k] === undefined).map(([, l]) => l) };
}

/** What the game declares, from slot.config.json, the spec and the manifest. */
export interface Declared {
  volatility?: Volatility;
  /** 'free_spins', another feature kind, or null for a pure base game. */
  feature: string | null;
  maxWin?: number;
  evaluation?: string;
  cols?: number;
  rows?: number;
}

export interface BandRow {
  key: string;
  label: string;
  value: number | undefined;
  /** Shown as text, e.g. "31.2%". */
  shown: string;
  lo: number;
  hi: number;
  width: number;
  band: string;
  /** How far outside the band (0 inside). */
  miss: number;
  status: 'in' | 'out' | 'wide' | 'missing' | 'advisory';
  /** Some bands only inform the designer (no width cap). */
  advisory?: boolean;
}

const pct = (x: number | undefined, d = 1) => (x === undefined ? '—' : `${(x * 100).toFixed(d)}%`);
const fmtN = (x: number | undefined) => (x === undefined ? '—' : x >= 100 ? Math.round(x).toLocaleString('en-US') : x.toFixed(2).replace(/\.?0+$/, ''));

/** The hit-rate band for the mechanism (§3). */
export function hitRateBand(d: Declared): [number, number, string] {
  if (d.evaluation === 'cluster' || d.evaluation === 'scatter_pays') return [0.25, 0.45, 'cluster/scatter pays'];
  if (d.cols === 3 && d.rows === 3) return [0.1, 0.25, 'classic 3×3'];
  return [0.2, 0.45, 'general'];
}

/** Every §3 measure against its band. `wide` = missed by more than the band's width (caps maths fit). */
export function bandRows(f: SlotFactsN, d: Declared): BandRow[] {
  const rows: BandRow[] = [];
  const add = (key: string, label: string, value: number | undefined, shown: string, lo: number, hi: number, width: number, band: string, advisory = false) => {
    const miss = value === undefined ? 0 : value < lo ? lo - value : value > hi ? value - hi : 0;
    const status: BandRow['status'] = value === undefined ? 'missing' : advisory ? 'advisory' : miss === 0 ? 'in' : miss > width + 1e-12 ? 'wide' : 'out';
    rows.push({ key, label, value, shown, lo, hi, width, band, miss, status, advisory });
  };
  add('rtp', 'RTP', f.rtp, `${pct(f.rtp, 2)}${f.rtpTier ? ` ${f.rtpTier}` : ''}${f.rtpSe ? ` ± ${pct(f.rtpSe, 2)}` : ''}`, 0.955, 0.965, 0.01, '95.5–96.5%');
  const [hlo, hhi, hname] = hitRateBand(d);
  add('hitRate', 'Hit rate', f.hitRate, pct(f.hitRate), hlo, hhi, hhi - hlo, `${pct(hlo, 0)}–${pct(hhi, 0)} (${hname})`);
  add('winOverStake', 'Win > stake rate', f.winOverStake, pct(f.winOverStake), 0.08, 0.25, 0.17, '8–25%');
  if (d.volatility) {
    const [lo, hi] = VOLATILITY_BANDS[d.volatility];
    // The extreme band is open above; its width is taken as the high band's (10).
    add('sd', `Volatility (SD/spin) vs declared ${d.volatility}`, f.sd, f.sd === undefined ? '—' : `${f.sd.toFixed(1)}`, lo, hi, Number.isFinite(hi) ? hi - lo : 10, `${lo}–${Number.isFinite(hi) ? hi : '∞'}`);
  }
  if (d.feature) {
    const fs = d.feature === 'free_spins';
    const [lo, hi] = fs ? [80, 300] : [40, 120];
    add('featureOneIn', 'Feature frequency (1 in N)', f.featureOneIn, f.featureOneIn === undefined ? '—' : `1 in ${fmtN(f.featureOneIn)}`, lo, hi, hi - lo, `1 in ${lo}–${hi} (${fs ? 'free spins' : 'smaller feature'})`);
    add('featureShare', 'Feature share of RTP', f.featureShare, pct(f.featureShare), 0.25, 0.55, 0.3, '25–55%');
    add('avgFeatureWin', 'Average feature win', f.avgFeatureWin, f.avgFeatureWin === undefined ? '—' : `${fmtN(f.avgFeatureWin)}×`, 15, 150, 135, '15–150×');
  }
  if (d.volatility === 'low') add('bigWinOneIn', 'P(win ≥ 100×) per spin', f.bigWinOneIn, f.bigWinOneIn === undefined ? '—' : `1 in ${fmtN(f.bigWinOneIn)}`, 5000, Infinity, 0, '1 in 5,000+ (low)', true);
  else if (d.volatility === 'high' || d.volatility === 'extreme') add('bigWinOneIn', 'P(win ≥ 100×) per spin', f.bigWinOneIn, f.bigWinOneIn === undefined ? '—' : `1 in ${fmtN(f.bigWinOneIn)}`, 0, 1500, 0, '1 in 1,500 or more often (high)', true);
  else add('bigWinOneIn', 'P(win ≥ 100×) per spin', f.bigWinOneIn, f.bigWinOneIn === undefined ? '—' : `1 in ${fmtN(f.bigWinOneIn)}`, 0, Infinity, 0, 'between the low and high guides', true);
  const maxWin = f.maxWin ?? d.maxWin;
  add('maxWin', 'Max win (cap)', maxWin, maxWin === undefined ? '—' : `${fmtN(maxWin)}×`, 1000, 25000, 24000, '1,000–25,000×');
  // Reachability: P(cap) > 1 in 10^9, as "1 in N" ≤ 10^9. One-sided; width taken as the bound.
  add('maxWinOneIn', 'P(max win) per spin', f.maxWinOneIn, f.maxWinOneIn === undefined ? '—' : `1 in ${f.maxWinOneIn.toExponential(2)}`, 0, 1e9, 1e9, '> 1 in 10⁹');
  // One-sided, by the declared volatility (§3); width taken as the bound (a p95 over twice the limit caps maths fit).
  if (d.volatility) {
    const max = DRY_STREAK_MAX[d.volatility];
    add('dryStreakP95', 'Dry streak p95 (per 100 spins)', f.dryStreakP95, fmtN(f.dryStreakP95), 0, max, max, `≤ ${max} (${d.volatility})`);
  } else {
    rows.push({ key: 'dryStreakP95', label: 'Dry streak p95 (per 100 spins)', value: f.dryStreakP95, shown: fmtN(f.dryStreakP95), lo: 0, hi: Infinity, width: 0, band: 'set by the declared volatility, and none is declared', miss: 0, status: 'missing' });
  }
  rows.push({ key: 'sessionMedian', label: 'Session median (200 spins from 100)', value: f.sessionMedian, shown: fmtN(f.sessionMedian), lo: -Infinity, hi: Infinity, width: 0, band: 'no band (how it feels)', miss: 0, status: f.sessionMedian === undefined ? 'missing' : 'advisory', advisory: true });
  return rows;
}

/** The §3 misses that cap maths fit at 2: any band missed by more than its width. */
export const wideMisses = (rows: BandRow[]) => rows.filter((r) => r.status === 'wide').map((r) => `${r.label} ${r.shown} vs ${r.band}`);

/** The gated facts (§5): hit rate in band, dry streak p95 within its volatility's limit, max win reachable. Missing measures fail. */
export function factGateFailures(rows: BandRow[]): string[] {
  const out: string[] = [];
  for (const key of ['hitRate', 'dryStreakP95', 'maxWinOneIn'] as const) {
    const r = rows.find((x) => x.key === key);
    if (r && r.status === 'missing' && r.value !== undefined) out.push(`${r.label} ${r.shown}: no declared volatility to judge it by (set volatility in slot.config.json)`);
    else if (!r || r.status === 'missing') out.push(`${r?.label ?? key} not measured (rerun npm run slots:eval)`);
    else if (r.status !== 'in') out.push(`${r.label} ${r.shown} outside ${r.band}`);
  }
  return out;
}

/** The band table for prompts. */
export function bandTable(rows: BandRow[]): string {
  const mark = { in: 'in band', out: 'OUT of band', wide: 'OUT by more than the band width', missing: 'not measured', advisory: 'guide only' } as const;
  return ['| Measure | Value | Healthy band | Status |', '|---|---|---|---|', ...rows.map((r) => `| ${r.label} | ${r.shown} | ${r.band} | ${mark[r.status]} |`)].join('\n');
}
