import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type AppOptions } from './app.js';
import { parseOrigins } from './config.js';
import { ANCHORS } from './evaluator/anchors.js';
import { evidenceFrom, measuredChecks, type GameEvidence } from './evaluator/evidence.js';
import { DEFAULT_CRITERIA } from './evaluator/rubric.js';
import type { JsonRequest, Llm } from './evaluator/llm.js';
import { createEvaluator } from './evaluator/service.js';
import { fitWeights, spearman } from './evaluator/stats.js';
import {
  CRITERION_KEYS,
  overallScore,
  rankScore,
  reviewerWeight,
  summarize,
  type EvaluationView,
  type EvaluatorStatus,
  type Job,
  type PromptVersion,
  type FeedReview,
  type RatingDetail,
} from './shared.js';
import { createMemoryEvalStore, createMemoryStore } from './store.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const ADMIN = 'test-admin-key';
const DEFAULT_WEIGHT_TOTAL = DEFAULT_CRITERIA.reduce((s, c) => s + c.weight, 0);

let server: Server | undefined;
afterEach(() => server?.close());

function game(id: string, extra: Partial<GameEvidence['manifest']> = {}): GameEvidence {
  return {
    id,
    manifest: { id, name: id.toUpperCase(), tagline: `${id} tagline`, mechanic: 'geometry', status: 'prototype', rtp: 0.99, maxMultiplier: 10, volatility: ['low', 'high'], checkpoints: true, ...extra },
    codeHash: `hash-${id}`,
    files: [{ path: 'math.ts', content: `// ${id}` }],
    eval: [
      { label: 'low', rounds: 1000, rtp: 0.99, stdError: 0.01, hitRate: 0.8, stdDev: 0.5, p50: 1, p99: 2, max: 2, avgSteps: 3 },
      { label: 'high', rounds: 1000, rtp: 0.985, stdError: 0.02, hitRate: 0.1, stdDev: 4, p50: 0, p99: 9, max: 10, avgSteps: 2 },
    ],
  };
}

/** A fake Claude: rules cards echo the request; judge scores come from `scoreFor(name)`. */
function fakeLlm(scoreFor: (name: string) => number, delayMs = 0) {
  const calls: JsonRequest[] = [];
  const llm: Llm = {
    model: 'fake-model',
    async json<T>(req: JsonRequest): Promise<T> {
      calls.push(req);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const props = req.schema.properties as Record<string, unknown>;
      if ('concept' in props) {
        return { concept: 'c', win_condition: 'w', odds_display: 'o', volatility_controls: 'v', checkpoints: 'k', round_flow: 'r', maths_family: 'm', dynamics: ['ladder'], theme_dependence: 't', closest_known_games: [] } as T;
      }
      if ('changelog' in props) {
        return {
          changelog: 'Weighted odds legibility higher.',
          guidance: 'New guidance.',
          criteria: CRITERION_KEYS.map((key) => ({ key, weight: key === 'odds_legibility' ? 3 : 1, descriptor_1: 'd1', descriptor_3: 'd3', descriptor_5: 'd5' })),
          exemplars: [{ gameId: 'alpha', note: 'Reference high' }, { gameId: 'not-reviewed', note: 'dropped' }],
        } as T;
      }
      const name = /Evaluate the game "([^"]+)"/.exec(req.user)?.[1] ?? '';
      const s = scoreFor(name);
      return {
        criteria: CRITERION_KEYS.map((key) => ({ key, reasoning: `because ${key}`, score: s })),
        pros: ['p'],
        cons: ['c'],
        closest_existing: 'Mines',
        duplicate_of: '',
        verdict: 'ok',
        recommendation: s >= 4 ? 'ship' : 'iterate',
      } as T;
    },
  };
  return { llm, calls };
}

async function start(opts: Partial<AppOptions> & { scoreFor?: (name: string) => number; games?: GameEvidence[]; delayMs?: number } = {}) {
  const ratings = opts.ratings ?? createMemoryStore();
  const fake = fakeLlm(
    opts.scoreFor ?? ((name) => (name.includes('Russian') || name.includes('Mines') || name.includes('Crash') || name.includes('Dice') ? 5 : name === 'ALPHA' ? 5 : 2)),
    opts.delayMs,
  );
  const evaluator = createEvaluator({
    llm: fake.llm,
    evals: createMemoryEvalStore(),
    ratings,
    evidence: evidenceFrom(opts.games ?? [game('alpha'), game('beta'), game('gamma'), game('delta'), game('drift')]),
  });
  server = createServer(createApp({ ratings, evaluator, corsOrigins: '*', adminKey: ADMIN, ...opts }));
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const put = (g: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/ratings/${g}`, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
  const post = (path: string, body: unknown = {}, key: string | null = ADMIN) =>
    fetch(`${base}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(key ? { 'x-admin-key': key } : {}) } });
  const getJson = async <T>(path: string) => (await (await fetch(`${base}${path}`)).json()) as T;
  const waitJob = async (job: Job) => {
    for (let i = 0; i < 200; i++) {
      const j = await getJson<Job>(`/evaluator/jobs/${job.id}`);
      if (j.status !== 'running') return j;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('job did not finish');
  };
  return { base, put, post, getJson, waitJob, calls: fake.calls };
}

describe('ratings API', () => {
  it('reports health', async () => {
    const { base } = await start();
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
  });

  it('stores one rating per voter and aggregates per game', async () => {
    const { base, put } = await start();
    await put('drift', { voterId: A, stars: 5 });
    await put('drift', { voterId: B, stars: 2 });
    const res = (await (await put('drift', { voterId: A, stars: 4 })).json()) as RatingDetail; // A changes their mind
    expect(res).toMatchObject({ average: 3, count: 2, distribution: [0, 1, 0, 1, 0], mine: 4 });

    await put('slice', { voterId: B, stars: 1 });
    expect(await (await fetch(`${base}/ratings`)).json()).toEqual({
      drift: { average: 3, count: 2 },
      slice: { average: 1, count: 1 },
    });
    const rows = await (await fetch(`${base}/ratings?voter=${A}`)).json();
    expect(rows).toEqual({ drift: { average: 3, count: 2, mine: 4 }, slice: { average: 1, count: 1, mine: null } });

    const mine = (await (await fetch(`${base}/ratings/drift?voter=${B}`)).json()) as RatingDetail;
    expect(mine.mine).toBe(2);
    const anon = await (await fetch(`${base}/ratings/unrated`)).json();
    expect(anon).toEqual({ average: 0, count: 0, distribution: [0, 0, 0, 0, 0], facets: {}, mine: null, myReview: null, reviews: [] });
  });

  it('stores per-facet scores, keeps them on quick votes and averages them per game', async () => {
    const { base, put } = await start();
    await put('drift', { voterId: A, stars: 4, facets: { pace: 5, odds_legibility: 4 } });
    await put('drift', { voterId: B, stars: 2, facets: { pace: 3, fun: 2, uniqueness: null } });
    await put('drift', { voterId: A, stars: 5 }); // quick vote keeps A's facets
    const detail = (await (await fetch(`${base}/ratings/drift?voter=${A}`)).json()) as RatingDetail;
    expect(detail.myReview?.facets).toEqual({ pace: 5, odds_legibility: 4 });
    expect(detail.facets).toEqual({ pace: { average: 4, count: 2 }, odds_legibility: { average: 4, count: 1 }, fun: { average: 2, count: 1 } });
    const rows = (await (await fetch(`${base}/ratings`)).json()) as Record<string, { facets?: object }>;
    expect(rows.drift.facets).toMatchObject({ pace: { average: 4, count: 2 } });

    expect((await put('drift', { voterId: A, stars: 3, facets: { pace: 6 } })).status).toBe(400);
    expect((await put('drift', { voterId: A, stars: 3, facets: { speed: 3 } })).status).toBe(400);
    expect((await put('drift', { voterId: A, stars: 3, facets: [3] })).status).toBe(400);
  });

  it('keeps written reviews when a quick star vote follows', async () => {
    const { base, put } = await start();
    await put('drift', { voterId: A, stars: 4, comment: '  Pro: clear odds.\nCon: slow.\u0007 ', reviewer: 'Peter' });
    await put('drift', { voterId: B, stars: 2 });
    const quick = (await (await put('drift', { voterId: A, stars: 5 })).json()) as RatingDetail;
    expect(quick.myReview).toMatchObject({ stars: 5, comment: 'Pro: clear odds.\nCon: slow.', reviewer: 'Peter' });
    const cleared = (await (await put('drift', { voterId: A, stars: 5, comment: '' })).json()) as RatingDetail;
    expect(cleared.myReview?.comment).toBe('');
    const anon = (await (await fetch(`${base}/ratings/drift`)).json()) as RatingDetail;
    expect(anon.myReview).toBeNull();
  });

  it("lists everyone else's reviews, written or not, and a feed across games", async () => {
    const { base, put } = await start();
    await put('drift', { voterId: A, stars: 4, comment: 'Clear odds.', reviewer: 'Peter' });
    await put('drift', { voterId: B, stars: 2, facets: { pace: 2 } }); // stars and a facet only: still a review
    await put('slice', { voterId: B, stars: 5, comment: 'Fun.', reviewer: 'Sam' });

    const forA = (await (await fetch(`${base}/ratings/drift?voter=${A}`)).json()) as RatingDetail;
    expect(forA.reviews).toEqual([expect.objectContaining({ stars: 2, comment: '', facets: { pace: 2 } })]); // A's own is left out
    const forAnyone = (await (await fetch(`${base}/ratings/drift`)).json()) as RatingDetail;
    expect(forAnyone.reviews.map((r) => r.stars)).toEqual([2, 4]); // newest first

    const feed = (await (await fetch(`${base}/reviews?voter=${B}`)).json()) as FeedReview[];
    expect(feed.map((r) => [r.gameId, r.stars, r.mine])).toEqual([
      ['slice', 5, true],
      ['drift', 2, true],
      ['drift', 4, false],
    ]);
    expect((await fetch(`${base}/reviews`, { method: 'POST' })).status).toBe(405);
  });

  it('rejects bad input', async () => {
    const { base, put } = await start();
    expect((await put('drift', { voterId: A, stars: 6 })).status).toBe(400);
    expect((await put('drift', { voterId: A, stars: 2.5 })).status).toBe(400);
    expect((await put('drift', { voterId: 'nope', stars: 3 })).status).toBe(400);
    expect((await put('drift', { voterId: A, stars: 3, comment: 42 })).status).toBe(400);
    expect((await put('Bad_Id', { voterId: A, stars: 3 })).status).toBe(400);
    expect((await fetch(`${base}/ratings/drift`, { method: 'PUT', body: '{oops' })).status).toBe(400);
    expect((await fetch(`${base}/ratings/drift`, { method: 'PUT', body: 'x'.repeat(9000) })).status).toBe(413);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/ratings`, { method: 'PUT' })).status).toBe(405);
  });

  it('rate-limits writes per client', async () => {
    const { put } = await start({ writeLimit: { max: 2, windowMs: 60_000 } });
    const ip = { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' };
    expect((await put('drift', { voterId: A, stars: 3 }, ip)).status).toBe(200);
    expect((await put('drift', { voterId: A, stars: 4 }, ip)).status).toBe(200);
    expect((await put('drift', { voterId: A, stars: 5 }, ip)).status).toBe(429);
    expect((await put('drift', { voterId: A, stars: 5 }, { 'x-forwarded-for': '198.51.100.1' })).status).toBe(200);
  });

  it('only echoes allowed CORS origins', async () => {
    const { base } = await start({ corsOrigins: ['https://site.example'] });
    const ok = await fetch(`${base}/ratings`, { headers: { origin: 'https://site.example' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://site.example');
    const other = await fetch(`${base}/ratings`, { headers: { origin: 'https://evil.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    expect((await fetch(`${base}/ratings/drift`, { method: 'OPTIONS' })).status).toBe(204);
  });
});

describe('evaluator API', () => {
  it('seeds version 1 and reports status', async () => {
    const { getJson } = await start();
    const status = await getJson<EvaluatorStatus>('/evaluator');
    expect(status).toMatchObject({ aiEnabled: true, adminConfigured: true, evidenceGames: 5 });
    expect(status.activeVersion?.id).toBe(1);
    expect(status.activeVersion?.criteria).toHaveLength(CRITERION_KEYS.length);
  });

  it('guards paid actions with the admin key', async () => {
    const { post } = await start();
    expect((await post('/evaluations', { target: 'alpha' }, null)).status).toBe(401);
    expect((await post('/evaluations', { target: 'alpha' }, 'wrong')).status).toBe(401);
    expect((await post('/evaluator/admin-check')).status).toBe(200);
    expect((await post('/evaluations', { target: 'nope' })).status).toBe(404);
  });

  it('reviews a game, caches its rules card and weights the overall score', async () => {
    const { post, getJson, waitJob, calls } = await start({ scoreFor: () => 4 });
    const job = await waitJob((await (await post('/evaluations', { target: 'alpha' })).json()) as Job);
    expect(job).toMatchObject({ status: 'done', total: 1, done: 1, failed: 0 });

    const view = await getJson<EvaluationView>('/evaluations/alpha');
    expect(view).toMatchObject({ gameId: 'alpha', versionId: 1, overall: 4, recommendation: 'ship', stale: false, model: 'fake-model' });
    expect(view.rulesCard?.concept).toBe('c');
    expect(view.checks.map((c) => c.key)).toEqual(['rtp', 'volatility_spread', 'round_length', 'checkpoints']);
    expect(await getJson('/evaluations')).toMatchObject({ alpha: { overall: 4 } });

    // A second review reuses the cached rules card: one judge call, no extract call.
    await waitJob((await (await post('/evaluations', { target: 'alpha' })).json()) as Job);
    const extracts = calls.filter((c) => 'concept' in (c.schema.properties as object));
    expect(extracts).toHaveLength(1);
    expect(await getJson('/evaluations/beta')).toBeNull();
  });

  it('refines from train games only, backtests the candidate and promotes it', async () => {
    const ratings = createMemoryStore();
    // Humans love alpha and dislike the rest. beta falls in the holdout split.
    for (const [g, stars] of [['alpha', 5], ['beta', 2], ['gamma', 1], ['delta', 2]] as const) {
      await ratings.upsert(g, A, stars, `${g} review`, 'Peter');
      await ratings.upsert(g, B, stars);
    }
    const { post, getJson, waitJob, calls } = await start({ ratings });

    const job = await waitJob((await (await post('/evaluator/refine')).json()) as Job);
    expect(job.status).toBe('done');
    const { versionId, metrics, activeMetrics } = job.result as { versionId: number; metrics: PromptVersion['metrics']; activeMetrics: PromptVersion['metrics'] };
    expect(versionId).toBe(2);
    // Benchmarks: the three games the team rated low (beta, gamma, delta) must not score high.
    expect(metrics).toMatchObject({ humanGames: 4, anchorsTotal: 3, holdout: { games: 1 } });
    expect(metrics!.spearman).toBeGreaterThan(0.8);
    expect(activeMetrics!.anchorsPassed).toBe(3);

    // The refiner never sees the held-out game or its review.
    const refineCall = calls.find((c) => 'changelog' in (c.schema.properties as object))!;
    expect(refineCall.user).toContain('| alpha |');
    expect(refineCall.user).not.toContain('beta');

    const candidate = await getJson<PromptVersion>('/evaluator/versions/2');
    expect(candidate).toMatchObject({ status: 'candidate', parentId: 1, guidance: 'New guidance.' });
    expect(candidate.exemplars.map((x) => x.gameId)).toEqual(['alpha']); // unreviewed ids dropped

    expect((await post('/evaluator/versions/2/promote')).status).toBe(200);
    const status = await getJson<EvaluatorStatus>('/evaluator');
    expect(status.activeVersion?.id).toBe(2);
    const agreement = await getJson<{ rows: unknown[]; spearman: number }>('/evaluator/agreement');
    expect(agreement.rows).toHaveLength(4);
  });

  it('refuses to refine without enough reviewed games', async () => {
    const ratings = createMemoryStore();
    await ratings.upsert('alpha', C, 4);
    const { post, waitJob } = await start({ ratings });
    const job = await waitJob((await (await post('/evaluator/refine')).json()) as Job);
    expect(job.status).toBe('error');
    expect(job.errors[0]).toMatch(/at least 3 training games/);
  });

  it('runs one paid job at a time', async () => {
    const { post, waitJob } = await start({ delayMs: 30 });
    const first = (await (await post('/evaluations', { target: 'all' })).json()) as Job;
    expect((await post('/evaluations', { target: 'alpha' })).status).toBe(409);
    expect(await waitJob(first)).toMatchObject({ status: 'done', total: 5, done: 5 });
  });
});

describe('calibration strategy', () => {
  it('never shows a game its own reviews, and pins the scale with the top and bottom games', async () => {
    const ratings = createMemoryStore();
    for (const [g, stars] of [['alpha', 5], ['gamma', 1], ['delta', 3], ['drift', 2]] as const) await ratings.upsert(g, A, stars, `${g} comment`);
    const { post, waitJob, calls } = await start({ ratings });
    await waitJob((await (await post('/evaluations', { target: 'alpha' })).json()) as Job);
    const judge = calls.find((c) => c.user.includes('Evaluate the game "ALPHA"'))!;
    expect(judge.user).not.toContain('ALPHA (team');
    expect(judge.user).toContain('GAMMA (team: 1.0/5 from 1 review)');
    expect(judge.user).toMatch(/GAMMA[^\n]*lowest-rated game/);
    expect(judge.user).toMatch(/DELTA[^\n]*highest-rated game/);
    // References and per-game facts go in the user message; the system prompt is shared.
    expect(judge.system).not.toContain('gamma comment');
  });
});

describe('Claude Code path', () => {
  const card = { concept: 'c', win_condition: 'w', odds_display: 'o', volatility_controls: 'v', checkpoints: 'k', round_flow: 'r', maths_family: 'm', dynamics: ['ladder'], theme_dependence: 't', closest_known_games: [] };
  const review = {
    criteria: CRITERION_KEYS.map((key) => ({ key, reasoning: 'r', score: key === 'odds_legibility' ? 5 : 3 })),
    pros: ['p'],
    cons: ['c'],
    closest_existing: 'Mines',
    duplicate_of: '',
    verdict: 'v',
    recommendation: 'iterate',
  };

  it('shows no references until at least 3 other games are reviewed', async () => {
    const ratings = createMemoryStore();
    for (const g of ['beta', 'gamma']) await ratings.upsert(g, A, 5, 'test review');
    const { post } = await start({ ratings });
    const p = (await (await post('/evaluator/judge-prompt', { gameId: 'alpha', card })).json()) as { user: string; references: number };
    expect(p.references).toBe(0);
    expect(p.user).toContain('None yet');
  });

  it('serves prompts and imports reviews made in Claude Code', async () => {
    const { post, getJson, base } = await start();
    const prompt = (await (await post('/evaluator/judge-prompt', { gameId: 'alpha', card })).json()) as { system: string; user: string; versionId: number };
    expect(prompt.versionId).toBe(1);
    expect(prompt.system).toContain('## Rubric');
    expect(prompt.user).toContain('Evaluate the game "ALPHA"');

    const imported = await post('/evaluations/import', { gameId: 'alpha', codeHash: 'hash-alpha', card, review, model: 'claude-code (Opus)' });
    expect(imported.status).toBe(200);
    const view = await getJson<EvaluationView>('/evaluations/alpha');
    // Weighted: odds_legibility 5 at weight 3, the other eight criteria 3.
    const others = DEFAULT_WEIGHT_TOTAL - 3;
    expect(view.overall).toBeCloseTo((5 * 3 + 3 * others) / DEFAULT_WEIGHT_TOTAL, 5);
    expect(view).toMatchObject({ model: 'claude-code (Opus)', recommendation: 'iterate', stale: false });
    const summaries = await getJson<Record<string, { facets: Record<string, number> }>>('/evaluations');
    expect(summaries.alpha.facets).toMatchObject({ odds_legibility: 5, pace: 3 });
    expect(view.rulesCard?.concept).toBe('c');
    expect(await (await fetch(`${base}/evaluator/cards/alpha?hash=hash-alpha`)).json()).toMatchObject({ concept: 'c' });

    const bad = await post('/evaluations/import', { gameId: 'alpha', codeHash: 'h', review: { ...review, criteria: review.criteria.slice(1) } });
    expect(bad.status).toBe(400);
    expect((await post('/evaluations/import', { gameId: 'alpha', codeHash: 'h', review }, null)).status).toBe(401);

    const anchorPrompt = (await (await post('/evaluator/judge-prompt', { anchorId: ANCHORS[0].id })).json()) as { user: string };
    expect(anchorPrompt.user).toContain(ANCHORS[0].name);

    // Classics are flagged to the judge as the benchmark.
    const classic = (await (await post('/evaluator/judge-prompt', { gameId: 'alpha', card, collection: 'classics' })).json()) as { user: string };
    expect(classic.user).toContain('Standing: A proven casino classic');
    expect(prompt.user).toContain('Standing: A new prototype');
  });

  it('accepts a hand-written prompt version without team reviews', async () => {
    const { post } = await start();
    const version = { criteria: DEFAULT_CRITERIA, guidance: 'Calibrated guidance.', changelog: 'v2 calibration' };
    const created = (await (await post('/evaluator/versions', { version })).json()) as PromptVersion;
    expect(created).toMatchObject({ id: 2, status: 'candidate', parentId: 1, guidance: 'Calibrated guidance.' });
    const broken = await post('/evaluator/versions', { version: { ...version, criteria: DEFAULT_CRITERIA.slice(1) } });
    expect(broken.status).toBe(400);
    expect((await post('/evaluator/versions/2/promote')).status).toBe(200);
  });

  it('runs refine, calibration and scoring without in-app AI', async () => {
    const ratings = createMemoryStore();
    for (const [g, stars] of [['alpha', 5], ['beta', 2], ['gamma', 1], ['delta', 2]] as const) await ratings.upsert(g, A, stars, 'comment');
    const { post, getJson, base } = await start({ ratings });

    expect((await getJson<{ error?: string }>('/evaluator/refine-prompt')).error).toBe('Wrong admin key');
    const rp = (await (await fetch(`${base}/evaluator/refine-prompt`, { headers: { 'x-admin-key': ADMIN } })).json()) as { train: string[]; holdout: string[]; missing: string[] };
    expect([...rp.train].sort()).toEqual(['alpha', 'delta', 'gamma']);
    expect(rp.holdout).toEqual(['beta']);
    expect([...rp.missing].sort()).toEqual(['alpha', 'delta', 'gamma']);

    const proposal = {
      changelog: 'x',
      guidance: 'g',
      criteria: CRITERION_KEYS.map((key) => ({ key, weight: 2, descriptor_1: 'a', descriptor_3: 'b', descriptor_5: 'c' })),
      exemplars: [
        { gameId: 'beta', note: 'held out, so dropped' },
        { gameId: 'gamma', note: 'ok' },
      ],
    };
    const candidate = (await (await post('/evaluator/versions', { proposal })).json()) as PromptVersion;
    expect(candidate).toMatchObject({ id: 2, status: 'candidate', parentId: 1 });
    expect(candidate.exemplars.map((x) => x.gameId)).toEqual(['gamma']);

    const cal = await getJson<{ todo: { games: string[]; anchors: unknown[] } }>('/evaluator/calibration?version=2');
    expect(cal.todo.games).toHaveLength(4);
    expect(cal.todo.anchors).toHaveLength(0); // text anchors are retired: they can't be played blind
    for (const g of ['alpha', 'beta', 'gamma', 'delta']) {
      await post('/evaluations/import', { gameId: g, versionId: 2, codeHash: `hash-${g}`, review });
    }
    const scored = (await (await post('/evaluator/versions/2/score')).json()) as { metrics: PromptVersion['metrics'] };
    expect(scored.metrics).toMatchObject({ humanGames: 4, holdout: { games: 1 } });
  });
});

describe('blind player reviews', () => {
  const card = { concept: 'c', win_condition: 'w', odds_display: 'o', volatility_controls: 'v', checkpoints: 'k', round_flow: 'r', maths_family: 'm', dynamics: ['ladder'], theme_dependence: 't', closest_known_games: [] };
  const playerKeys = DEFAULT_CRITERIA.filter((c) => c.judge === 'player').map((c) => c.key);
  const designerKeys = CRITERION_KEYS.filter((k) => !playerKeys.includes(k));
  const player = {
    first_impression: 'a slider game',
    understanding: { win_condition: 'roll over the line', how_it_works: 'pick a line, roll', odds: 'the green share', settings: 'the slider', confidence: 'sure' },
    criteria: playerKeys.map((key) => ({ key, reasoning: 'seen', score: 5 })),
    confusions: ['what the blue box does'],
  };
  const designer = (comprehension: string) => ({
    criteria: designerKeys.map((key) => ({ key, reasoning: 'r', score: 4 })),
    pros: ['p'],
    cons: ['c'],
    closest_existing: 'Dice',
    duplicate_of: '',
    verdict: 'v',
    recommendation: 'ship',
    player_comprehension: comprehension,
    comprehension_reasoning: 'they thought it was over/under only',
  });

  it('serves a UI-only player prompt and a designer prompt that sees what the player understood', async () => {
    const { post } = await start();
    const pp = (await (await post('/evaluator/player-prompt', { gameId: 'alpha', tool: 'npm run evaluator -- play g-abc123' })).json()) as { system: string; user: string; schema: { properties: { criteria: { items: { properties: { key: { enum: string[] } } } } } } };
    expect(pp.system).toContain('no description, rules or source code');
    expect(pp.user).toContain('npm run evaluator -- play g-abc123');
    expect(pp.user).not.toContain('alpha'); // never told which game it is
    // No designer or benchmark guidance: it names games and says how they should score.
    expect(pp.system).not.toMatch(/Benchmarks|Designer judge/);
    expect(pp.system).toContain('Player judge');
    expect(pp.schema.properties.criteria.items.properties.key.enum.sort()).toEqual([...playerKeys].sort());

    const jp = (await (await post('/evaluator/judge-prompt', { gameId: 'alpha', card, player })).json()) as { system: string; user: string; schema: { required: string[]; properties: { criteria: { items: { properties: { key: { enum: string[] } } } } } } };
    expect(jp.user).toContain('What wins: roll over the line');
    expect(jp.system).toContain('## The player test');
    expect(jp.schema.required).toContain('player_comprehension');
    expect(jp.schema.properties.criteria.items.properties.key.enum.sort()).toEqual([...designerKeys].sort());
  });

  it('merges both judges and caps clarity when the blind player misread the game', async () => {
    const { post, getJson } = await start();
    expect((await post('/evaluations/import', { gameId: 'alpha', codeHash: 'hash-alpha', card, player, review: designer('correct') })).status).toBe(200);
    const good = await getJson<EvaluationView>('/evaluations/alpha');
    expect(Object.fromEntries(good.criteria.map((c) => [c.key, c.score]))).toMatchObject({ win_clarity: 5, simplicity: 5, uniqueness: 4 });
    expect(good.cons.some((c) => c.includes('blue box'))).toBe(true);

    await post('/evaluations/import', { gameId: 'beta', codeHash: 'hash-beta', card, player, review: designer('wrong') });
    const misread = await getJson<EvaluationView>('/evaluations/beta');
    const scores = Object.fromEntries(misread.criteria.map((c) => [c.key, c.score]));
    expect(scores).toMatchObject({ win_clarity: 2, simplicity: 2, odds_legibility: 5 });
    expect(misread.overall).toBeLessThanOrEqual(3); // clarity cap: capFor(2)
    expect(misread.cons[misread.cons.length - 2]).toMatch(/blind player misread it \(wrong\)/);

    // A game decided by a pattern, which nobody knows from a casino, is capped from the player's checks.
    const checks = { outcome: 'pattern', known_casino_game: false, odds_source: 'trust', reasoning: 'r' };
    await post('/evaluations/import', { gameId: 'gamma', codeHash: 'hash-gamma', card, player: { ...player, checks }, review: designer('correct') });
    const pattern = Object.fromEntries((await getJson<EvaluationView>('/evaluations/gamma')).criteria.map((c) => [c.key, c.score]));
    expect(pattern).toMatchObject({ win_clarity: 2, odds_legibility: 2, simplicity: 3 });
    // The same answers for a known casino game only cap the odds a number shows on trust.
    await post('/evaluations/import', { gameId: 'delta', codeHash: 'hash-delta', card, player: { ...player, checks: { ...checks, known_casino_game: true } }, review: designer('correct') });
    const known = Object.fromEntries((await getJson<EvaluationView>('/evaluations/delta')).criteria.map((c) => [c.key, c.score]));
    expect(known).toMatchObject({ win_clarity: 5, odds_legibility: 4, simplicity: 5 });

    // A player review missing a criterion is rejected.
    const bad = await post('/evaluations/import', { gameId: 'alpha', codeHash: 'h', card, player: { ...player, criteria: player.criteria.slice(1) }, review: designer('correct') });
    expect(bad.status).toBe(400);
  });

  it('calibrates against weighted team scores: Pierre counts 3×', async () => {
    const ratings = createMemoryStore();
    await ratings.upsert('alpha', A, 2, 'too fiddly', 'Pierre');
    await ratings.upsert('alpha', B, 5, 'love it', 'Peter');
    const { getJson } = await start({ ratings });
    const agreement = await getJson<{ rows: { gameId: string; humanAverage: number; humanCount: number }[] }>('/evaluator/agreement');
    expect(agreement.rows.find((r) => r.gameId === 'alpha')).toMatchObject({ humanAverage: 2.75, humanCount: 2 });
  });
});

describe('helpers', () => {
  it('caps the overall by clarity and, for prototypes, by uniqueness', () => {
    const s = (scores: Partial<Record<(typeof CRITERION_KEYS)[number], number>>) =>
      CRITERION_KEYS.map((key) => ({ key, score: scores[key] ?? 5, reasoning: '' }));
    expect(overallScore(s({}), DEFAULT_CRITERIA)).toBe(5);
    // Brilliant everywhere except an unreadable win condition: capped at 2.25.
    expect(overallScore(s({ win_clarity: 1 }), DEFAULT_CRITERIA)).toBe(2.25);
    // A reskin prototype is capped; the same scores on a classic are not.
    expect(overallScore(s({ uniqueness: 1 }), DEFAULT_CRITERIA)).toBe(2.25);
    expect(overallScore(s({ uniqueness: 1 }), DEFAULT_CRITERIA, { classic: true })).toBeGreaterThan(4.5);
    expect(overallScore(s({}), DEFAULT_CRITERIA, { duplicate: true })).toBe(2.25);
    // Dead structure gates prototypes (some → 3, most → 2.25), never classics.
    expect(overallScore(s({}), DEFAULT_CRITERIA, { deadStructure: 'none' })).toBe(5);
    expect(overallScore(s({}), DEFAULT_CRITERIA, { deadStructure: 'some' })).toBe(3);
    expect(overallScore(s({}), DEFAULT_CRITERIA, { deadStructure: 'most' })).toBe(2.25);
    expect(overallScore(s({}), DEFAULT_CRITERIA, { deadStructure: 'most', classic: true })).toBe(5);
    expect(reviewerWeight('pierre W')).toBe(3);
    expect(reviewerWeight('Peter')).toBe(1);
  });

  it('summarizes distributions', () => {
    expect(summarize([0, 0, 0, 0, 0])).toEqual({ average: 0, count: 0 });
    expect(summarize([1, 0, 0, 0, 3])).toEqual({ average: 4, count: 4 });
  });

  it('ranks well-supported ratings above a lone 5 star', () => {
    expect(rankScore({ average: 4.5, count: 10 })).toBeGreaterThan(rankScore({ average: 5, count: 1 }));
    expect(rankScore({ average: 0, count: 0 })).toBe(3);
  });

  it('parses CORS origins', () => {
    expect(parseOrigins('*')).toBe('*');
    expect(parseOrigins('original-games.onrender.com, http://localhost:5173/')).toEqual([
      'https://original-games.onrender.com',
      'http://localhost:5173',
    ]);
  });

  it('weights the overall score and skips zero weights', () => {
    const scores = [
      { key: 'odds_legibility' as const, score: 5, reasoning: '' },
      { key: 'fun' as const, score: 1, reasoning: '' },
    ];
    const defs = (w1: number, w2: number) => [
      { key: 'odds_legibility' as const, name: '', question: '', weight: w1, descriptors: { 1: '', 3: '', 5: '' } },
      { key: 'fun' as const, name: '', question: '', weight: w2, descriptors: { 1: '', 3: '', 5: '' } },
    ];
    expect(overallScore(scores, defs(3, 1))).toBe(4);
    expect(overallScore(scores, defs(1, 0))).toBe(5);
  });

  it('computes rank agreement and fits weights to human scores', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
    expect(spearman([1, 2], [1, 2])).toBeNull();
    // Humans track feature 0 only.
    const X = Array.from({ length: 12 }, (_, i) => [1 + (i % 5), 1 + ((i * 3) % 5)]);
    const w = fitWeights(X, X.map((r) => r[0]), ['a', 'b'])!;
    expect(w.a).toBe(3);
    expect(w.b).toBeLessThan(0.5);
    expect(fitWeights(X.slice(0, 5), [1, 2, 3, 4, 5], ['a', 'b'])).toBeNull();
  });

  it('measures RTP, volatility spread and round length', () => {
    const checks = measuredChecks(game('alpha'));
    expect(Object.fromEntries(checks.map((c) => [c.key, c.pass]))).toEqual({ rtp: true, volatility_spread: true, round_length: true, checkpoints: true });
    const flat = game('flat');
    flat.eval = [flat.eval![0]];
    expect(measuredChecks(flat).find((c) => c.key === 'volatility_spread')?.pass).toBe(false);
  });
});
