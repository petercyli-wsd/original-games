// Tolerant readers for the two optional JSON files a slot game may ship
// (see the note at the top of registry.ts). Both accept missing or oddly
// typed fields and keep only what is present and sane.

import { formatPercent, type GameManifest } from '@originals/game-sdk';

export interface SlotFacts {
  /** RTP as a fraction (0.96). */
  rtp: number;
  /** 'exact' / 'exact_mixture', or 'mc' with a standard error. */
  rtpTier?: string;
  rtpSe?: number;
  hitRate?: number;
  /** Volatility word (low / medium / high / extreme). */
  volatility: string;
  /** Standard deviation of the win per spin, in stakes. */
  volatilitySd?: number;
  maxWin: number;
  /** The feature comes once in N spins. */
  featureFreq?: number;
  /** Fraction of the RTP that comes from the feature. */
  featureShare?: number;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
/** A fraction, or a percentage written as 96 / 96.0. */
const fraction = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : n > 1.5 ? n / 100 : n;
};

/** Slot facts: the manifest's numbers, overridden by whatever slot-facts.json provides. */
export function readSlotFacts(manifest: GameManifest, raw?: unknown): SlotFacts {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rtp = fraction(f.rtp) ?? manifest.rtp;
  // featureFrequency may be given as 1-in-N (>1) or as a per-spin probability (<1).
  const ff = num(f.featureFreq ?? f.featureFrequency ?? f.featureOneIn);
  const sdOrWord = f.volatility;
  return {
    rtp,
    rtpTier: str(f.rtpTier ?? f.tier),
    rtpSe: num(f.rtpSe ?? f.se),
    hitRate: fraction(f.hitRate),
    volatility: str(sdOrWord) ?? manifest.volatility[manifest.volatility.length - 1],
    volatilitySd: num(f.volatilitySd ?? f.sd) ?? num(sdOrWord),
    maxWin: num(f.maxWin ?? f.maxMultiplier) ?? manifest.maxMultiplier,
    featureFreq: ff === undefined ? undefined : ff > 0 && ff < 1 ? 1 / ff : ff,
    featureShare: fraction(f.featureShare ?? f.featureRtpShare),
  };
}

/** "96.0% · High · 5,000×" for a tile. */
export function slotFactsLine(facts: SlotFacts): string {
  const vol = facts.volatility.charAt(0).toUpperCase() + facts.volatility.slice(1);
  return [formatPercent(facts.rtp), vol, `${facts.maxWin.toLocaleString('en-US')}×`].join(' · ');
}

/** "96.00% exact" or "96.02% ± 0.03% mc". */
export function rtpWithTier(facts: SlotFacts): string {
  const tier = facts.rtpTier ?? 'exact';
  const se = facts.rtpSe !== undefined ? ` ± ${formatPercent(facts.rtpSe, 2)}` : '';
  return `${formatPercent(facts.rtp, 2)}${se} ${tier.replace('_', ' ')}`;
}

export interface SlotReview {
  overall?: number;
  scores: [string, number][];
  verdict?: string;
  gate?: boolean;
}

/** Reads slot-review.json; null when nothing usable is present. */
export function readSlotReview(raw: unknown): SlotReview | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const scores =
    r.scores && typeof r.scores === 'object'
      ? Object.entries(r.scores as Record<string, unknown>).flatMap(([k, v]) => (num(v) !== undefined ? [[k, v as number] as [string, number]] : []))
      : [];
  const review: SlotReview = {
    overall: num(r.overall),
    scores,
    verdict: str(r.verdict),
    gate: typeof r.gate === 'boolean' ? r.gate : undefined,
  };
  return review.overall === undefined && !scores.length && !review.verdict && review.gate === undefined ? null : review;
}
