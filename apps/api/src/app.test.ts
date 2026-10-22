import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type AppOptions } from './app.js';
import { parseOrigins } from './config.js';
import { ANCHORS } from './evaluator/anchors.js';
import { evidenceFrom, measuredChecks, type GameEvidence } from './evaluator/evidence.js';
import type { JsonRequest, Llm } from './evaluator/llm.js';
import { createEvaluator } from './evaluator/service.js';
import { fitWeights, spearman } from './evaluator/stats.js';
import {
  CRITERION_KEYS,
  overallScore,
  rankScore,
  summarize,
  type EvaluationView,
  type EvaluatorStatus,
  type Job,
  type PromptVersion,
  type RatingDetail,
} from './shared.js';
import { createMemoryEvalStore, createMemoryStore } from './store.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const ADMIN = 'test-admin-key';

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
    evidence: evidenceFrom(opts.games ?? [game('alpha'), game('beta'), game('gamma'), game('drift')]),
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
    expect(anon).toEqual({ average: 0, count: 0, distribution: [0, 0, 0, 0, 0], mine: null, myReview: null, reviews: [] });
  });

  it('keeps written reviews when a quick star vote follows', async () => {
    const { base, put } = await start();
    await put('drift', { voterId: A, stars: 4, comment: '  Pro: clear odds.\nCon: slow.\u0007 ', reviewer: 'Peter' });
    await put('drift', { voterId: B, stars: 2 }); // no comment: not listed as a review
    const quick = (await (await put('drift', { voterId: A, stars: 5 })).json()) as RatingDetail;
    expect(quick.myReview).toMatchObject({ stars: 5, comment: 'Pro: clear odds.\nCon: slow.', reviewer: 'Peter' });
    expect(quick.reviews).toHaveLength(1);
    const cleared = (await (await put('drift', { voterId: A, stars: 5, comment: '' })).json()) as RatingDetail;
    expect(cleared.reviews).toHaveLength(0);
    const anon = (await (await fetch(`${base}/ratings/drift`)).json()) as RatingDetail;
    expect(anon.myReview).toBeNull();
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
    expect(status).toMatchObject({ aiEnabled: true, adminConfigured: true, evidenceGames: 4 });
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

  it('refines from human reviews, backtests the candidate and promotes it', async () => {
    const ratings = createMemoryStore();
    // Humans love alpha and dislike the rest.
    for (const [g, stars] of [['alpha', 5], ['beta', 2], ['gamma', 1]] as const) {
      await ratings.upsert(g, A, stars, `${g} review`, 'Peter');
      await ratings.upsert(g, B, stars);
    }
    const { post, getJson, waitJob } = await start({ ratings });

    const job = await waitJob((await (await post('/evaluator/refine')).json()) as Job);
    expect(job.status).toBe('done');
    const { versionId, metrics, activeMetrics } = job.result as { versionId: number; metrics: PromptVersion['metrics']; activeMetrics: PromptVersion['metrics'] };
    expect(versionId).toBe(2);
    expect(metrics).toMatchObject({ humanGames: 3, anchorsTotal: ANCHORS.length });
    expect(metrics!.spearman).toBeGreaterThan(0.8);
    expect(activeMetrics!.anchorsPassed).toBe(ANCHORS.length);

    const candidate = await getJson<PromptVersion>('/evaluator/versions/2');
    expect(candidate).toMatchObject({ status: 'candidate', parentId: 1, guidance: 'New guidance.' });
    expect(candidate.exemplars.map((x) => x.gameId)).toEqual(['alpha']); // unreviewed ids dropped

    expect((await post('/evaluator/versions/2/promote')).status).toBe(200);
    const status = await getJson<EvaluatorStatus>('/evaluator');
    expect(status.activeVersion?.id).toBe(2);
    const agreement = await getJson<{ rows: unknown[]; spearman: number }>('/evaluator/agreement');
    expect(agreement.rows).toHaveLength(3);
  });

  it('refuses to refine without enough reviewed games', async () => {
    const ratings = createMemoryStore();
    await ratings.upsert('alpha', C, 4);
    const { post, waitJob } = await start({ ratings });
    const job = await waitJob((await (await post('/evaluator/refine')).json()) as Job);
    expect(job.status).toBe('error');
    expect(job.errors[0]).toMatch(/at least 3 games/);
  });

  it('runs one paid job at a time', async () => {
    const { post, waitJob } = await start({ delayMs: 30 });
    const first = (await (await post('/evaluations', { target: 'all' })).json()) as Job;
    expect((await post('/evaluations', { target: 'alpha' })).status).toBe(409);
    expect(await waitJob(first)).toMatchObject({ status: 'done', total: 4, done: 4 });
  });
});

describe('helpers', () => {
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
