// Storage behind the ratings API. Postgres in production; an in-memory
// store for tests and for running locally without a database.

export interface RatingsStore {
  /** Star distribution per game id (index 0 = 1 star). */
  distributions(): Promise<Map<string, number[]>>;
  distribution(gameId: string): Promise<number[]>;
  stars(gameId: string, voterId: string): Promise<number | null>;
  /** One rating per voter per game; rating again replaces it. */
  upsert(gameId: string, voterId: string, stars: number): Promise<void>;
  close(): Promise<void>;
}

export const emptyDistribution = () => [0, 0, 0, 0, 0];

export function createMemoryStore(): RatingsStore {
  const games = new Map<string, Map<string, number>>();
  const tally = (votes: Map<string, number>) => {
    const d = emptyDistribution();
    for (const stars of votes.values()) d[stars - 1]++;
    return d;
  };

  return {
    async distributions() {
      return new Map([...games].map(([id, votes]) => [id, tally(votes)]));
    },
    async distribution(gameId) {
      const votes = games.get(gameId);
      return votes ? tally(votes) : emptyDistribution();
    },
    async stars(gameId, voterId) {
      return games.get(gameId)?.get(voterId) ?? null;
    },
    async upsert(gameId, voterId, stars) {
      if (!games.has(gameId)) games.set(gameId, new Map());
      games.get(gameId)!.set(voterId, stars);
    },
    async close() {},
  };
}
