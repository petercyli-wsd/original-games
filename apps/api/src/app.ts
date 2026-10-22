// HTTP routes for game ratings, reviews and the AI evaluator. Plain node:http
// keeps the service tiny and fast to cold-start on Render's free tier.
//
// Ratings and reviews (public):
//   GET  /health
//   GET  /ratings[?voter=<uuid>]        -> { [gameId]: { average, count, mine? } }
//   GET  /ratings/:gameId?voter=<uuid>  -> RatingDetail (incl. reviews)
//   PUT  /ratings/:gameId  { voterId, stars, comment?, reviewer? } -> RatingDetail
//
// AI evaluator (reads public; actions marked * need the x-admin-key header):
//   GET  /evaluator                      -> status and active prompt version
//   POST /evaluator/admin-check *        -> { ok } to verify a key
//   GET  /evaluator/versions[/:id]
//   POST /evaluator/refine *             -> job: propose a candidate version and backtest it
//   POST /evaluator/versions/:id/backtest *
//   POST /evaluator/versions/:id/promote *
//   GET  /evaluator/agreement            -> human vs AI per game, Spearman, MAE
//   GET  /evaluator/jobs[/:id]
//   GET  /evaluations                    -> { [gameId]: summary } under the active version
//   GET  /evaluations/:gameId            -> full review or null
//   POST /evaluations * { target: gameId | "all" | "missing" } -> job (in-app, flagged)
//
// Claude Code path (scripts/evaluator.ts drives these; all need the admin key):
//   GET  /evaluator/cards/:gameId?hash=  -> cached rules card or null
//   POST /evaluator/judge-prompt *       { gameId|anchorId, card?, facts?, table?, versionId?, pool? } -> prompt
//   POST /evaluations/import *           { gameId|anchorId, versionId?, codeHash, card?, review, checks?, model? }
//   GET  /evaluator/refine-prompt *      -> refine prompt over train games, plus games still to review
//   POST /evaluator/versions *           { proposal } -> candidate version
//   GET  /evaluator/calibration?version= -> what to review to backtest a version
//   POST /evaluator/versions/:id/score * -> recompute agreement metrics from stored reviews

import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { EvaluatorError, type Evaluator } from './evaluator/service.js';
import { MAX_COMMENT_LENGTH, MAX_REVIEWER_LENGTH, summarize, type RatingDetail, type RatingRow } from './shared.js';
import type { RatingsStore } from './store.js';

const GAME_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 8 * 1024;
// Rules cards, reviews and prompts are a few KB each.
const MAX_EVALUATOR_BODY = 128 * 1024;
const REVIEWS_SHOWN = 20;

export interface AppOptions {
  ratings: RatingsStore;
  evaluator?: Evaluator;
  /** Allowed browser origins, or '*' for any. */
  corsOrigins: string[] | '*';
  /** Secret for actions that spend money (AI reviews, refinement). Unset disables them. */
  adminKey?: string;
  /** Writes allowed per client IP per window. */
  writeLimit?: { max: number; windowMs: number };
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Trims, strips control characters (keeping newlines) and caps length. */
function cleanText(value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, 'Text fields must be strings');
  return value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
}

export function createApp({ ratings, evaluator, corsOrigins, adminKey, writeLimit = { max: 60, windowMs: 10 * 60_000 } }: AppOptions): RequestListener {
  const allowWrite = createRateLimiter(writeLimit.max, writeLimit.windowMs);

  async function detail(gameId: string, voterId: string | null): Promise<RatingDetail> {
    const [distribution, mine, myReview, reviews] = await Promise.all([
      ratings.distribution(gameId),
      voterId ? ratings.stars(gameId, voterId) : null,
      voterId ? ratings.review(gameId, voterId) : null,
      ratings.reviews(gameId, REVIEWS_SHOWN),
    ]);
    return { ...summarize(distribution), distribution, mine, myReview, reviews };
  }

  function requireAdmin(req: IncomingMessage) {
    if (!adminKey) throw new HttpError(403, 'Admin actions are off: set ADMIN_KEY on the API service.');
    const given = req.headers['x-admin-key'];
    const a = Buffer.from(typeof given === 'string' ? given : '');
    const b = Buffer.from(adminKey);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, 'Wrong admin key');
  }

  function requireEvaluator(): Evaluator {
    if (!evaluator) throw new HttpError(503, 'The evaluator is not configured on this server.');
    return evaluator;
  }

  const validGameId = (id: string) => {
    if (id.length > 64 || !GAME_ID.test(id)) throw new HttpError(400, 'Invalid game id');
    return id;
  };
  const versionId = (raw: string) => {
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid version id');
    return id;
  };

  async function ratingsRoute(req: IncomingMessage, url: URL, gameId: string | undefined): Promise<unknown> {
    if (!gameId) {
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const voter = url.searchParams.get('voter');
      const [all, mine] = await Promise.all([ratings.distributions(), voter && UUID.test(voter) ? ratings.votesBy(voter) : null]);
      return Object.fromEntries(
        [...all].map(([id, d]): [string, RatingRow] => [id, mine ? { ...summarize(d), mine: mine.get(id) ?? null } : summarize(d)]),
      );
    }
    validGameId(gameId);

    if (req.method === 'GET') {
      const voter = url.searchParams.get('voter');
      return detail(gameId, voter && UUID.test(voter) ? voter : null);
    }

    if (req.method === 'PUT') {
      if (!allowWrite(clientIp(req))) throw new HttpError(429, 'Too many ratings, try again later');
      const body = (await readJson(req)) as Partial<{ voterId: unknown; stars: unknown; comment: unknown; reviewer: unknown }>;
      if (typeof body.voterId !== 'string' || !UUID.test(body.voterId)) throw new HttpError(400, 'Invalid voterId');
      if (!Number.isInteger(body.stars) || (body.stars as number) < 1 || (body.stars as number) > 5) {
        throw new HttpError(400, 'stars must be an integer from 1 to 5');
      }
      const comment = cleanText(body.comment, MAX_COMMENT_LENGTH);
      const reviewer = cleanText(body.reviewer, MAX_REVIEWER_LENGTH);
      await ratings.upsert(gameId, body.voterId, body.stars as number, comment, reviewer);
      return detail(gameId, body.voterId);
    }

    throw new HttpError(405, 'Method not allowed');
  }

  async function evaluatorRoute(req: IncomingMessage, url: URL, parts: string[]): Promise<unknown> {
    const ev = requireEvaluator();
    const [section, id, action] = parts;
    const get = req.method === 'GET';
    const post = req.method === 'POST';

    if (!section && get) return { ...(await ev.status()), adminConfigured: Boolean(adminKey) };
    if (section === 'admin-check' && post) {
      requireAdmin(req);
      return { ok: true };
    }
    if (section === 'agreement' && get) return ev.agreement();
    if (section === 'jobs' && get) {
      if (!id) return ev.jobs();
      const job = ev.job(id);
      if (!job) throw new HttpError(404, 'No such job');
      return job;
    }
    if (section === 'refine' && post && !id) {
      requireAdmin(req);
      return ev.startRefine();
    }
    if (section === 'cards' && id && get) {
      return ev.card(validGameId(id), url.searchParams.get('hash') ?? '');
    }
    if (section === 'judge-prompt' && post && !id) {
      requireAdmin(req);
      return ev.judgePrompt((await readJson(req, MAX_EVALUATOR_BODY)) as Parameters<Evaluator['judgePrompt']>[0]);
    }
    if (section === 'refine-prompt' && get && !id) {
      requireAdmin(req);
      return ev.refinePrompt();
    }
    if (section === 'calibration' && get && !id) {
      const v = url.searchParams.get('version');
      return ev.calibration(v ? versionId(v) : undefined);
    }
    if (section === 'versions') {
      if (!id && get) return ev.versions();
      if (!id && post) {
        requireAdmin(req);
        const body = (await readJson(req, MAX_EVALUATOR_BODY)) as { proposal?: unknown };
        return ev.submitVersion(body.proposal as Parameters<Evaluator['submitVersion']>[0]);
      }
      if (id && action === 'score' && post) {
        requireAdmin(req);
        return ev.scoreVersion(versionId(id));
      }
      if (id && !action && get) return ev.version(versionId(id));
      if (id && action === 'backtest' && post) {
        requireAdmin(req);
        return ev.startBacktest(versionId(id));
      }
      if (id && action === 'promote' && post) {
        requireAdmin(req);
        return ev.promote(versionId(id));
      }
    }
    throw new HttpError(404, 'Not found');
  }

  async function evaluationsRoute(req: IncomingMessage, gameId: string | undefined): Promise<unknown> {
    const ev = requireEvaluator();
    if (req.method === 'GET') return gameId ? ev.view(validGameId(gameId)) : ev.summaries();
    if (req.method === 'POST' && gameId === 'import') {
      requireAdmin(req);
      return ev.importEvaluation((await readJson(req, MAX_EVALUATOR_BODY)) as Parameters<Evaluator['importEvaluation']>[0]);
    }
    if (req.method === 'POST' && !gameId) {
      requireAdmin(req);
      const body = (await readJson(req)) as { target?: unknown };
      const target = typeof body.target === 'string' ? body.target : '';
      if (target !== 'all' && target !== 'missing') validGameId(target);
      return ev.startEvaluate(target);
    }
    throw new HttpError(405, 'Method not allowed');
  }

  async function route(req: IncomingMessage, url: URL): Promise<unknown> {
    const [resource, ...parts] = url.pathname.split('/').filter(Boolean);
    if (req.method === 'GET' && resource === 'health' && !parts.length) return { ok: true };
    if (resource === 'ratings' && parts.length <= 1) return ratingsRoute(req, url, parts[0]);
    if (resource === 'evaluator' && parts.length <= 3) return evaluatorRoute(req, url, parts);
    if (resource === 'evaluations' && parts.length <= 1) return evaluationsRoute(req, parts[0]);
    throw new HttpError(404, 'Not found');
  }

  return async (req, res) => {
    applyCors(req, res, corsOrigins);
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    try {
      send(res, 200, await route(req, new URL(req.url ?? '/', 'http://localhost')));
    } catch (err) {
      if (err instanceof HttpError || err instanceof EvaluatorError) {
        send(res, err.status, { error: err.message });
      } else {
        console.error(err);
        send(res, 500, { error: 'Internal error' });
      }
    }
  };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
}

function applyCors(req: IncomingMessage, res: ServerResponse, origins: string[] | '*') {
  const origin = req.headers.origin;
  if (origins === '*') res.setHeader('access-control-allow-origin', '*');
  else if (origin && origins.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
  }
  res.setHeader('access-control-allow-methods', 'GET, PUT, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, x-admin-key');
  res.setHeader('access-control-max-age', '86400');
}

async function readJson(req: IncomingMessage, limit = MAX_BODY): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
}

// Render sits behind a proxy, so the client is the first X-Forwarded-For hop.
function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

/** Fixed-window limiter; in-memory is fine for a single free instance. */
function createRateLimiter(max: number, windowMs: number) {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return (key: string) => {
    const now = Date.now();
    const w = windows.get(key);
    if (!w || now >= w.resetAt) {
      if (windows.size > 10_000) windows.clear();
      windows.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    return ++w.count <= max;
  };
}
