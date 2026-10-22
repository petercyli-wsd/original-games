// Base URL and request helper for the API service (apps/api). With no
// VITE_RATINGS_API_URL configured, ratings, reviews and the evaluator are hidden.

function normalizeBase(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const url = /^https?:\/\//.test(raw) ? raw.trim() : `https://${raw.trim()}`;
  return url.replace(/\/+$/, '');
}

const BASE = normalizeBase(import.meta.env.VITE_RATINGS_API_URL);
export const apiEnabled = BASE !== null;

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `The API returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const jsonBody = (method: string, body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
