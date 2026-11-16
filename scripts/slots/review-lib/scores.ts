// The slot review's scores, weights, caps and gate (docs/SLOTS.md §5).
// Pure functions: the CLI (scripts/slots/review.ts) feeds them the merged
// blind-player scores, the designer's scores and the measured facts, and
// writes the result to games/<id>/src/slot-review.json.

/** Bump when a prompt, a weight, a cap or the gate changes: every review under an older version shows as stale in `todo`. */
export const SLOT_REVIEW_VERSION = 1;

export const PLAYER_KEYS = ['theme', 'readability', 'feature_clarity', 'excitement', 'fun'] as const;
export const DESIGNER_KEYS = ['creativity', 'maths_fit', 'uniqueness', 'polish'] as const;
export type PlayerKey = (typeof PLAYER_KEYS)[number];
export type DesignerKey = (typeof DESIGNER_KEYS)[number];
export type ScoreKey = PlayerKey | DesignerKey;
export const SCORE_KEYS: readonly ScoreKey[] = [...PLAYER_KEYS, ...DESIGNER_KEYS];

/** §5 weights. Why each: docs/SLOT-EVALUATOR.md. */
export const WEIGHTS: Record<ScoreKey, number> = {
  fun: 3,
  excitement: 2,
  theme: 2,
  readability: 2,
  creativity: 2,
  maths_fit: 2,
  feature_clarity: 1.5,
  uniqueness: 1.5,
  polish: 1,
};

export const GATE = {
  overall: 3.5,
  readability: 3,
  featureClarity: 3,
  rtp: [0.955, 0.965] as const,
} as const;

/** A panel of 3 blind players is needed when the overall lands here (inclusive at both ends). */
export const PANEL_BAND = [3.25, 3.75] as const;
export const PANEL_SIZE = 3;

/** The comprehension grades, worst first. */
export const COMPREHENSION = ['misread', 'partial', 'correct'] as const;
export type Comprehension = (typeof COMPREHENSION)[number];
/** A misread caps readability and feature clarity at this. */
export const MISREAD_CAP = 2;
/** A maths fit with a §3 band missed by more than its width is capped at this. */
export const MATHS_FIT_CAP = 2;

/** The median of a panel's scores; an even panel takes the lower one (the stricter). */
export const lowerMedian = (xs: number[]): number => {
  if (!xs.length) throw new Error('lowerMedian of nothing');
  return [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];
};

/** The panel's comprehension: the median grade, ties going to the stricter one. */
export function medianGrade(grades: Comprehension[]): Comprehension {
  if (!grades.length) return 'correct';
  return COMPREHENSION[lowerMedian(grades.map((g) => COMPREHENSION.indexOf(g)))];
}

/** The readability cap on the overall: one point of readability is worth 0.75 of the overall, from 1.5. */
export const readabilityCap = (readability: number) => 1.5 + 0.75 * readability;

export interface ScoreInput {
  /** The blind players' scores, merged (median per key). */
  player: Record<PlayerKey, number>;
  /** The designer's scores. */
  designer: Record<DesignerKey, number>;
  /** The panel's comprehension grade (the designer's grades, merged). */
  comprehension: Comprehension;
  /** §3 bands missed by more than their width (labels); any one caps maths fit. */
  wideMisses: string[];
  /** False for a pure base game: feature clarity then carries no weight and isn't gated. */
  hasFeature: boolean;
}

export interface Scored {
  /** The scores after caps (feature_clarity omitted for a game with no feature). */
  scores: Partial<Record<ScoreKey, number>>;
  /** The weighted mean before the readability cap. */
  mean: number;
  /** The overall: the weighted mean, capped by readability, to 2 decimals. */
  overall: number;
  /** Each cap that bit, in words. */
  caps: string[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** The overall in code, exactly as in §5. */
export function scoreSlot(input: ScoreInput): Scored {
  const scores: Partial<Record<ScoreKey, number>> = { ...input.player, ...input.designer };
  const caps: string[] = [];
  if (input.comprehension === 'misread') {
    for (const k of ['readability', 'feature_clarity'] as const) {
      if ((scores[k] ?? 0) > MISREAD_CAP) {
        caps.push(`${k} ${scores[k]} → ${MISREAD_CAP}: the blind player misread the game`);
        scores[k] = MISREAD_CAP;
      }
    }
  }
  if (input.wideMisses.length && (scores.maths_fit ?? 0) > MATHS_FIT_CAP) {
    caps.push(`maths_fit ${scores.maths_fit} → ${MATHS_FIT_CAP}: ${input.wideMisses.join('; ')} (a §3 band missed by more than its width)`);
    scores.maths_fit = MATHS_FIT_CAP;
  }
  if (!input.hasFeature) delete scores.feature_clarity;
  let num = 0;
  let den = 0;
  for (const k of SCORE_KEYS) {
    const s = scores[k];
    if (s === undefined) continue;
    num += WEIGHTS[k] * s;
    den += WEIGHTS[k];
  }
  const mean = num / den;
  const cap = readabilityCap(scores.readability ?? 1);
  if (mean > cap) caps.push(`overall ${mean.toFixed(2)} → ${cap.toFixed(2)}: readability ${scores.readability} caps the overall at 1.5 + 0.75 × readability`);
  return { scores, mean: round2(mean), overall: round2(Math.min(mean, cap)), caps };
}

export interface GateInput {
  overall: number;
  scores: Partial<Record<ScoreKey, number>>;
  hasFeature: boolean;
  /** The oracle file is present and parses. */
  oraclePresent: boolean;
  /** The game's RTP (fraction) and where it came from, or null when unknown. */
  rtp: number | null;
  /** Why the gated §3 facts fail (hit rate, dry streak p95, max-win reachability); empty when they pass. */
  factFailures: string[];
  /** Catalogue slots this one reskins (code twins + the designer's duplicate_of); empty when none. */
  reskinOf: string[];
  /** Blind plays merged into the review. */
  players: number;
  /** Trademarked mechanic names the slot uses (code scan + designer), e.g. "Megaways in Game.tsx" (§4). */
  trademarks?: string[];
}

export function panelNeeded(overall: number, players: number): boolean {
  return players < PANEL_SIZE && overall >= PANEL_BAND[0] && overall <= PANEL_BAND[1];
}

/** The keep gate (§5). Returns the reasons it fails; empty means pass. */
export function gateReasons(g: GateInput): string[] {
  const r: string[] = [];
  if (g.overall < GATE.overall) r.push(`overall ${g.overall.toFixed(2)} < ${GATE.overall}`);
  if ((g.scores.readability ?? 0) < GATE.readability) r.push(`readability ${g.scores.readability ?? '—'} < ${GATE.readability}`);
  if (g.hasFeature && (g.scores.feature_clarity ?? 0) < GATE.featureClarity) r.push(`feature clarity ${g.scores.feature_clarity ?? '—'} < ${GATE.featureClarity}`);
  if (!g.oraclePresent) r.push('no oracle.json (run npm run slots:oracle)');
  if (g.rtp == null) r.push('RTP unknown (no RTP in slot-facts.json or oracle.json)');
  else if (g.rtp < GATE.rtp[0] - 1e-12 || g.rtp > GATE.rtp[1] + 1e-12) r.push(`RTP ${(g.rtp * 100).toFixed(2)}% outside 95.5–96.5%`);
  r.push(...g.factFailures);
  if (g.reskinOf.length) r.push(`reskin of ${g.reskinOf.join(', ')}`);
  if (g.trademarks?.length) r.push(`trademarked mechanic name: ${g.trademarks.join('; ')}`);
  if (panelNeeded(g.overall, g.players)) r.push(`panel needed: overall ${g.overall.toFixed(2)} is in ${PANEL_BAND[0]}–${PANEL_BAND[1]} with ${g.players} blind player(s); run ${PANEL_SIZE - g.players} more`);
  return r;
}
