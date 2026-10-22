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
  isHoldout,
  overallScore,
  summarize,
  type AgreementRow,
  type AgreementStats,
  type BacktestMetrics,
  type CriterionDef,
  type CriterionKey,
  type CriterionScore,
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
import { ANCHORS, HIGH_MIN, LOW_MAX, type Anchor } from './anchors.js';
import { evalTable, measuredChecks, type EvidenceIndex, type GameEvidence } from './evidence.js';
import type { Llm } from './llm.js';
import {
  EXTRACT_SYSTEM,
  CLASSIC_STANDING,
  JUDGE_SCHEMA,
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
const MAX_REFERENCES = 6;
// Below this many reviewed games there's no real team scale to calibrate
// against (and early ratings are often tests), so the rubric judges alone.
const MIN_REFERENCE_POOL = 3;
const MAX_CURATED = 4;
const MAX_GUIDANCE_CHARS = 3000;
const RECOMMENDATIONS = ['ship', 'iterate', 'drop'] as const;

const checksText = (checks: MeasuredCheck[]) => checks.map((c) => `- ${c.pass ? 'PASS' : 'FAIL'} ${c.label}: ${c.detail}`).join('\n');

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Validates a judge result from Claude or an import; throws on anything malformed. */
export function parseJudge(raw: unknown): JudgeOutput & { scores: CriterionScore[] } {
  const r = raw as Partial<JudgeOutput> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.criteria)) throw new EvaluatorError(400, 'The review has no criteria array.');
  const scores: CriterionScore[] = CRITERION_KEYS.map((key) => {
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
  };
}

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

  /** Human average and count for every rated game that has evidence. */
  async function humanSummaries(): Promise<Map<string, RatingSummary>> {
    const out = new Map<string, RatingSummary>();
    for (const [id, d] of await ratings.distributions()) {
      const s = summarize(d);
      if (s.count > 0 && evidence.get(id)) out.set(id, s);
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
          comments: (reviews.get(id) ?? []).slice(0, 2).map((r) => r.comment.slice(0, 300)),
        };
      })
      .sort((a, b) => a.humanAverage - b.humanAverage);
  }

  async function buildJudgePrompt(version: PromptVersion, subject: Subject, pool: ReferencePool, catalogue?: string) {
    const refs = await references(subject, version, pool);
    return {
      system: judgeSystem(version, catalogue ?? (await catalogueText())),
      user: judgeUser(subject.name, subject.id, subject.standing, subject.card, subject.facts, subject.table, refs),
      references: refs.length,
    };
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
    meta: { codeHash: string; checks: MeasuredCheck[]; model: string },
  ): Promise<Evaluation> {
    const r = parseJudge(raw);
    return evals.saveEvaluation({
      gameId: subjectId,
      versionId: version.id,
      codeHash: meta.codeHash,
      overall: overallScore(r.scores, version.criteria),
      criteria: r.scores,
      recommendation: r.recommendation,
      verdict: r.verdict,
      pros: r.pros,
      cons: r.cons,
      duplicateOf: r.duplicate_of && r.duplicate_of !== subjectId ? r.duplicate_of : '',
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
    return saveJudged(ctx.version, subject.id, raw, { ...meta, model: model.model });
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

  /** The most-reviewed games (train and holdout), used as the backtest set. */
  async function calibrationGames(): Promise<string[]> {
    const humans = await humanSummaries();
    return [...humans]
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .slice(0, calibrationSize)
      .map(([id]) => id);
  }

  /** Calibration games and anchors with no current review under `version`. */
  async function calibrationTodo(version: PromptVersion, games: string[]) {
    const latest = await evals.latestEvaluations(version.id);
    return {
      games: games.filter((id) => latest.get(id)?.codeHash !== evidence.get(id)?.codeHash),
      anchors: ANCHORS.filter((a) => !latest.has(a.id)),
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
    const anchorFailures: string[] = [];
    let anchorsPassed = 0;
    let anchorsTotal = 0;
    for (const a of ANCHORS) {
      const e = latest.get(a.id);
      if (!e) continue;
      anchorsTotal++;
      const ok = a.expectation === 'high' ? e.overall >= HIGH_MIN : e.overall <= LOW_MAX;
      if (ok) anchorsPassed++;
      else anchorFailures.push(`${a.name} scored ${e.overall.toFixed(2)} (expected ${a.expectation === 'high' ? `≥ ${HIGH_MIN}` : `≤ ${LOW_MAX}`})`);
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
    }) {
      const version = input.versionId ? await versionOrThrow(input.versionId) : await activeVersion();
      const subject = await subjectFor(input);
      const prompt = await buildJudgePrompt(version, subject, input.pool === 'train' ? 'train' : 'all');
      return { versionId: version.id, subjectId: subject.id, ...prompt, schema: JUDGE_SCHEMA };
    },

    /** Stores a review produced elsewhere (Claude Code). The overall score is computed here. */
    async importEvaluation(input: { gameId?: string; anchorId?: string; versionId?: number; codeHash?: string; card?: unknown; review: unknown; checks?: unknown; model?: string }): Promise<Evaluation> {
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
      return saveJudged(version, subjectId, input.review, { codeHash, checks, model });
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
