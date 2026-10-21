import pg from 'pg';
import { emptyDistribution, type RatingsStore } from './store.js';

// Idempotent, so it runs on every start instead of a separate migration step.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ratings (
    game_id    text        NOT NULL,
    voter_id   uuid        NOT NULL,
    stars      smallint    NOT NULL CHECK (stars BETWEEN 1 AND 5),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (game_id, voter_id)
  )`;

export async function createPgStore(connectionString: string, { ssl = false } = {}): Promise<RatingsStore> {
  const pool = new pg.Pool({ connectionString, max: 5, ssl: ssl ? { rejectUnauthorized: false } : undefined });
  await pool.query(SCHEMA);

  const toDistributions = (rows: { game_id: string; stars: number; n: number }[]) => {
    const out = new Map<string, number[]>();
    for (const r of rows) {
      if (!out.has(r.game_id)) out.set(r.game_id, emptyDistribution());
      out.get(r.game_id)![r.stars - 1] = r.n;
    }
    return out;
  };
  const GROUPED = 'SELECT game_id, stars, COUNT(*)::int AS n FROM ratings';

  return {
    async distributions() {
      const { rows } = await pool.query(`${GROUPED} GROUP BY game_id, stars`);
      return toDistributions(rows);
    },
    async distribution(gameId) {
      const { rows } = await pool.query(`${GROUPED} WHERE game_id = $1 GROUP BY game_id, stars`, [gameId]);
      return toDistributions(rows).get(gameId) ?? emptyDistribution();
    },
    async stars(gameId, voterId) {
      const { rows } = await pool.query('SELECT stars FROM ratings WHERE game_id = $1 AND voter_id = $2', [gameId, voterId]);
      return rows[0]?.stars ?? null;
    },
    async votesBy(voterId) {
      const { rows } = await pool.query('SELECT game_id, stars FROM ratings WHERE voter_id = $1', [voterId]);
      return new Map(rows.map((r: { game_id: string; stars: number }) => [r.game_id, r.stars]));
    },
    async upsert(gameId, voterId, stars) {
      await pool.query(
        `INSERT INTO ratings (game_id, voter_id, stars) VALUES ($1, $2, $3)
         ON CONFLICT (game_id, voter_id) DO UPDATE SET stars = EXCLUDED.stars, updated_at = now()`,
        [gameId, voterId, stars],
      );
    },
    close: () => pool.end(),
  };
}
