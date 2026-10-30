// Orchestrates the evaluator: rules cards, judging, prompt refinement and
// backtests. Judging can happen here (in-app, billed API, behind a flag) or in
// a Claude Code session (subscription), which fetches prompts from this
// service and imports the results; both store reviews the same way.
//
// Calibration strategy (see README):
// - The rubric's 1/3/5 descriptions are the main calibration device.
// - Each game sees at most MAX_REFERENCES team-reviewed games, never itself:
//   the team's highest and lowest rated (scale pins), the refiner's curated
//   exemplars, then the most similar reviewed games.
// - Reviewed games are split train/holdout; the refiner sees train games only,
//   and versions are compared on holdout agreement plus fixed anchors.

import { randomUUID } from 'node:crypto';
import {
  CRITERION_KEYS,
  DEAD_STRUCTURE,
  criteriaFor,
  isHoldout,
  overallScore,
  weightedFacets,
  weightedSummary,
  type AgreementRow,
  type AgreementStats,
  type BacktestMetrics,
  type CriterionDef,
  type CriterionKey,
  type CriterionScore,
  type DeadStructure,
  type Evaluation,
  type EvaluationSummary,
  type EvaluationView,
  type EvaluatorStatus,
  type Job,
  type MeasuredCheck,
  type PromptVersion,
  type RatingSummary,
  type Review,
  type RulesCard,
} from '../shared.js';
import type { EvalStore, RatingsStore } from '../store.js';
import { ANCHORS, type Anchor } from './anchors.js';
import { evalTable, measuredChecks, type EvidenceIndex, type GameEvidence } from './evidence.js';
import type { Llm } from './llm.js';
import {
  EXTRACT_SYSTEM,
  CLASSIC_STANDING,
  JUDGE_SCHEMA,
  judgeSchema,
  PLAYER_ODDS_SOURCES,
  PLAYER_OUTCOMES,
  playerSchema,
  playerSystem,
  playerUser,
  PROTOTYPE_STANDING,
  REFINE_SCHEMA,
  REFINE_SYSTEM,
  RULES_CARD_SCHEMA,
  extractUser,
  judgeSystem,
  judgeUser,
  refineUser,
  type ExemplarContext,
} from './prompts.js';
import { DEFAULT_CRITERIA, DEFAULT_GUIDANCE } from './rubric.js';
import { fitWeights, meanAbsError, spearman } from './stats.js';

export class EvaluatorError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface EvaluatorDeps {
  llm: Llm | null;
  evals: EvalStore;
  ratings: RatingsStore;
  evidence: EvidenceIndex;
  /** Parallel Claude calls inside a job. */
  concurrency?: number;
  /** Most-reviewed games used to backtest a prompt version. */
  calibrationSize?: number;
}

export interface JudgeOutput {
  criteria: { key: CriterionKey; reasoning: string; score: number }[];
  pros: string[];
  cons: string[];
  closest_existing: string;
  duplicate_of: string;
  verdict: string;
  recommendation: Evaluation['recommendation'];
}

export interface RefineOutput {
  changelog: string;
  guidance: string;
  criteria: { key: CriterionKey; weight: number; descriptor_1: string; descriptor_3: string; descriptor_5: string }[];
  exemplars: { gameId: string; note: string }[];
}

/** Which reviewed games may serve as references: all (live reviews) or train only (backtests). */
export type ReferencePool = 'all' | 'train';

interface Subject {
  id: string;
  name: string;
  mechanic: string;
  /** Whether the judge is told this is a proven classic or a prototype. */
  standing: string;
  card: RulesCard;
  facts: string;
  table: string;
}

const MIN_TRAIN_FOR_REFINE = 3;
/** The core Originals every scoring system must rate highly. */
const CORE_CLASSICS = ['dice', 'limbo', 'crash', 'mines', 'plinko', 'keno'];
const CORE_MIN = 4;
const CLASSICS_MEAN_MIN = 3.8;
/** A game the team scored at or below TEAM_LOW must not get more than AI_LOW_MAX. */
const TEAM_LOW = 2.5;
const AI_LOW_MAX = 3;
const MAX_REFERENCES = 6;
// Below this many reviewed games there's no real team scale to calibrate
// against (and early ratings are often tests), so the rubric judges alone.
const MIN_REFERENCE_POOL = 3;
const MAX_CURATED = 4;
const MAX_GUIDANCE_CHARS = 3000;
const RECOMMENDATIONS = ['ship', 'iterate', 'drop'] as const;

const checksText = (checks: MeasuredCheck[]) => checks.map((c) => `- ${c.pass ? 'PASS' : 'FAIL'} ${c.label}: ${c.detail}`).join('\n');

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function parseScores(criteria: unknown, keys: readonly CriterionKey[], who: string): CriterionScore[] {
  if (!Array.isArray(criteria)) throw new EvaluatorError(400, `The ${who} has no criteria array.`);
  return keys.map((key) => {
    const c = (criteria as { key?: string; score?: number; reasoning?: string }[]).find((x) => x?.key === key);
    if (!c || !Number.isInteger(c.score) || c.score! < 1 || c.score! > 5) throw new EvaluatorError(400, `The ${who} is missing a valid 1-5 score for ${key}.`);
    return { key, score: c.score!, reasoning: typeof c.reasoning === 'string' ? c.reasoning : '' };
  });
}

/** What the blind player judge returns. */
export interface PlayerOutput {
  first_impression: string;
  understanding: { win_condition: string; how_it_works: string; odds: string; settings: string; confidence: string };
  /** Factual answers that cap the player's scores (absent before rubric v4). */
  checks?: { outcome: string; known_casino_game: boolean; odds_source: string; reasoning: string };
  criteria: { key: CriterionKey; reasoning: string; score: number }[];
  confusions: string[];
}

/**
 * Score limits from the blind player's checks. The team rated every game decided
 * by a pattern or a hidden state (rather than a draw you watch) 1-2 on win
 * condition and odds, however clearly an AI could follow it, unless it was a
 * casino game players already know.
 */
export function playerCaps(checks: PlayerOutput['checks']): Partial<Record<CriterionKey, { cap: number; why: string }>> {
  const caps: Partial<Record<CriterionKey, { cap: number; why: string }>> = {};
  if (!checks) return caps;
  const limit = (key: CriterionKey, cap: number, why: string) => {
    if (!caps[key] || caps[key]!.cap > cap) caps[key] = { cap, why };
  };
  if (checks.outcome !== 'direct' && !checks.known_casino_game) {
    const why = `the result is decided by ${checks.outcome === 'hidden' ? 'a hidden state the player only sees clues about' : 'a pattern the player has to check'}, not a draw they watch, and it is not a known casino game`;
    limit('win_clarity', 2, why);
    limit('odds_legibility', 2, why);
    limit('simplicity', 3, why);
  }
  if (checks.odds_source === 'unclear') limit('odds_legibility', 2, 'the player could not tell what their chances were');
  if (checks.odds_source === 'trust') limit('odds_legibility', 4, 'the chance is shown as a number the player has to take on trust');
  return caps;
}

/** Validates a blind player review for the given player criteria. */
export function parsePlayer(raw: unknown, keys: readonly CriterionKey[]): PlayerOutput & { scores: CriterionScore[] } {
  const r = raw as Partial<PlayerOutput> | null;
  if (!r || typeof r !== 'object') throw new EvaluatorError(400, 'The player review is not an object.');
  const u = r.understanding as Partial<PlayerOutput['understanding']> | undefined;
  if (!u || typeof u.win_condition !== 'string' || typeof u.how_it_works !== 'string') {
    throw new EvaluatorError(400, 'The player review must say what the player understood (understanding.win_condition and how_it_works).');
  }
  return {
    first_impression: typeof r.first_impression === 'string' ? r.first_impression : '',
    understanding: {
      win_condition: u.win_condition,
      how_it_works: u.how_it_works,
      odds: typeof u.odds === 'string' ? u.odds : '',
      settings: typeof u.settings === 'string' ? u.settings : '',
      confidence: typeof u.confidence === 'string' ? u.confidence : '',
    },
    checks: parseChecks(r.checks),
    criteria: (r.criteria ?? []) as PlayerOutput['criteria'],
    confusions: isStringArray(r.confusions) ? r.confusions : [],
    scores: parseScores(r.criteria, keys, 'player review'),
  };
}

function parseChecks(raw: unknown): PlayerOutput['checks'] {
  if (raw === undefined) return undefined;
  const c = raw as Partial<NonNullable<PlayerOutput['checks']>> | null;
  if (!c || !PLAYER_OUTCOMES.includes(c.outcome as string) || typeof c.known_casino_game !== 'boolean' || !PLAYER_ODDS_SOURCES.includes(c.odds_source as string)) {
    throw new EvaluatorError(400, `The player's checks must give outcome (${PLAYER_OUTCOMES.join('/')}), known_casino_game (true/false) and odds_source (${PLAYER_ODDS_SOURCES.join('/')}).`);
  }
  return { outcome: c.outcome!, known_casino_game: c.known_casino_game, odds_source: c.odds_source!, reasoning: typeof c.reasoning === 'string' ? c.reasoning : '' };
}

/** The player's understanding as the designer judge sees it. */
export function playerSummary(p: PlayerOutput): string {
  return [
    `- First impression: ${p.first_impression}`,
    `- What wins: ${p.understanding.win_condition}`,
    `- How it works: ${p.understanding.how_it_works}`,
    `- Odds as they read them: ${p.understanding.odds}`,
    `- Settings: ${p.understanding.settings}`,
    `- Confidence: ${p.understanding.confidence}`,
    p.checks ? `- Checks: outcome ${p.checks.outcome}; known casino game: ${p.checks.known_casino_game ? 'yes' : 'no'}; odds ${p.checks.odds_source}` : '',
    p.confusions.length ? `- Confusions: ${p.confusions.join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Validates a judge result from Claude or an import; throws on anything malformed. */
export function parseJudge(
  raw: unknown,
  keys: readonly CriterionKey[] = CRITERION_KEYS,
): JudgeOutput & { scores: CriterionScore[]; comprehension: string; comprehensionReasoning: string; deadStructure: DeadStructure; deadStructureReasoning: string } {
  const r = raw as (Partial<JudgeOutput> & { player_comprehension?: string; comprehension_reasoning?: string; dead_structure?: string; dead_structure_reasoning?: string }) | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.criteria)) throw new EvaluatorError(400, 'The review has no criteria array.');
  const scores: CriterionScore[] = keys.map((key) => {
    const c = r.criteria!.find((x) => x?.key === key);
    if (!c || !Number.isInteger(c.score) || c.score < 1 || c.score > 5) throw new EvaluatorError(400, `The review is missing a valid 1-5 score for ${key}.`);
    return { key, score: c.score, reasoning: typeof c.reasoning === 'string' ? c.reasoning : '' };
  });
  if (!isStringArray(r.pros) || !isStringArray(r.cons)) throw new EvaluatorError(400, 'pros and cons must be arrays of strings.');
  if (!RECOMMENDATIONS.includes(r.recommendation as never)) throw new EvaluatorError(400, 'recommendation must be ship, iterate or drop.');
  return {
    criteria: r.criteria as JudgeOutput['criteria'],
    scores,
    pros: r.pros,
    cons: r.cons,
    closest_existing: typeof r.closest_existing === 'string' ? r.closest_existing : '',
    duplicate_of: typeof r.duplicate_of === 'string' ? r.duplicate_of : '',
    verdict: typeof r.verdict === 'string' ? r.verdict : '',
    recommendation: r.recommendation as JudgeOutput['recommendation'],
    comprehension: ['correct', 'partial', 'wrong'].includes(r.player_comprehension ?? '') ? r.player_comprehension! : '',
    comprehensionReasoning: typeof r.comprehension_reasoning === 'string' ? r.comprehension_reasoning : '',
    // Reviews from before the check have no answer: no cap.
    deadStructure: DEAD_STRUCTURE.includes(r.dead_structure as DeadStructure) ? (r.dead_structure as DeadStructure) : 'none',
    deadStructureReasoning: typeof r.dead_structure_reasoning === 'string' ? r.dead_structure_reasoning : '',
  };
}

/** The highest win-condition and simplicity score a player's comprehension allows. */
const COMPREHENSION_CAP: Record<string, number> = { correct: 5, partial: 3, wrong: 2 };
/** The highest fun score a board with dead structure allows: watching what doesn't matter isn't tense. */
const DEAD_STRUCTURE_FUN_CAP: Record<DeadStructure, number> = { none: 5, some: 3, most: 2 };

function parseCard(raw: unknown): RulesCard {
  const c = raw as Partial<RulesCard> | null;
  const fields = ['concept', 'win_condition', 'odds_display', 'volatility_controls', 'checkpoints', 'round_flow', 'maths_family', 'theme_dependence'] as const;
  if (!c || typeof c !== 'object' || fields.some((f) => typeof c[f] !== 'string') || !isStringArray(c.dynamics) || !isStringArray(c.closest_known_games)) {
    throw new EvaluatorError(400, 'The rules card is missing fields; it must match the rules card schema.');
  }
  return c as RulesCard;
}

/** How alike two games are, for picking similar references. */
function similarity(a: { mechanic: string; card: RulesCard | null }, b: { mechanic: string; card: RulesCard | null }): number {
  let s = a.mechanic && a.mechanic === b.mechanic ? 2 : 0;
  if (a.card && b.card) {
    s += a.card.dynamics.filter((d) => d !== 'other' && b.card!.dynamics.includes(d)).length;
    const known = new Set(b.card.closest_known_games.map((g) => g.toLowerCase()));
    s += a.card.closest_known_games.filter((g) => known.has(g.toLowerCase())).length;
  }
  return s;
}

export function createEvaluator({ llm, evals, ratings, evidence, concurrency = 3, calibrationSize = 30 }: EvaluatorDeps) {
  const jobs = new Map<string, Job>();
  const nameOf = (id: string) => evidence.get(id)?.manifest.name ?? ANCHORS.find((a) => a.id === id)?.name ?? id;

  function requireLlm(): Llm {
    if (!llm) throw new EvaluatorError(503, 'In-app AI reviews are switched off (IN_APP_AI_REVIEWS). Run reviews from Claude Code instead.');
    return llm;
  }

  /** The active prompt version, seeding v1 from the manager's brief on first use. */
  let seeding: Promise<PromptVersion> | null = null;
  async function activeVersion(): Promise<PromptVersion> {
    const active = await evals.activeVersion();
    if (active) return active;
    seeding ??= (async () => {
      const v = await evals.createVersion({
        parentId: null,
        status: 'candidate',
        criteria: DEFAULT_CRITERIA,
        guidance: DEFAULT_GUIDANCE,
        exemplars: [],
        changelog: "Version 1, written from the manager's brief.",
      });
      await evals.promote(v.id);
      return { ...v, status: 'active' as const };
    })();
    return seeding;
  }

  async function versionOrThrow(id: number): Promise<PromptVersion> {
    const v = await evals.version(id);
    if (!v) throw new EvaluatorError(404, `No prompt version ${id}`);
    return v;
  }

  const cachedCard = (id: string) => {
    const e = evidence.get(id);
    return e ? evals.rulesCard(id, e.codeHash) : Promise.resolve(null);
  };

  // -------------------------------------------------------------------------
  // Prompt building (shared by in-app reviews and Claude Code)
  // -------------------------------------------------------------------------

  /** One line per game with its maths where a rules card exists, for reskin checks. */
  async function catalogueText(): Promise<string> {
    const games = evidence.all();
    const cards = await Promise.all(games.map((g) => evals.rulesCard(g.id, g.codeHash)));
    return games
      .map((g, i) => {
        const card = cards[i];
        const maths = card ? `; ${card.maths_family}; ${card.dynamics.join('/')}` : '';
        const classic = g.manifest.collection === 'classics' ? 'classic; ' : '';
        return `- ${g.id}: ${g.manifest.name}, "${g.manifest.tagline}" [${classic}${g.manifest.mechanic}${maths}]`;
      })
      .join('\n');
  }

  /**
   * The ground truth: each rated game's team score, weighted by reviewer
   * (Pierre counts 3×, see reviewerWeight), from every vote, written or not.
   */
  async function humanSummaries(): Promise<Map<string, RatingSummary>> {
    const out = new Map<string, RatingSummary>();
    for (const [id, votes] of await ratings.allVotes()) {
      const s = weightedSummary(votes);
      if (s.count > 0 && evidence.get(id)) out.set(id, { average: s.average, count: s.count });
    }
    return out;
  }

  /**
   * Team-reviewed games to show the judge for `subject`: never the subject
   * itself; the highest- and lowest-rated as scale pins; the version's curated
   * exemplars; then the most similar games. Ordered lowest score first.
   */
  async function references(subject: { id: string; mechanic: string; card: RulesCard | null }, version: PromptVersion, pool: ReferencePool): Promise<ExemplarContext[]> {
    const [humans, reviews] = await Promise.all([humanSummaries(), ratings.allReviews()]);
    const candidates = [...humans].filter(([id]) => id !== subject.id && (pool === 'all' || !isHoldout(id)));
    if (candidates.length < MIN_REFERENCE_POOL) return [];

    const picked = new Map<string, string>();
    const byScore = [...candidates].sort((a, b) => a[1].average - b[1].average || b[1].count - a[1].count);
    picked.set(byScore[byScore.length - 1][0], "the team's highest-rated game");
    if (!picked.has(byScore[0][0])) picked.set(byScore[0][0], "the team's lowest-rated game");

    const available = new Set(candidates.map(([id]) => id));
    for (const x of version.exemplars.slice(0, MAX_CURATED)) {
      if (available.has(x.gameId) && !picked.has(x.gameId) && picked.size < MAX_REFERENCES) picked.set(x.gameId, x.note);
    }

    const cards = new Map(await Promise.all(candidates.map(async ([id]) => [id, await cachedCard(id)] as const)));
    const similar = candidates
      .filter(([id]) => !picked.has(id))
      .map(([id, s]) => ({ id, s, sim: similarity(subject, { mechanic: evidence.get(id)!.manifest.mechanic, card: cards.get(id) ?? null }) }))
      .filter((c) => c.sim > 0)
      .sort((a, b) => b.sim - a.sim || b.s.count - a.s.count);
    for (const c of similar) {
      if (picked.size >= MAX_REFERENCES) break;
      picked.set(c.id, 'a similar game');
    }

    return [...picked]
      .map(([id, note]) => {
        const h = humans.get(id)!;
        return {
          name: nameOf(id),
          concept: cards.get(id)?.concept ?? evidence.get(id)!.manifest.tagline,
          humanAverage: h.average,
          humanCount: h.count,
          note,
          comments: (reviews.get(id) ?? []).slice(0, 2).map((r) => `${r.reviewer ? `${r.reviewer}: ` : ''}${r.comment.slice(0, 300)}`),
        };
      })
      .sort((a, b) => a.humanAverage - b.humanAverage);
  }

  async function buildJudgePrompt(version: PromptVersion, subject: Subject, pool: ReferencePool, catalogue?: string, player?: string) {
    const refs = await references(subject, version, pool);
    return {
      system: judgeSystem(version, catalogue ?? (await catalogueText()), !!player),
      user: judgeUser(subject.name, subject.id, subject.standing, subject.card, subject.facts, subject.table, refs, player),
      references: refs.length,
    };
  }

  /**
   * Scale references for the blind player judge: how the team scored other
   * games on the player criteria (weighted, with a comment). Only names and
   * scores of other games, never anything about the game under review.
   */
  async function playerReferences(subjectId: string, version: PromptVersion, pool: ReferencePool): Promise<string> {
    const votes = await ratings.allVotes();
    const keys = criteriaFor(version.criteria, 'player').map((c) => c.key);
    const rows = [...votes]
      .filter(([id, v]) => id !== subjectId && evidence.get(id) && v.length && (pool === 'all' || !isHoldout(id)))
      .map(([id, v]) => ({ id, s: weightedSummary(v), f: weightedFacets(v) }))
      .filter((r) => keys.some((k) => r.f[k]));
    if (rows.length < MIN_REFERENCE_POOL) return 'None yet.';
    rows.sort((a, b) => a.s.average - b.s.average);
    const pick = [...new Set([rows[0], rows[rows.length - 1], ...rows.slice(1, -1).sort((a, b) => b.s.count - a.s.count)])].slice(0, MAX_REFERENCES);
    return pick
      .sort((a, b) => a.s.average - b.s.average)
      // Unnamed and without comments: a name (or a comment naming a game) would
      // tell the player which formats the team rates highly.
      .map((r, i) => {
        const facets = keys.map((k) => (r.f[k] ? `${k} ${r.f[k]!.average.toFixed(1)}` : '')).filter(Boolean).join(', ');
        return `- Game ${String.fromCharCode(65 + i)}: team ${r.s.average.toFixed(1)}/5 (${r.s.count} ${r.s.count === 1 ? 'review' : 'reviews'}); ${facets}.`;
      })
      .join('\n');
  }

  const standingOf = (collection: string | undefined) => (collection === 'classics' ? CLASSIC_STANDING : PROTOTYPE_STANDING);

  function gameSubject(e: GameEvidence, card: RulesCard): Subject {
    return {
      id: e.id,
      name: e.manifest.name,
      mechanic: e.manifest.mechanic,
      standing: standingOf(e.manifest.collection),
      card,
      facts: checksText(measuredChecks(e)),
      table: evalTable(e),
    };
  }

  // Anchors are described as plain concepts, so they test the rubric rather than the label.
  const anchorSubject = (a: Anchor): Subject => ({
    id: a.id,
    name: a.name,
    mechanic: '',
    standing: 'A game concept for calibration.',
    card: a.card,
    facts: a.measured,
    table: 'Not available for this game; see the measured facts.',
  });

  async function saveJudged(
    version: PromptVersion,
    subjectId: string,
    raw: unknown,
    meta: { codeHash: string; checks: MeasuredCheck[]; model: string; classic?: boolean; player?: unknown },
  ): Promise<Evaluation> {
    let scores: CriterionScore[];
    let r: ReturnType<typeof parseJudge>;
    const cons: string[] = [];
    if (meta.player !== undefined) {
      // Two judges: the blind player scores the player criteria, the designer the rest.
      const playerKeys = criteriaFor(version.criteria, 'player').map((c) => c.key);
      const designerKeys = CRITERION_KEYS.filter((k) => !playerKeys.includes(k));
      const p = parsePlayer(meta.player, playerKeys);
      r = parseJudge(raw, designerKeys);
      const caps = playerCaps(p.checks);
      const cap = COMPREHENSION_CAP[r.comprehension] ?? 5;
      for (const key of ['win_clarity', 'simplicity'] as const) {
        if (cap < (caps[key]?.cap ?? 5)) caps[key] = { cap, why: `the blind player's understanding was graded "${r.comprehension}". ${r.comprehensionReasoning}` };
      }
      const playerScores = p.scores.map((s) => {
        const c = caps[s.key];
        return c && s.score > c.cap ? { ...s, score: c.cap, reasoning: `${s.reasoning} [Capped at ${c.cap}: ${c.why}]` } : s;
      });
      scores = CRITERION_KEYS.map((k) => [...playerScores, ...r.scores].find((s) => s.key === k)!);
      if (r.comprehension && r.comprehension !== 'correct') cons.push(`A blind player misread it (${r.comprehension}): ${r.comprehensionReasoning}`);
      cons.push(...p.confusions.slice(0, 2).map((c) => `Player confusion: ${c}`));
    } else {
      r = parseJudge(raw);
      scores = r.scores;
    }
    // Dead structure is a prototype's flaw; a classic is the original of its format.
    const deadStructure = meta.classic ? 'none' : r.deadStructure;
    if (deadStructure !== 'none') {
      const cap = DEAD_STRUCTURE_FUN_CAP[deadStructure];
      scores = scores.map((s) =>
        s.key === 'fun' && s.score > cap ? { ...s, score: cap, reasoning: `${s.reasoning} [Capped at ${cap}: ${deadStructure} of the board is dead structure.]` } : s,
      );
      cons.push(`Dead structure (${deadStructure}): ${r.deadStructureReasoning}`);
    }
    const duplicateOf = r.duplicate_of && r.duplicate_of !== subjectId ? r.duplicate_of : '';
    return evals.saveEvaluation({
      gameId: subjectId,
      versionId: version.id,
      codeHash: meta.codeHash,
      overall: overallScore(scores, version.criteria, { classic: meta.classic, duplicate: !!duplicateOf, deadStructure }),
      criteria: scores,
      recommendation: r.recommendation,
      verdict: r.verdict,
      pros: r.pros,
      cons: [...r.cons, ...cons],
      duplicateOf,
      closestExisting: r.closest_existing,
      checks: meta.checks,
      model: meta.model,
    });
  }

  // -------------------------------------------------------------------------
  // In-app reviews (billed API, behind IN_APP_AI_REVIEWS)
  // -------------------------------------------------------------------------

  async function rulesCard(e: GameEvidence): Promise<RulesCard> {
    const cached = await evals.rulesCard(e.id, e.codeHash);
    if (cached) return cached;
    const model = requireLlm();
    const card = parseCard(
      await model.json<RulesCard>({ system: EXTRACT_SYSTEM, user: extractUser(e.manifest, e.files), schema: RULES_CARD_SCHEMA, effort: 'medium' }),
    );
    await evals.saveRulesCard(e.id, e.codeHash, card, model.model);
    return card;
  }

  interface BatchContext {
    version: PromptVersion;
    pool: ReferencePool;
    /** Built once per batch so the judge's system prompt stays identical and caches. */
    catalogue: string;
  }

  async function judgeWithLlm(ctx: BatchContext, subject: Subject, meta: { codeHash: string; checks: MeasuredCheck[] }) {
    const model = requireLlm();
    const prompt = await buildJudgePrompt(ctx.version, subject, ctx.pool, ctx.catalogue);
    const raw = await model.json<JudgeOutput>({ system: prompt.system, user: prompt.user, schema: JUDGE_SCHEMA, effort: 'high' });
    return saveJudged(ctx.version, subject.id, raw, { ...meta, model: model.model, classic: subject.standing === CLASSIC_STANDING });
  }

  async function evaluateGame(gameId: string, ctx: BatchContext): Promise<Evaluation> {
    const e = evidence.get(gameId);
    if (!e) throw new EvaluatorError(404, `No evidence for ${gameId}; it may not be deployed to the API yet.`);
    const card = await rulesCard(e);
    return judgeWithLlm(ctx, gameSubject(e, card), { codeHash: e.codeHash, checks: measuredChecks(e) });
  }

  const evaluateAnchor = (anchor: Anchor, ctx: BatchContext) => judgeWithLlm(ctx, anchorSubject(anchor), { codeHash: 'anchor', checks: [] });

  const batchContext = async (version: PromptVersion, pool: ReferencePool): Promise<BatchContext> => ({ version, pool, catalogue: await catalogueText() });

  // -------------------------------------------------------------------------
  // Jobs
  // -------------------------------------------------------------------------

  function startJob(kind: Job['kind'], label: string, body: (job: Job) => Promise<unknown>): Job {
    const busy = [...jobs.values()].find((j) => j.status === 'running');
    if (busy) throw new EvaluatorError(409, `Another job is running: ${busy.label}. Wait for it to finish.`);
    const job: Job = {
      id: randomUUID(),
      kind,
      label,
      status: 'running',
      total: 0,
      done: 0,
      failed: 0,
      errors: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      result: null,
    };
    jobs.set(job.id, job);
    for (const id of [...jobs.keys()].slice(0, Math.max(0, jobs.size - 20))) jobs.delete(id);

    body(job)
      .then((result) => {
        job.result = result ?? null;
        job.status = 'done';
      })
      .catch((err: unknown) => {
        job.errors.push(err instanceof Error ? err.message : String(err));
        job.status = 'error';
      })
      .finally(() => {
        job.finishedAt = new Date().toISOString();
      });
    return job;
  }

  /** Runs `work` over `items` with limited parallelism, counting progress on `job`. */
  async function eachLimited<T>(job: Job, items: T[], label: (item: T) => string, work: (item: T) => Promise<unknown>) {
    job.total += items.length;
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const item = items[next++];
        try {
          await work(item);
        } catch (err) {
          job.failed++;
          job.errors.push(`${label(item)}: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          job.done++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  }

  // -------------------------------------------------------------------------
  // Calibration: humans vs AI
  // -------------------------------------------------------------------------

  /** The most-reviewed games (train and holdout) plus the core classics, used as the backtest set. */
  async function calibrationGames(): Promise<string[]> {
    const humans = await humanSummaries();
    const reviewed = [...humans]
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .slice(0, calibrationSize)
      .map(([id]) => id);
    return [...new Set([...reviewed, ...CORE_CLASSICS.filter((id) => evidence.get(id))])];
  }

  /** Calibration games and anchors with no current review under `version`. */
  async function calibrationTodo(version: PromptVersion, games: string[]) {
    const latest = await evals.latestEvaluations(version.id);
    return {
      games: games.filter((id) => latest.get(id)?.codeHash !== evidence.get(id)?.codeHash),
      // Text anchors are retired: they can't be played blind. Real games are the benchmarks now.
      anchors: [] as Anchor[],
    };
  }

  async function fillCalibration(job: Job, version: PromptVersion, games: string[]) {
    const todo = await calibrationTodo(version, games);
    const ctx = await batchContext(version, 'train');
    await eachLimited(job, todo.games, (id) => id, (id) => evaluateGame(id, ctx));
    await eachLimited(job, todo.anchors, (a) => a.id, (a) => evaluateAnchor(a, ctx));
  }

  function agreement(pairs: { id: string; ai: number; human: number }[]): AgreementStats {
    return {
      games: pairs.length,
      spearman: spearman(pairs.map((p) => p.ai), pairs.map((p) => p.human)),
      mae: meanAbsError(pairs.map((p) => p.ai), pairs.map((p) => p.human)),
    };
  }

  async function computeMetrics(version: PromptVersion, games: string[]): Promise<BacktestMetrics> {
    const [latest, humans] = await Promise.all([evals.latestEvaluations(version.id), humanSummaries()]);
    const pairs = games.flatMap((id) => {
      const e = latest.get(id);
      const h = humans.get(id);
      return e && h ? [{ id, ai: e.overall, human: h.average }] : [];
    });
    // Benchmarks (they replace the text anchors): the core classics must score
    // high, the classics as a group should average well, and games the team
    // rated low must not score high.
    const anchorFailures: string[] = [];
    let anchorsPassed = 0;
    let anchorsTotal = 0;
    const check = (ok: boolean, failure: string) => {
      anchorsTotal++;
      if (ok) anchorsPassed++;
      else anchorFailures.push(failure);
    };
    for (const id of CORE_CLASSICS) {
      const e = latest.get(id);
      if (e) check(e.overall >= CORE_MIN, `${nameOf(id)} (core classic) scored ${e.overall.toFixed(2)} (expected ≥ ${CORE_MIN})`);
    }
    const classics = evidence.all().filter((g) => g.manifest.collection === 'classics' && latest.has(g.id));
    if (classics.length >= 5) {
      const mean = classics.reduce((a, g) => a + latest.get(g.id)!.overall, 0) / classics.length;
      check(mean >= CLASSICS_MEAN_MIN, `Classics average ${mean.toFixed(2)} (expected ≥ ${CLASSICS_MEAN_MIN})`);
    }
    for (const [id, h] of humans) {
      const e = latest.get(id);
      if (e && h.average <= TEAM_LOW) check(e.overall <= AI_LOW_MAX, `${nameOf(id)} (team ${h.average.toFixed(1)}) scored ${e.overall.toFixed(2)} (expected ≤ ${AI_LOW_MAX})`);
    }
    const all = agreement(pairs);
    return {
      ranAt: new Date().toISOString(),
      humanGames: all.games,
      spearman: all.spearman,
      mae: all.mae,
      holdout: agreement(pairs.filter((p) => isHoldout(p.id))),
      anchorsPassed,
      anchorsTotal,
      anchorFailures,
    };
  }

  /** Stores metrics for `version` and the active version, computed on the same games. */
  async function scoreVersions(version: PromptVersion) {
    const active = await activeVersion();
    const games = await calibrationGames();
    const [activeMetrics, metrics] = await Promise.all([computeMetrics(active, games), computeMetrics(version, games)]);
    await evals.setMetrics(active.id, activeMetrics);
    if (version.id !== active.id) await evals.setMetrics(version.id, metrics);
    return { versionId: version.id, metrics, activeId: active.id, activeMetrics };
  }

  async function backtest(job: Job, candidate: PromptVersion) {
    const active = await activeVersion();
    const games = await calibrationGames();
    await fillCalibration(job, active, games);
    if (candidate.id !== active.id) await fillCalibration(job, candidate, games);
    return scoreVersions(candidate);
  }

  /** Everything the refiner needs, from train games only. Lists train games lacking a current review. */
  async function refineContext() {
    const active = await activeVersion();
    const games = await calibrationGames();
    const train = games.filter((id) => !isHoldout(id));
    const holdout = games.filter(isHoldout);
    if (train.length < MIN_TRAIN_FOR_REFINE) {
      throw new EvaluatorError(
        400,
        `Refining needs team reviews on at least ${MIN_TRAIN_FOR_REFINE} training games; there are ${train.length} (plus ${holdout.length} held out). Review a few more games.`,
      );
    }
    const [latest, humans, allReviews] = await Promise.all([evals.latestEvaluations(active.id), humanSummaries(), ratings.allReviews()]);
    const rows = train.map((id) => {
      const e = latest.get(id);
      const h = humans.get(id)!;
      return {
        gameId: id,
        name: nameOf(id),
        humanAverage: h.average,
        humanCount: h.count,
        ai: e?.overall ?? null,
        criteria: e ? Object.fromEntries(e.criteria.map((c) => [c.key, c.score])) : null,
      };
    });
    const withScores = rows.filter((r) => r.criteria);
    const fitted = fitWeights(
      withScores.map((r) => CRITERION_KEYS.map((k) => r.criteria![k])),
      withScores.map((r) => r.humanAverage),
      [...CRITERION_KEYS],
    );
    const comments = new Map<string, Review[]>(train.flatMap((id) => (allReviews.get(id)?.length ? [[id, allReviews.get(id)!.slice(0, 5)] as const] : [])));
    const anchorText = ANCHORS.map((a) => {
      const e = latest.get(a.id);
      return `- ${a.name} (expected ${a.expectation}): ${e ? e.overall.toFixed(2) : 'not scored'}`;
    }).join('\n');

    return {
      active,
      train,
      holdout,
      missing: train.filter((id) => latest.get(id)?.codeHash !== evidence.get(id)?.codeHash),
      system: REFINE_SYSTEM,
      user: refineUser(active, rows, comments, fitted, anchorText, holdout.length),
    };
  }

  /** Turns a refiner proposal into a candidate version; exemplars must be train games. */
  async function createCandidate(active: PromptVersion, proposal: RefineOutput, train: string[]): Promise<PromptVersion> {
    if (!proposal || typeof proposal !== 'object' || !Array.isArray(proposal.criteria) || !Array.isArray(proposal.exemplars)) {
      throw new EvaluatorError(400, 'The proposal must match the refine schema (criteria, exemplars, guidance, changelog).');
    }
    const trainSet = new Set(train);
    return evals.createVersion({
      parentId: active.id,
      status: 'candidate',
      criteria: active.criteria.map((c) => {
        const p = proposal.criteria.find((x) => x?.key === c.key);
        if (!p || typeof p.weight !== 'number') return c;
        return {
          ...c,
          weight: Math.min(3, Math.max(0, Math.round(p.weight * 100) / 100)),
          descriptors: {
            1: p.descriptor_1 || c.descriptors[1],
            3: p.descriptor_3 || c.descriptors[3],
            5: p.descriptor_5 || c.descriptors[5],
          },
        };
      }),
      guidance: (typeof proposal.guidance === 'string' && proposal.guidance.trim() ? proposal.guidance : active.guidance).slice(0, MAX_GUIDANCE_CHARS),
      exemplars: proposal.exemplars.filter((x) => trainSet.has(x?.gameId) && typeof x.note === 'string').slice(0, MAX_CURATED),
      changelog: typeof proposal.changelog === 'string' ? proposal.changelog : '',
    });
  }

  async function refine(job: Job) {
    const model = requireLlm();
    const before = await refineContext();
    await fillCalibration(job, before.active, before.train);
    const ctx = await refineContext();
    job.total++;
    const proposal = await model.json<RefineOutput>({ system: ctx.system, user: ctx.user, schema: REFINE_SCHEMA, effort: 'high' });
    job.done++;
    const candidate = await createCandidate(ctx.active, proposal, ctx.train);
    return backtest(job, candidate);
  }

  async function subjectFor(input: { gameId?: string; anchorId?: string; name?: string; mechanic?: string; collection?: string; card?: unknown; facts?: string; table?: string }) {
    const anchor = input.anchorId ? ANCHORS.find((a) => a.id === input.anchorId) : undefined;
    if (input.anchorId && !anchor) throw new EvaluatorError(404, `No anchor ${input.anchorId}`);
    if (anchor) return anchorSubject(anchor);
    if (!input.gameId) throw new EvaluatorError(400, 'Give a gameId or an anchorId.');
    const card = parseCard(input.card);
    const e = evidence.get(input.gameId);
    // Facts come from the caller's local evidence when given, so a local
    // review judges the local code even before it is deployed.
    return {
      id: input.gameId,
      name: input.name ?? e?.manifest.name ?? input.gameId,
      mechanic: input.mechanic ?? e?.manifest.mechanic ?? '',
      standing: standingOf(input.collection ?? e?.manifest.collection),
      card,
      facts: input.facts ?? (e ? checksText(measuredChecks(e)) : 'No measured facts.'),
      table: input.table ?? (e ? evalTable(e) : 'No eval available.'),
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  return {
    activeVersion,

    async status(): Promise<EvaluatorStatus> {
      return {
        aiEnabled: llm !== null,
        adminConfigured: false, // filled in by the HTTP layer
        model: llm?.model ?? '',
        evidenceGames: evidence.all().length,
        activeVersion: await activeVersion(),
      };
    },

    async view(gameId: string): Promise<EvaluationView | null> {
      const version = await activeVersion();
      const e = (await evals.latestEvaluations(version.id)).get(gameId);
      if (!e) return null;
      const current = evidence.get(gameId);
      return {
        ...e,
        rulesCard: await evals.rulesCard(gameId, e.codeHash),
        stale: current ? current.codeHash !== e.codeHash : false,
      };
    },

    async summaries(): Promise<Record<string, EvaluationSummary>> {
      const version = await activeVersion();
      const latest = await evals.latestEvaluations(version.id);
      return Object.fromEntries(
        [...latest]
          .filter(([id]) => evidence.get(id))
          .map(([id, e]) => [
            id,
            {
              overall: e.overall,
              codeHash: e.codeHash,
              recommendation: e.recommendation,
              facets: Object.fromEntries(e.criteria.map((c) => [c.key, c.score])) as Record<CriterionKey, number>,
              stale: evidence.get(id)!.codeHash !== e.codeHash,
              createdAt: e.createdAt,
            },
          ]),
      );
    },

    /** Reviews games under the active version: one id, every game, or only those without a current review. */
    startEvaluate(target: string | 'all' | 'missing'): Job {
      requireLlm();
      if (target !== 'all' && target !== 'missing' && !evidence.get(target)) {
        throw new EvaluatorError(404, `No evidence for ${target}; it may not be deployed to the API yet.`);
      }
      return startJob('evaluate', target === 'all' ? 'Review all games' : target === 'missing' ? 'Review unreviewed games' : `Review ${nameOf(target)}`, async (job) => {
        const version = await activeVersion();
        const latest = await evals.latestEvaluations(version.id);
        const ids =
          target === 'all'
            ? evidence.all().map((g) => g.id)
            : target === 'missing'
              ? evidence.all().filter((g) => latest.get(g.id)?.codeHash !== g.codeHash).map((g) => g.id)
              : [target];
        const ctx = await batchContext(version, 'all');
        await eachLimited(job, ids, (id) => id, (id) => evaluateGame(id, ctx));
        if (job.failed === job.total && job.total > 0) throw new Error('Every review failed.');
        return { versionId: version.id };
      });
    },

    startRefine(): Job {
      requireLlm();
      return startJob('refine', 'Refine the prompt from human reviews', refine);
    },

    async startBacktest(versionId: number): Promise<Job> {
      requireLlm();
      const v = await versionOrThrow(versionId);
      return startJob('backtest', `Backtest version ${v.id}`, (job) => backtest(job, v));
    },

    async promote(versionId: number): Promise<PromptVersion> {
      const v = await versionOrThrow(versionId);
      if (v.status === 'active') return v;
      await evals.promote(versionId);
      return { ...v, status: 'active' };
    },

    versions: () => evals.versions(),
    version: versionOrThrow,
    job: (id: string) => jobs.get(id) ?? null,
    jobs: () => [...jobs.values()].reverse(),

    async agreement(): Promise<{ rows: AgreementRow[]; spearman: number | null; mae: number | null }> {
      const version = await activeVersion();
      const [latest, humans] = await Promise.all([evals.latestEvaluations(version.id), humanSummaries()]);
      const rows: AgreementRow[] = [...humans].map(([gameId, h]) => ({
        gameId,
        humanAverage: h.average,
        humanCount: h.count,
        aiOverall: latest.get(gameId)?.overall ?? null,
      }));
      const paired = rows.filter((r) => r.aiOverall !== null);
      return {
        rows: rows.sort((a, b) => b.humanCount - a.humanCount),
        spearman: spearman(paired.map((r) => r.aiOverall!), paired.map((r) => r.humanAverage)),
        mae: meanAbsError(paired.map((r) => r.aiOverall!), paired.map((r) => r.humanAverage)),
      };
    },

    // ---- The Claude Code path: prompts out, results in -------------------

    /** The cached rules card for a game's code version, if any. */
    card: (gameId: string, codeHash: string) => evals.rulesCard(gameId, codeHash),

    /** The judge prompt for a game (with the caller's rules card) or an anchor. */
    async judgePrompt(input: {
      gameId?: string;
      anchorId?: string;
      name?: string;
      mechanic?: string;
      collection?: string;
      card?: unknown;
      facts?: string;
      table?: string;
      versionId?: number;
      pool?: ReferencePool;
      /** The blind player's review: the designer judge then scores only its own criteria and grades comprehension. */
      player?: unknown;
    }) {
      const version = input.versionId ? await versionOrThrow(input.versionId) : await activeVersion();
      const subject = await subjectFor(input);
      const playerKeys = criteriaFor(version.criteria, 'player').map((c) => c.key);
      const player = input.player !== undefined && playerKeys.length ? playerSummary(parsePlayer(input.player, playerKeys)) : undefined;
      const prompt = await buildJudgePrompt(version, subject, input.pool === 'train' ? 'train' : 'all', undefined, player);
      const keys = player ? CRITERION_KEYS.filter((k) => !playerKeys.includes(k)) : CRITERION_KEYS;
      return { versionId: version.id, subjectId: subject.id, ...prompt, schema: judgeSchema(keys, !!player) };
    },

    /** The blind player prompt for a game: UI only, played through `tool` (a command the caller provides). */
    async playerPrompt(input: { gameId?: string; versionId?: number; pool?: ReferencePool; tool?: string }) {
      if (!input.gameId) throw new EvaluatorError(400, 'Give a gameId.');
      const version = input.versionId ? await versionOrThrow(input.versionId) : await activeVersion();
      const keys = criteriaFor(version.criteria, 'player').map((c) => c.key);
      if (!keys.length) throw new EvaluatorError(400, `Prompt version ${version.id} has no player criteria; review with the judge alone.`);
      const refs = await playerReferences(input.gameId, version, input.pool === 'train' ? 'train' : 'all');
      return {
        versionId: version.id,
        system: playerSystem(version),
        user: playerUser(input.tool ?? '(the caller did not provide a play command)', refs),
        schema: playerSchema(keys),
      };
    },

    /** Stores a review produced elsewhere (Claude Code). The overall score is computed here. */
    async importEvaluation(input: { gameId?: string; anchorId?: string; versionId?: number; codeHash?: string; card?: unknown; review: unknown; player?: unknown; checks?: unknown; model?: string; collection?: string }): Promise<Evaluation> {
      const version = input.versionId ? await versionOrThrow(input.versionId) : await activeVersion();
      const anchor = input.anchorId ? ANCHORS.find((a) => a.id === input.anchorId) : undefined;
      if (input.anchorId && !anchor) throw new EvaluatorError(404, `No anchor ${input.anchorId}`);
      const subjectId = anchor?.id ?? input.gameId;
      if (!subjectId) throw new EvaluatorError(400, 'Give a gameId or an anchorId.');
      const codeHash = anchor ? 'anchor' : typeof input.codeHash === 'string' && input.codeHash ? input.codeHash : '';
      if (!codeHash) throw new EvaluatorError(400, 'codeHash is required for game reviews.');
      const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim().slice(0, 60) : 'claude-code';
      if (!anchor && input.card !== undefined) await evals.saveRulesCard(subjectId, codeHash, parseCard(input.card), model);
      const checks = Array.isArray(input.checks) ? (input.checks as MeasuredCheck[]).filter((c) => c && typeof c.label === 'string') : [];
      const classic = (input.collection ?? evidence.get(subjectId)?.manifest.collection) === 'classics';
      return saveJudged(version, subjectId, input.review, { codeHash, checks, model, classic, player: input.player });
    },

    /** The refine prompt; `missing` lists train games to review first under the active version. */
    async refinePrompt() {
      const ctx = await refineContext();
      return {
        activeVersionId: ctx.active.id,
        train: ctx.train,
        holdout: ctx.holdout,
        missing: ctx.missing,
        system: ctx.system,
        user: ctx.user,
        schema: REFINE_SCHEMA,
      };
    },

    /**
     * Stores a hand-written prompt version as a candidate, e.g. a recalibrated
     * rubric. Needs no team reviews, unlike a refiner proposal.
     */
    async createVersion(input: { criteria?: unknown; guidance?: unknown; exemplars?: unknown; changelog?: unknown }): Promise<PromptVersion> {
      const active = await activeVersion();
      const criteria = input.criteria as CriterionDef[] | undefined;
      const valid =
        Array.isArray(criteria) &&
        CRITERION_KEYS.every((key) => {
          const c = criteria.find((x) => x?.key === key);
          return (
            c &&
            typeof c.name === 'string' &&
            typeof c.question === 'string' &&
            typeof c.weight === 'number' &&
            c.weight >= 0 &&
            c.weight <= 3 &&
            [1, 3, 5].every((n) => typeof c.descriptors?.[n as 1 | 3 | 5] === 'string')
          );
        });
      if (!valid) throw new EvaluatorError(400, 'criteria must define every criterion with name, question, weight 0-3 and 1/3/5 descriptors.');
      if (typeof input.guidance !== 'string' || !input.guidance.trim()) throw new EvaluatorError(400, 'guidance is required.');
      return evals.createVersion({
        parentId: active.id,
        status: 'candidate',
        criteria: CRITERION_KEYS.map((key) => criteria!.find((c) => c.key === key)!),
        guidance: input.guidance.slice(0, MAX_GUIDANCE_CHARS),
        exemplars: [],
        changelog: typeof input.changelog === 'string' ? input.changelog : '',
      });
    },

    async submitVersion(proposal: RefineOutput): Promise<PromptVersion> {
      const ctx = await refineContext();
      return createCandidate(ctx.active, proposal, ctx.train);
    },

    /** What still needs reviewing under `versionId` (and the active version) to backtest it. */
    async calibration(versionId?: number) {
      const version = versionId ? await versionOrThrow(versionId) : await activeVersion();
      const active = await activeVersion();
      const games = await calibrationGames();
      const [mine, theirs] = await Promise.all([calibrationTodo(version, games), calibrationTodo(active, games)]);
      const anchorView = (a: Anchor) => ({ id: a.id, name: a.name, expectation: a.expectation });
      return {
        versionId: version.id,
        activeId: active.id,
        games: games.map((id) => ({ id, split: isHoldout(id) ? 'holdout' : 'train' })),
        todo: { games: mine.games, anchors: mine.anchors.map(anchorView) },
        activeTodo: { games: theirs.games, anchors: theirs.anchors.map(anchorView) },
      };
    },

    /** Recomputes and stores agreement metrics from stored reviews. No AI calls. */
    async scoreVersion(versionId: number) {
      return scoreVersions(await versionOrThrow(versionId));
    },
  };
}

export type Evaluator = ReturnType<typeof createEvaluator>;
