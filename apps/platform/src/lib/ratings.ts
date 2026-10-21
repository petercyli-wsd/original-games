// Client for the ratings API (apps/api). Ratings are anonymous: each browser
// gets a random voter id and holds one star rating per game, which it can change.
// With no VITE_RATINGS_API_URL configured, ratings are hidden entirely.

import { summarize, type RatingDetail, type RatingRow } from '@originals/api/shared';
import { createStore } from '@originals/game-sdk';
import { safeStorage } from './storage';

const VOTER_KEY = 'originals.voter';

function normalizeBase(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const url = /^https?:\/\//.test(raw) ? raw.trim() : `https://${raw.trim()}`;
  return url.replace(/\/+$/, '');
}

const BASE = normalizeBase(import.meta.env.VITE_RATINGS_API_URL);
export const ratingsEnabled = BASE !== null;

/** Average, count and this browser's own stars per game id, shared by every page. */
export const ratingSummaries = createStore<Record<string, RatingRow>>({});

/** Whether the summaries loaded, so pages can say when ratings are unreachable. */
export const ratingsStatus = createStore<'idle' | 'loading' | 'ready' | 'error'>('idle');

let voter: string | undefined;
export function voterId(): string {
  if (voter) return voter;
  const storage = safeStorage();
  try {
    voter = storage?.getItem(VOTER_KEY) ?? undefined;
  } catch {
    /* storage unavailable */
  }
  if (!voter) {
    voter = crypto.randomUUID();
    try {
      storage?.setItem(VOTER_KEY, voter);
    } catch {
      /* rating still works, but won't be remembered as this voter's */
    }
  }
  return voter;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Ratings API returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

let summariesRequest: Promise<void> | null = null;

/** Loads every game's average (and this voter's stars) once. Failures are non-fatal. */
export function loadSummaries() {
  if (!ratingsEnabled || summariesRequest) return;
  ratingsStatus.set('loading');
  summariesRequest = request<Record<string, RatingRow>>(`/ratings?voter=${encodeURIComponent(voterId())}`)
    .then((all) => {
      ratingSummaries.set({ ...all, ...ratingSummaries.get() });
      ratingsStatus.set('ready');
    })
    .catch((err: unknown) => {
      console.warn('Could not load ratings', err);
      ratingsStatus.set('error');
      summariesRequest = null;
    });
}

export const fetchRating = (gameId: string) =>
  request<RatingDetail>(`/ratings/${gameId}?voter=${encodeURIComponent(voterId())}`);

export async function rate(gameId: string, stars: number): Promise<RatingDetail> {
  const detail = await request<RatingDetail>(`/ratings/${gameId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ voterId: voterId(), stars }),
  });
  ratingSummaries.set({ ...ratingSummaries.get(), [gameId]: { ...summarize(detail.distribution), mine: detail.mine } });
  ratingsStatus.set('ready');
  return detail;
}
