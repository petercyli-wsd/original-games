// Orchestrates the evaluator: rules cards, judging, background jobs, prompt
// refinement and backtests. Long work runs as in-memory jobs the site polls;
// every finished review is stored as it completes, so a restart loses only
// the progress counter, never results.

import { randomUUID } from 'node:crypto';
import {
  CRITERION_KEYS,
  overallScore,
  summarize,
  type AgreementRow,
  type BacktestMetrics,
  type CriterionKey,
  type CriterionScore,
  type Evaluation,
  type EvaluationSummary,
  type EvaluationView,
  type EvaluatorStatus,
  type Job,
  type PromptVersion,
  type RatingSummary,
  type Review,
  type RulesCard,
} from '../shared.js';
import type { EvalStore, RatingsStore } from '../store.js';
import { ANCHORS, HIGH_MIN, LOW_MAX, type Anchor } from './anchors.js';
import { catalogue, evalTable, measuredChecks, type EvidenceIndex, type GameEvidence } from './evidence.js';
import type { Llm } from './llm.js';
import {
  EXTRACT_SYSTEM,
  JUDGE_SCHEMA,
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

interface JudgeOutput {
  criteria: { key: CriterionKey; reasoning: string; score: number }[];
  pros: string[];
  cons: string[];
  closest_existing: string;
  duplicate_of: string;
  verdict: string;
  recommendation: Evaluation['recommendation'];
}

interface RefineOutput {
  changelog: string;
  guidance: string;
  criteria: { key: CriterionKey; weight: number; descriptor_1: string; descriptor_3: string; descriptor_5: string }[];
  exemplars: { gameId: string; note: string }[];
}

const MIN_REVIEWED_FOR_REFINE = 3;
const MAX_EXEMPLARS = 6;
const MAX_GUIDANCE_CHARS = 3000;

export function createEvaluator({ llm, evals, ratings, evidence, concurrency = 3, calibrationSize = 30 }: EvaluatorDeps) {
  const jobs = new Map<string, Job>();
  const checksText = (e: GameEvidence) =>
    measuredChecks(e)
      .map((c) => `- ${c.pass ? 'PASS' : 'FAIL'} ${c.label}: ${c.detail}`)
      .join('\n');
  const nameOf = (id: string) => evidence.get(id)?.manifest.name ?? ANCHORS.find((a) => a.id === id)?.name ?? id;

  function requireLlm(): Llm {
    if (!llm) throw new EvaluatorError(503, 'AI reviews are off: set ANTHROPIC_API_KEY on the API service.');
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

  // -------------------------------------------------------------------------
  // Single reviews
  // -------------------------------------------------------------------------

  async function rulesCard(e: GameEvidence): Promise<RulesCard> {
    const cached = await evals.rulesCard(e.id, e.codeHash);
    if (cached) return cached;
    const model = requireLlm();
    const card = await model.json<RulesCard>({
      system: EXTRACT_SYSTEM,
      user: extractUser(e.manifest, e.files),
      schema: RULES_CARD_SCHEMA,
      effort: 'medium',
    });
    await evals.saveRulesCard(e.id, e.codeHash, card, model.model);
    return card;
  }

  async function exemplarContext(version: PromptVersion): Promise<ExemplarContext[]> {
    const [dists, reviews] = await Promise.all([ratings.distributions(), ratings.allReviews()]);
    return version.exemplars.flatMap((x) => {
      const d = dists.get(x.gameId);
      if (!d) return [];
      const s = summarize(d);
      return [{ name: nameOf(x.gameId), humanAverage: s.average, humanCount: s.count, note: x.note, comments: (reviews.get(x.gameId) ?? []).slice(0, 3).map((r) => r.comment.slice(0, 400)) }];
    });
  }

  function normalizeJudge(raw: JudgeOutput): CriterionScore[] {
    const scores: CriterionScore[] = [];
    for (const key of CRITERION_KEYS) {
      const c = raw.criteria.find((x) => x.key === key);
      if (!c || !Number.isInteger(c.score) || c.score < 1 || c.score > 5) throw new Error(`Claude's review is missing a valid score for ${key}`);
      scores.push({ key, score: c.score, reasoning: c.reasoning });
    }
    return scores;
  }

  /** Judges one subject (a game or an anchor) and stores the result. */
  async function judgeAndSave(
    version: PromptVersion,
    exemplars: ExemplarContext[],
    subject: { id: string; name: string; card: RulesCard; checks: Evaluation['checks']; facts: string; table: string; codeHash: string },
  ): Promise<Evaluation> {
    const model = requireLlm();
    const raw = await model.json<JudgeOutput>({
      system: judgeSystem(version, catalogue(evidence), exemplars),
      user: judgeUser(subject.name, subject.id, subject.card, subject.facts, subject.table),
      schema: JUDGE_SCHEMA,
      effort: 'high',
    });
    const criteria = normalizeJudge(raw);
    return evals.saveEvaluation({
      gameId: subject.id,
      versionId: version.id,
      codeHash: subject.codeHash,
      overall: overallScore(criteria, version.criteria),
      criteria,
      recommendation: raw.recommendation,
      verdict: raw.verdict,
      pros: raw.pros,
      cons: raw.cons,
      duplicateOf: raw.duplicate_of && raw.duplicate_of !== subject.id ? raw.duplicate_of : '',
      closestExisting: raw.closest_existing,
      checks: subject.checks,
      model: model.model,
    });
  }

  async function evaluateGame(gameId: string, version: PromptVersion, exemplars: ExemplarContext[]): Promise<Evaluation> {
    const e = evidence.get(gameId);
    if (!e) throw new EvaluatorError(404, `No evidence for ${gameId}; it may not be deployed to the API yet.`);
    const card = await rulesCard(e);
    return judgeAndSave(version, exemplars, {
      id: e.id,
      name: e.manifest.name,
      card,
      checks: measuredChecks(e),
      facts: checksText(e),
      table: evalTable(e),
      codeHash: e.codeHash,
    });
  }

  function evaluateAnchor(anchor: Anchor, version: PromptVersion, exemplars: ExemplarContext[]): Promise<Evaluation> {
    return judgeAndSave(version, exemplars, {
      id: anchor.id,
      name: anchor.name,
      card: anchor.card,
      checks: [],
      facts: anchor.measured,
      table: 'Not available for this game; see the measured facts.',
      codeHash: 'anchor',
    });
  }

  // -------------------------------------------------------------------------
  // Jobs
  // -------------------------------------------------------------------------

  function runningJob(): Job | undefined {
    return [...jobs.values()].find((j) => j.status === 'running');
  }

  function startJob(kind: Job['kind'], label: string, body: (job: Job) => Promise<unknown>): Job {
    const busy = runningJob();
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
    // Keep the 20 most recent jobs.
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

  /** Human average and count for every rated game that has evidence. */
  async function humanSummaries(): Promise<Map<string, RatingSummary>> {
    const out = new Map<string, RatingSummary>();
    for (const [id, d] of await ratings.distributions()) {
      const s = summarize(d);
      if (s.count > 0 && evidence.get(id)) out.set(id, s);
    }
    return out;
  }

  /** The most-reviewed games, used as the backtest set. */
  async function calibrationGames(): Promise<string[]> {
    const humans = await humanSummaries();
    return [...humans]
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .slice(0, calibrationSize)
      .map(([id]) => id);
  }

  /** Evaluates whatever in the calibration set lacks a current review under `version`. */
  async function fillCalibration(job: Job, version: PromptVersion, games: string[]) {
    const latest = await evals.latestEvaluations(version.id);
    const needsGame = games.filter((id) => latest.get(id)?.codeHash !== evidence.get(id)?.codeHash);
    const needsAnchor = ANCHORS.filter((a) => !latest.has(a.id));
    const exemplars = await exemplarContext(version);
    await eachLimited(job, needsGame, (id) => id, (id) => evaluateGame(id, version, exemplars));
    await eachLimited(job, needsAnchor, (a) => a.id, (a) => evaluateAnchor(a, version, exemplars));
  }

  async function computeMetrics(version: PromptVersion, games: string[]): Promise<BacktestMetrics> {
    const [latest, humans] = await Promise.all([evals.latestEvaluations(version.id), humanSummaries()]);
    const pairs = games.flatMap((id) => {
      const e = latest.get(id);
      const h = humans.get(id);
      return e && h ? [[e.overall, h.average] as const] : [];
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
    return {
      ranAt: new Date().toISOString(),
      humanGames: pairs.length,
      spearman: spearman(pairs.map((p) => p[0]), pairs.map((p) => p[1])),
      mae: meanAbsError(pairs.map((p) => p[0]), pairs.map((p) => p[1])),
      anchorsPassed,
      anchorsTotal,
      anchorFailures,
    };
  }

  /** Scores `candidate` and the active version on the same games and stores both metrics. */
  async function backtest(job: Job, candidate: PromptVersion) {
    const active = await activeVersion();
    const games = await calibrationGames();
    await fillCalibration(job, active, games);
    if (candidate.id !== active.id) await fillCalibration(job, candidate, games);
    const [activeMetrics, candidateMetrics] = await Promise.all([computeMetrics(active, games), computeMetrics(candidate, games)]);
    await evals.setMetrics(active.id, activeMetrics);
    await evals.setMetrics(candidate.id, candidateMetrics);
    return { versionId: candidate.id, metrics: candidateMetrics, activeId: active.id, activeMetrics };
  }

  async function refine(job: Job) {
    const model = requireLlm();
    const active = await activeVersion();
    const games = await calibrationGames();
    if (games.length < MIN_REVIEWED_FOR_REFINE) {
      throw new EvaluatorError(400, `Refining needs human reviews on at least ${MIN_REVIEWED_FOR_REFINE} games; there are ${games.length}.`);
    }
    await fillCalibration(job, active, games);

    const [latest, humans, allReviews] = await Promise.all([evals.latestEvaluations(active.id), humanSummaries(), ratings.allReviews()]);
    const rows = games.map((id) => {
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
    const comments = new Map<string, Review[]>(games.flatMap((id) => (allReviews.get(id)?.length ? [[id, allReviews.get(id)!.slice(0, 5)] as const] : [])));
    const anchorText =
      ANCHORS.map((a) => {
        const e = latest.get(a.id);
        return `- ${a.name} (expected ${a.expectation}): ${e ? e.overall.toFixed(2) : 'not scored'}`;
      }).join('\n') || 'None.';

    job.total++;
    const proposal = await model.json<RefineOutput>({
      system: REFINE_SYSTEM,
      user: refineUser(active, rows, comments, fitted, anchorText),
      schema: REFINE_SCHEMA,
      effort: 'high',
    });
    job.done++;

    const reviewed = new Set(games);
    const candidate = await evals.createVersion({
      parentId: active.id,
      status: 'candidate',
      criteria: active.criteria.map((c) => {
        const p = proposal.criteria.find((x) => x.key === c.key);
        if (!p) return c;
        return {
          ...c,
          weight: Math.min(3, Math.max(0, Math.round(p.weight * 100) / 100)),
          descriptors: { 1: p.descriptor_1 || c.descriptors[1], 3: p.descriptor_3 || c.descriptors[3], 5: p.descriptor_5 || c.descriptors[5] },
        };
      }),
      guidance: (proposal.guidance || active.guidance).slice(0, MAX_GUIDANCE_CHARS),
      exemplars: proposal.exemplars.filter((x) => reviewed.has(x.gameId)).slice(0, MAX_EXEMPLARS),
      changelog: proposal.changelog,
    });
    return backtest(job, candidate);
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
          .map(([id, e]) => [id, { overall: e.overall, recommendation: e.recommendation, stale: evidence.get(id)!.codeHash !== e.codeHash, createdAt: e.createdAt }]),
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
        const exemplars = await exemplarContext(version);
        await eachLimited(job, ids, (id) => id, (id) => evaluateGame(id, version, exemplars));
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
  };
}

export type Evaluator = ReturnType<typeof createEvaluator>;
