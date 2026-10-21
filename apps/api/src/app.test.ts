import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type AppOptions } from './app.js';
import { parseOrigins } from './config.js';
import { summarize, type RatingDetail } from './shared.js';
import { createMemoryStore } from './store.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

let server: Server | undefined;
afterEach(() => server?.close());

async function start(opts: Partial<AppOptions> = {}) {
  server = createServer(createApp(createMemoryStore(), { corsOrigins: '*', ...opts }));
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const put = (game: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/ratings/${game}`, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
  return { base, put };
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
    const res = await put('drift', { voterId: A, stars: 4 }); // A changes their mind
    expect(await res.json()).toEqual({ average: 3, count: 2, distribution: [0, 1, 0, 1, 0], mine: 4 });

    await put('slice', { voterId: B, stars: 1 });
    expect(await (await fetch(`${base}/ratings`)).json()).toEqual({
      drift: { average: 3, count: 2 },
      slice: { average: 1, count: 1 },
    });
    const mine = (await (await fetch(`${base}/ratings/drift?voter=${B}`)).json()) as RatingDetail;
    expect(mine.mine).toBe(2);
    const anon = await (await fetch(`${base}/ratings/unrated`)).json();
    expect(anon).toEqual({ average: 0, count: 0, distribution: [0, 0, 0, 0, 0], mine: null });
  });

  it('rejects bad input', async () => {
    const { base, put } = await start();
    expect((await put('drift', { voterId: A, stars: 6 })).status).toBe(400);
    expect((await put('drift', { voterId: A, stars: 2.5 })).status).toBe(400);
    expect((await put('drift', { voterId: 'nope', stars: 3 })).status).toBe(400);
    expect((await put('Bad_Id', { voterId: A, stars: 3 })).status).toBe(400);
    expect((await fetch(`${base}/ratings/drift`, { method: 'PUT', body: '{oops' })).status).toBe(400);
    expect((await fetch(`${base}/ratings/drift`, { method: 'PUT', body: 'x'.repeat(5000) })).status).toBe(413);
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

describe('helpers', () => {
  it('summarizes distributions', () => {
    expect(summarize([0, 0, 0, 0, 0])).toEqual({ average: 0, count: 0 });
    expect(summarize([1, 0, 0, 0, 3])).toEqual({ average: 4, count: 4 });
  });

  it('parses CORS origins', () => {
    expect(parseOrigins('*')).toBe('*');
    expect(parseOrigins('original-games.onrender.com, http://localhost:5173/')).toEqual([
      'https://original-games.onrender.com',
      'http://localhost:5173',
    ]);
  });
});
