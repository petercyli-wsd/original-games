// HTTP routes for game ratings. Plain node:http keeps the service tiny and
// fast to cold-start on Render's free tier.
//
//   GET  /health
//   GET  /ratings[?voter=<uuid>]        -> { [gameId]: { average, count, mine? } }
//   GET  /ratings/:gameId?voter=<uuid>  -> { average, count, distribution, mine }
//   PUT  /ratings/:gameId  { voterId, stars } -> same as GET

import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { summarize, type RatingDetail, type RatingRow } from './shared.js';
import type { RatingsStore } from './store.js';

const GAME_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 1024;

export interface AppOptions {
  /** Allowed browser origins, or '*' for any. */
  corsOrigins: string[] | '*';
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

export function createApp(store: RatingsStore, { corsOrigins, writeLimit = { max: 60, windowMs: 10 * 60_000 } }: AppOptions): RequestListener {
  const allowWrite = createRateLimiter(writeLimit.max, writeLimit.windowMs);

  async function detail(gameId: string, voterId: string | null): Promise<RatingDetail> {
    const [distribution, mine] = await Promise.all([store.distribution(gameId), voterId ? store.stars(gameId, voterId) : null]);
    return { ...summarize(distribution), distribution, mine };
  }

  async function route(req: IncomingMessage, url: URL): Promise<unknown> {
    const [resource, gameId, ...rest] = url.pathname.split('/').filter(Boolean);
    if (req.method === 'GET' && resource === 'health' && !gameId) return { ok: true };
    if (resource !== 'ratings' || rest.length) throw new HttpError(404, 'Not found');

    if (!gameId) {
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const voter = url.searchParams.get('voter');
      const [all, mine] = await Promise.all([store.distributions(), voter && UUID.test(voter) ? store.votesBy(voter) : null]);
      return Object.fromEntries(
        [...all].map(([id, d]): [string, RatingRow] => [id, mine ? { ...summarize(d), mine: mine.get(id) ?? null } : summarize(d)]),
      );
    }

    if (gameId.length > 64 || !GAME_ID.test(gameId)) throw new HttpError(400, 'Invalid game id');

    if (req.method === 'GET') {
      const voter = url.searchParams.get('voter');
      return detail(gameId, voter && UUID.test(voter) ? voter : null);
    }

    if (req.method === 'PUT') {
      if (!allowWrite(clientIp(req))) throw new HttpError(429, 'Too many ratings, try again later');
      const body = (await readJson(req)) as Partial<{ voterId: unknown; stars: unknown }>;
      if (typeof body.voterId !== 'string' || !UUID.test(body.voterId)) throw new HttpError(400, 'Invalid voterId');
      if (!Number.isInteger(body.stars) || (body.stars as number) < 1 || (body.stars as number) > 5) {
        throw new HttpError(400, 'stars must be an integer from 1 to 5');
      }
      await store.upsert(gameId, body.voterId, body.stars as number);
      return detail(gameId, body.voterId);
    }

    throw new HttpError(405, 'Method not allowed');
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
      if (err instanceof HttpError) {
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
  res.setHeader('access-control-allow-methods', 'GET, PUT, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-max-age', '86400');
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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
