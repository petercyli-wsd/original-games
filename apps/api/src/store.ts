// Storage behind the API. Postgres in production; in-memory stores for tests
// and for running locally without a database.

import type { Evaluation, FacetScores, FeedReview, PromptVersion, Review, RulesCard } from './shared.js';

export interface RatingsStore {
  /** Star distribution per game id (index 0 = 1 star). */
  distributions(): Promise<Map<string, number[]>>;
  distribution(gameId: string): Promise<number[]>;
  stars(gameId: string, voterId: string): Promise<number | null>;
  review(gameId: string, voterId: string): Promise<Review | null>;
  /** Everyone's review of a game (any rating, written or not), newest first, leaving out `excludeVoter`'s. */
  reviews(gameId: string, limit: number, excludeVoter?: string | null): Promise<Review[]>;
  /** The latest reviews across every game, newest first; `voter`'s own are flagged. */
  recentReviews(limit: number, voter?: string | null): Promise<FeedReview[]>;
  /** Every review with a comment, grouped by game; feeds the evaluator's refiner. */
  allReviews(): Promise<Map<string, Review[]>>;
  /** Every game this voter has rated, with their stars. */
  votesBy(voterId: string): Promise<Map<string, number>>;
  /** Facet scores of every review that scored at least one facet, by game. */
  facetScores(gameId?: string): Promise<Map<string, FacetScores[]>>;
  /**
   * One rating per voter per game; rating again replaces it. A comment,
   * reviewer or facets left undefined keep the stored ones, so quick star
   * votes don't wipe a written review.
   */
  upsert(gameId: string, voterId: string, stars: number, comment?: string, reviewer?: string, facets?: FacetScores): Promise<void>;
  close(): Promise<void>;
}

export type NewVersion = Omit<PromptVersion, 'id' | 'createdAt' | 'metrics'>;
export type NewEvaluation = Omit<Evaluation, 'id' | 'createdAt'>;

export interface EvalStore {
  versions(): Promise<PromptVersion[]>;
  version(id: number): Promise<PromptVersion | null>;
  activeVersion(): Promise<PromptVersion | null>;
  createVersion(v: NewVersion): Promise<PromptVersion>;
  setMetrics(id: number, metrics: PromptVersion['metrics']): Promise<void>;
  /** Makes `id` the active version and retires the previous one. */
  promote(id: number): Promise<void>;
  rulesCard(gameId: string, codeHash: string): Promise<RulesCard | null>;
  saveRulesCard(gameId: string, codeHash: string, card: RulesCard, model: string): Promise<void>;
  saveEvaluation(e: NewEvaluation): Promise<Evaluation>;
  /** Latest evaluation of each game under a version. */
  latestEvaluations(versionId: number): Promise<Map<string, Evaluation>>;
}

export const emptyDistribution = () => [0, 0, 0, 0, 0];

interface Vote {
  stars: number;
  comment: string;
  reviewer: string;
  facets: FacetScores;
  updatedAt: Date;
}

const toReview = (v: Vote): Review => ({ stars: v.stars, comment: v.comment, reviewer: v.reviewer, facets: v.facets, updatedAt: v.updatedAt.toISOString() });
const newestFirst = (a: Vote, b: Vote) => b.updatedAt.getTime() - a.updatedAt.getTime();

export function createMemoryStore(): RatingsStore {
  const games = new Map<string, Map<string, Vote>>();
  let lastWrite = 0;
  const tally = (votes: Map<string, Vote>) => {
    const d = emptyDistribution();
    for (const v of votes.values()) d[v.stars - 1]++;
    return d;
  };
  const commented = (votes: Map<string, Vote> | undefined) => [...(votes?.values() ?? [])].filter((v) => v.comment).sort(newestFirst);

  return {
    async distributions() {
      return new Map([...games].map(([id, votes]) => [id, tally(votes)]));
    },
    async distribution(gameId) {
      const votes = games.get(gameId);
      return votes ? tally(votes) : emptyDistribution();
    },
    async stars(gameId, voterId) {
      return games.get(gameId)?.get(voterId)?.stars ?? null;
    },
    async review(gameId, voterId) {
      const v = games.get(gameId)?.get(voterId);
      return v ? toReview(v) : null;
    },
    async reviews(gameId, limit, excludeVoter) {
      return [...(games.get(gameId) ?? [])]
        .filter(([voter]) => voter !== excludeVoter)
        .map(([, v]) => v)
        .sort(newestFirst)
        .slice(0, limit)
        .map(toReview);
    },
    async recentReviews(limit, voter) {
      return [...games]
        .flatMap(([gameId, votes]) => [...votes].map(([id, v]) => ({ gameId, mine: id === voter, v })))
        .sort((a, b) => newestFirst(a.v, b.v))
        .slice(0, limit)
        .map(({ gameId, mine, v }) => ({ ...toReview(v), gameId, mine }));
    },
    async allReviews() {
      return new Map([...games].map(([id, votes]) => [id, commented(votes).map(toReview)]).filter(([, r]) => r.length) as [string, Review[]][]);
    },
    async votesBy(voterId) {
      const out = new Map<string, number>();
      for (const [id, votes] of games) {
        const v = votes.get(voterId);
        if (v) out.set(id, v.stars);
      }
      return out;
    },
    async facetScores(gameId) {
      const out = new Map<string, FacetScores[]>();
      for (const [id, votes] of games) {
        if (gameId && id !== gameId) continue;
        const scored = [...votes.values()].map((v) => v.facets).filter((f) => Object.keys(f).length);
        if (scored.length) out.set(id, scored);
      }
      return out;
    },
    async upsert(gameId, voterId, stars, comment, reviewer, facets) {
      if (!games.has(gameId)) games.set(gameId, new Map());
      const votes = games.get(gameId)!;
      const prev = votes.get(voterId);
      // Strictly increasing, so "newest first" is deterministic even within one millisecond.
      lastWrite = Math.max(Date.now(), lastWrite + 1);
      votes.set(voterId, {
        stars,
        comment: comment ?? prev?.comment ?? '',
        reviewer: reviewer ?? prev?.reviewer ?? '',
        facets: facets ?? prev?.facets ?? {},
        updatedAt: new Date(lastWrite),
      });
    },
    async close() {},
  };
}

export function createMemoryEvalStore(): EvalStore {
  const versions: PromptVersion[] = [];
  const cards = new Map<string, RulesCard>();
  const evaluations: Evaluation[] = [];

  return {
    async versions() {
      return [...versions].reverse();
    },
    async version(id) {
      return versions.find((v) => v.id === id) ?? null;
    },
    async activeVersion() {
      return versions.find((v) => v.status === 'active') ?? null;
    },
    async createVersion(v) {
      const created: PromptVersion = { ...v, id: versions.length + 1, createdAt: new Date().toISOString(), metrics: null };
      versions.push(created);
      return created;
    },
    async setMetrics(id, metrics) {
      const v = versions.find((x) => x.id === id);
      if (v) v.metrics = metrics;
    },
    async promote(id) {
      for (const v of versions) {
        if (v.status === 'active') v.status = 'retired';
        if (v.id === id) v.status = 'active';
      }
    },
    async rulesCard(gameId, codeHash) {
      return cards.get(`${gameId}@${codeHash}`) ?? null;
    },
    async saveRulesCard(gameId, codeHash, card) {
      cards.set(`${gameId}@${codeHash}`, card);
    },
    async saveEvaluation(e) {
      const saved: Evaluation = { ...e, id: evaluations.length + 1, createdAt: new Date().toISOString() };
      evaluations.push(saved);
      return saved;
    },
    async latestEvaluations(versionId) {
      const out = new Map<string, Evaluation>();
      for (const e of evaluations) if (e.versionId === versionId) out.set(e.gameId, e);
      return out;
    },
  };
}
