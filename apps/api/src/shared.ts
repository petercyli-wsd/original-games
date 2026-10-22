// Types and helpers shared by the ratings API and the platform client.
// Keep this file free of imports so both can use it directly.

// ---------------------------------------------------------------------------
// Facets: the criteria every game is ranked on, by humans and by the AI
// ---------------------------------------------------------------------------

export const CRITERION_KEYS = [
  'odds_legibility',
  'win_clarity',
  'simplicity',
  'uniqueness',
  'volatility_control',
  'checkpoints',
  'pace',
  'fun',
  'geometry_first',
] as const;
export type CriterionKey = (typeof CRITERION_KEYS)[number];

/** Short labels and the question a human reviewer answers, in display order. */
export const FACETS: { key: CriterionKey; label: string; question: string }[] = [
  { key: 'pace', label: 'Pace', question: 'Can it be played both fast (turbo/auto) and slowly, step by step?' },
  { key: 'volatility_control', label: 'Volatility control', question: 'Can you choose your risk, with a control that really changes it?' },
  { key: 'win_clarity', label: 'Win condition', question: 'Is it obvious what wins and what loses?' },
  { key: 'odds_legibility', label: 'Odds clarity', question: 'Can you see your chance of winning on the board as the round plays out?' },
  { key: 'checkpoints', label: 'Checkpoints', question: 'Are there natural pauses where cashing out is a real decision?' },
  { key: 'simplicity', label: 'Simplicity', question: 'Could a new player explain it in one sentence?' },
  { key: 'uniqueness', label: 'Uniqueness', question: 'Is it more than a reskin of an existing game?' },
  { key: 'fun', label: 'Fun', question: 'Does it build tension and make you want another round?' },
  { key: 'geometry_first', label: 'Geometry-first', question: 'Does it work as plain shapes, without its theme?' },
];

export type FacetScores = Partial<Record<CriterionKey, number>>;

// ---------------------------------------------------------------------------
// Human ratings and reviews
// ---------------------------------------------------------------------------

export const MAX_COMMENT_LENGTH = 2000;
export const MAX_REVIEWER_LENGTH = 40;

export interface RatingSummary {
  /** Mean stars, 0 when unrated. */
  average: number;
  count: number;
}

/** A summary plus this voter's own stars, when the request names a voter. */
export interface RatingRow extends RatingSummary {
  mine?: number | null;
  /** Team averages per facet, for facets anyone has scored. */
  facets?: Partial<Record<CriterionKey, RatingSummary>>;
}

/**
 * Ranking score: the average pulled toward 3 stars by two phantom votes, so a
 * single 5-star rating doesn't outrank a game with many 4.5s.
 */
export function rankScore({ average, count }: RatingSummary): number {
  const PRIOR_MEAN = 3;
  const PRIOR_VOTES = 2;
  return (average * count + PRIOR_MEAN * PRIOR_VOTES) / (count + PRIOR_VOTES);
}

export interface Review {
  stars: number;
  comment: string;
  reviewer: string;
  /** Optional 1-5 scores per facet. */
  facets: FacetScores;
  updatedAt: string;
}

export interface RatingDetail extends RatingSummary {
  /** Number of 1..5 star ratings; index 0 is 1 star. */
  distribution: number[];
  /** Team averages per facet. */
  facets: Partial<Record<CriterionKey, RatingSummary>>;
  /** This voter's stars, or null if they haven't rated the game. */
  mine: number | null;
  /** This voter's full review, if any. */
  myReview: Review | null;
  /** Reviews with a written comment, newest first. */
  reviews: Review[];
}

export interface RatingInput {
  voterId: string;
  stars: number;
  /** Omit to keep the existing comment (quick star-only votes). */
  comment?: string;
  reviewer?: string;
  /** Omit to keep existing facet scores; send {} to clear them. */
  facets?: FacetScores;
}

/** Averages each facet over the reviews that scored it. */
export function facetAverages(all: FacetScores[]): Partial<Record<CriterionKey, RatingSummary>> {
  const out: Partial<Record<CriterionKey, RatingSummary>> = {};
  for (const key of CRITERION_KEYS) {
    const scores = all.map((f) => f[key]).filter((s): s is number => typeof s === 'number');
    if (scores.length) out[key] = { average: scores.reduce((a, b) => a + b, 0) / scores.length, count: scores.length };
  }
  return out;
}

export function summarize(distribution: number[]): RatingSummary {
  let count = 0;
  let total = 0;
  distribution.forEach((n, i) => {
    count += n;
    total += n * (i + 1);
  });
  return { average: count ? total / count : 0, count };
}

// ---------------------------------------------------------------------------
// AI evaluator
// ---------------------------------------------------------------------------

export interface CriterionDef {
  key: CriterionKey;
  name: string;
  question: string;
  /** Relative weight in the overall score. */
  weight: number;
  /** What a 1, a 3 and a 5 look like; 2 and 4 sit between. */
  descriptors: { 1: string; 3: string; 5: string };
}

export interface Exemplar {
  gameId: string;
  /** Why this game is a useful reference, written by the refiner. */
  note: string;
}

/** One version of the evaluator's prompt. Only one is active at a time. */
export interface PromptVersion {
  id: number;
  parentId: number | null;
  status: 'active' | 'candidate' | 'retired';
  createdAt: string;
  criteria: CriterionDef[];
  /** Lessons learned from human reviews, kept short. */
  guidance: string;
  exemplars: Exemplar[];
  changelog: string;
  metrics: BacktestMetrics | null;
}

export interface AgreementStats {
  games: number;
  /** Rank agreement with human averages, -1..1; null with under 3 games. */
  spearman: number | null;
  /** Mean absolute gap to the human average, in stars. */
  mae: number | null;
}

export interface BacktestMetrics {
  ranAt: string;
  /** Games with human reviews that were scored (train and holdout). */
  humanGames: number;
  spearman: number | null;
  mae: number | null;
  /**
   * Agreement on held-out games: their reviews never reach the refiner, so
   * this is the honest number to compare versions on.
   */
  holdout: AgreementStats;
  anchorsPassed: number;
  anchorsTotal: number;
  anchorFailures: string[];
}

/** A factual summary of a game, extracted from its code once per code version. */
export interface RulesCard {
  concept: string;
  win_condition: string;
  odds_display: string;
  volatility_controls: string;
  checkpoints: string;
  round_flow: string;
  maths_family: string;
  dynamics: ('ladder' | 'martingale' | 'staged-reveal' | 'choice' | 'other')[];
  theme_dependence: string;
  closest_known_games: string[];
}

/** A deterministic check computed from the manifest and Monte Carlo evals. */
export interface MeasuredCheck {
  key: 'rtp' | 'volatility_spread' | 'round_length' | 'checkpoints';
  label: string;
  pass: boolean;
  detail: string;
}

export interface CriterionScore {
  key: CriterionKey;
  score: number;
  reasoning: string;
}

export interface Evaluation {
  id: number;
  gameId: string;
  versionId: number;
  codeHash: string;
  /** Weighted mean of the criterion scores, 1..5. */
  overall: number;
  criteria: CriterionScore[];
  recommendation: 'ship' | 'iterate' | 'drop';
  verdict: string;
  pros: string[];
  cons: string[];
  /** Catalogue id of a game this is essentially a reskin of, or ''. */
  duplicateOf: string;
  closestExisting: string;
  checks: MeasuredCheck[];
  model: string;
  createdAt: string;
}

export interface EvaluationView extends Evaluation {
  rulesCard: RulesCard | null;
  /** True when the game's code changed after this review. */
  stale: boolean;
}

export interface EvaluationSummary {
  overall: number;
  /** The code version that was reviewed; tools compare it with local code. */
  codeHash: string;
  recommendation: Evaluation['recommendation'];
  /** The AI's 1-5 score per facet, for ranking by facet. */
  facets: Record<CriterionKey, number>;
  stale: boolean;
  createdAt: string;
}

export interface Job {
  id: string;
  kind: 'evaluate' | 'refine' | 'backtest';
  label: string;
  status: 'running' | 'done' | 'error';
  total: number;
  done: number;
  failed: number;
  errors: string[];
  startedAt: string;
  finishedAt: string | null;
  /** e.g. the candidate version id created by a refine job. */
  result: unknown;
}

export interface EvaluatorStatus {
  /** An Anthropic key is configured, so reviews can run. */
  aiEnabled: boolean;
  /** ADMIN_KEY is set, so admin actions are possible at all. */
  adminConfigured: boolean;
  model: string;
  evidenceGames: number;
  activeVersion: PromptVersion | null;
}

export interface AgreementRow {
  gameId: string;
  humanAverage: number;
  humanCount: number;
  aiOverall: number | null;
}

/**
 * Deterministic train/holdout split of reviewed games (about 30% holdout).
 * The refiner learns only from train games; holdout games measure whether a
 * prompt change generalises instead of memorising the reviews it was shown.
 */
export function isHoldout(gameId: string): boolean {
  let h = 2166136261;
  for (let i = 0; i < gameId.length; i++) h = Math.imul(h ^ gameId.charCodeAt(i), 16777619);
  return (h >>> 0) % 10 < 3;
}

/** Weighted mean of criterion scores under a version's weights, 1..5. */
export function overallScore(scores: CriterionScore[], criteria: CriterionDef[]): number {
  let total = 0;
  let weights = 0;
  for (const c of criteria) {
    const s = scores.find((x) => x.key === c.key);
    if (!s || c.weight <= 0) continue;
    total += s.score * c.weight;
    weights += c.weight;
  }
  return weights ? total / weights : 0;
}
