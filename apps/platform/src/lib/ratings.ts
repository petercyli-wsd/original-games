// Client for ratings and reviews. Ratings are anonymous: each browser gets a
// random voter id and holds one rating per game (stars plus an optional written
// review), which it can change.

import { summarize, type FacetScores, type FeedReview, type RatingDetail, type RatingRow } from '@originals/api/shared';
import { createStore } from '@originals/game-sdk';
import { apiEnabled, apiRequest as request, jsonBody } from './api';
import { safeStorage } from './storage';

const VOTER_KEY = 'originals.voter';

const REVIEWER_KEY = 'originals.reviewer';

export const ratingsEnabled = apiEnabled;

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

/** The name this browser last signed a review with. */
export function savedReviewer(): string {
  try {
    return safeStorage()?.getItem(REVIEWER_KEY) ?? '';
  } catch {
    return '';
  }
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

/** The latest reviews across every game, with this browser's own flagged. */
export const fetchFeed = () => request<FeedReview[]>(`/reviews?voter=${encodeURIComponent(voterId())}`);

export const fetchRating = (gameId: string) =>
  request<RatingDetail>(`/ratings/${gameId}?voter=${encodeURIComponent(voterId())}`);

/** Saves stars, and a written review when `review` is given (omitting it keeps the old one). */
export async function rate(gameId: string, stars: number, review?: { comment: string; reviewer: string; facets: FacetScores }): Promise<RatingDetail> {
  if (review) {
    try {
      safeStorage()?.setItem(REVIEWER_KEY, review.reviewer);
    } catch {
      /* storage unavailable */
    }
  }
  const detail = await request<RatingDetail>(`/ratings/${gameId}`, jsonBody('PUT', { voterId: voterId(), stars, ...review }));
  ratingSummaries.set({ ...ratingSummaries.get(), [gameId]: { ...summarize(detail.distribution), mine: detail.mine, facets: detail.facets } });
  ratingsStatus.set('ready');
  return detail;
}
