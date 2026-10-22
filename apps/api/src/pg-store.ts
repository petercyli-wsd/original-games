import pg from 'pg';
import type { CriterionDef, Evaluation, Exemplar, FacetScores, PromptVersion, Review, RulesCard } from './shared.js';
import { emptyDistribution, type EvalStore, type RatingsStore } from './store.js';

// Idempotent, so it runs on every start instead of a separate migration step.
// New columns use ADD COLUMN IF NOT EXISTS so existing ratings are kept.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ratings (
    game_id    text        NOT NULL,
    voter_id   uuid        NOT NULL,
    stars      smallint    NOT NULL CHECK (stars BETWEEN 1 AND 5),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (game_id, voter_id)
  );
  ALTER TABLE ratings ADD COLUMN IF NOT EXISTS comment  text NOT NULL DEFAULT '';
  ALTER TABLE ratings ADD COLUMN IF NOT EXISTS reviewer text NOT NULL DEFAULT '';
  ALTER TABLE ratings ADD COLUMN IF NOT EXISTS facets   jsonb NOT NULL DEFAULT '{}';

  CREATE TABLE IF NOT EXISTS prompt_versions (
    id         serial      PRIMARY KEY,
    parent_id  integer     REFERENCES prompt_versions(id),
    status     text        NOT NULL CHECK (status IN ('active', 'candidate', 'retired')),
    criteria   jsonb       NOT NULL,
    guidance   text        NOT NULL,
    exemplars  jsonb       NOT NULL DEFAULT '[]',
    changelog  text        NOT NULL DEFAULT '',
    metrics    jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_active_version ON prompt_versions ((status)) WHERE status = 'active';

  CREATE TABLE IF NOT EXISTS rules_cards (
    game_id    text        NOT NULL,
    code_hash  text        NOT NULL,
    card       jsonb       NOT NULL,
    model      text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (game_id, code_hash)
  );

  CREATE TABLE IF NOT EXISTS evaluations (
    id             serial      PRIMARY KEY,
    game_id        text        NOT NULL,
    version_id     integer     NOT NULL REFERENCES prompt_versions(id),
    code_hash      text        NOT NULL,
    overall        real        NOT NULL,
    criteria       jsonb       NOT NULL,
    recommendation text        NOT NULL,
    verdict        text        NOT NULL,
    pros           jsonb       NOT NULL,
    cons           jsonb       NOT NULL,
    duplicate_of   text        NOT NULL DEFAULT '',
    closest        text        NOT NULL DEFAULT '',
    checks         jsonb       NOT NULL,
    model          text        NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS evaluations_latest ON evaluations (version_id, game_id, created_at DESC);`;

export interface PgStores {
  ratings: RatingsStore;
  evals: EvalStore;
  close(): Promise<void>;
}

interface VoteRow {
  stars: number;
  comment: string;
  reviewer: string;
  facets: FacetScores;
  updated_at: Date;
}

const toReview = (r: VoteRow): Review => ({ stars: r.stars, comment: r.comment, reviewer: r.reviewer, facets: r.facets ?? {}, updatedAt: r.updated_at.toISOString() });

export async function createPgStores(connectionString: string, { ssl = false } = {}): Promise<PgStores> {
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
  const REVIEW_COLS = 'stars, comment, reviewer, facets, updated_at';

  const ratings: RatingsStore = {
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
    async review(gameId, voterId) {
      const { rows } = await pool.query<VoteRow>(`SELECT ${REVIEW_COLS} FROM ratings WHERE game_id = $1 AND voter_id = $2`, [gameId, voterId]);
      return rows[0] ? toReview(rows[0]) : null;
    },
    async reviews(gameId, limit) {
      const { rows } = await pool.query<VoteRow>(
        `SELECT ${REVIEW_COLS} FROM ratings WHERE game_id = $1 AND comment <> '' ORDER BY updated_at DESC LIMIT $2`,
        [gameId, limit],
      );
      return rows.map(toReview);
    },
    async allReviews() {
      const { rows } = await pool.query<VoteRow & { game_id: string }>(
        `SELECT game_id, ${REVIEW_COLS} FROM ratings WHERE comment <> '' ORDER BY updated_at DESC`,
      );
      const out = new Map<string, Review[]>();
      for (const r of rows) {
        if (!out.has(r.game_id)) out.set(r.game_id, []);
        out.get(r.game_id)!.push(toReview(r));
      }
      return out;
    },
    async votesBy(voterId) {
      const { rows } = await pool.query('SELECT game_id, stars FROM ratings WHERE voter_id = $1', [voterId]);
      return new Map(rows.map((r: { game_id: string; stars: number }) => [r.game_id, r.stars]));
    },
    async facetScores(gameId) {
      const { rows } = await pool.query<{ game_id: string; facets: FacetScores }>(
        `SELECT game_id, facets FROM ratings WHERE facets <> '{}'::jsonb${gameId ? ' AND game_id = $1' : ''}`,
        gameId ? [gameId] : [],
      );
      const out = new Map<string, FacetScores[]>();
      for (const r of rows) {
        if (!out.has(r.game_id)) out.set(r.game_id, []);
        out.get(r.game_id)!.push(r.facets);
      }
      return out;
    },
    async upsert(gameId, voterId, stars, comment, reviewer, facets) {
      // COALESCE keeps the stored comment/reviewer/facets when a quick vote omits them.
      await pool.query(
        `INSERT INTO ratings (game_id, voter_id, stars, comment, reviewer, facets)
         VALUES ($1, $2, $3, COALESCE($4, ''), COALESCE($5, ''), COALESCE($6::jsonb, '{}'::jsonb))
         ON CONFLICT (game_id, voter_id) DO UPDATE SET
           stars = EXCLUDED.stars,
           comment = COALESCE($4, ratings.comment),
           reviewer = COALESCE($5, ratings.reviewer),
           facets = COALESCE($6::jsonb, ratings.facets),
           updated_at = now()`,
        [gameId, voterId, stars, comment ?? null, reviewer ?? null, facets ? JSON.stringify(facets) : null],
      );
    },
    close: async () => {},
  };

  interface VersionRow {
    id: number;
    parent_id: number | null;
    status: PromptVersion['status'];
    criteria: CriterionDef[];
    guidance: string;
    exemplars: Exemplar[];
    changelog: string;
    metrics: PromptVersion['metrics'];
    created_at: Date;
  }
  const toVersion = (r: VersionRow): PromptVersion => ({
    id: r.id,
    parentId: r.parent_id,
    status: r.status,
    criteria: r.criteria,
    guidance: r.guidance,
    exemplars: r.exemplars,
    changelog: r.changelog,
    metrics: r.metrics,
    createdAt: r.created_at.toISOString(),
  });

  interface EvalRow {
    id: number;
    game_id: string;
    version_id: number;
    code_hash: string;
    overall: number;
    criteria: Evaluation['criteria'];
    recommendation: Evaluation['recommendation'];
    verdict: string;
    pros: string[];
    cons: string[];
    duplicate_of: string;
    closest: string;
    checks: Evaluation['checks'];
    model: string;
    created_at: Date;
  }
  const toEvaluation = (r: EvalRow): Evaluation => ({
    id: r.id,
    gameId: r.game_id,
    versionId: r.version_id,
    codeHash: r.code_hash,
    overall: r.overall,
    criteria: r.criteria,
    recommendation: r.recommendation,
    verdict: r.verdict,
    pros: r.pros,
    cons: r.cons,
    duplicateOf: r.duplicate_of,
    closestExisting: r.closest,
    checks: r.checks,
    model: r.model,
    createdAt: r.created_at.toISOString(),
  });
  const json = (v: unknown) => JSON.stringify(v);

  const evals: EvalStore = {
    async versions() {
      const { rows } = await pool.query<VersionRow>('SELECT * FROM prompt_versions ORDER BY id DESC');
      return rows.map(toVersion);
    },
    async version(id) {
      const { rows } = await pool.query<VersionRow>('SELECT * FROM prompt_versions WHERE id = $1', [id]);
      return rows[0] ? toVersion(rows[0]) : null;
    },
    async activeVersion() {
      const { rows } = await pool.query<VersionRow>(`SELECT * FROM prompt_versions WHERE status = 'active'`);
      return rows[0] ? toVersion(rows[0]) : null;
    },
    async createVersion(v) {
      const { rows } = await pool.query<VersionRow>(
        `INSERT INTO prompt_versions (parent_id, status, criteria, guidance, exemplars, changelog)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [v.parentId, v.status, json(v.criteria), v.guidance, json(v.exemplars), v.changelog],
      );
      return toVersion(rows[0]);
    },
    async setMetrics(id, metrics) {
      await pool.query('UPDATE prompt_versions SET metrics = $2 WHERE id = $1', [id, json(metrics)]);
    },
    async promote(id) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE prompt_versions SET status = 'retired' WHERE status = 'active'`);
        await client.query(`UPDATE prompt_versions SET status = 'active' WHERE id = $1`, [id]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async rulesCard(gameId, codeHash) {
      const { rows } = await pool.query<{ card: RulesCard }>('SELECT card FROM rules_cards WHERE game_id = $1 AND code_hash = $2', [gameId, codeHash]);
      return rows[0]?.card ?? null;
    },
    async saveRulesCard(gameId, codeHash, card, model) {
      await pool.query(
        `INSERT INTO rules_cards (game_id, code_hash, card, model) VALUES ($1, $2, $3, $4)
         ON CONFLICT (game_id, code_hash) DO UPDATE SET card = EXCLUDED.card, model = EXCLUDED.model, created_at = now()`,
        [gameId, codeHash, json(card), model],
      );
    },
    async saveEvaluation(e) {
      const { rows } = await pool.query<EvalRow>(
        `INSERT INTO evaluations (game_id, version_id, code_hash, overall, criteria, recommendation, verdict, pros, cons, duplicate_of, closest, checks, model)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [
          e.gameId,
          e.versionId,
          e.codeHash,
          e.overall,
          json(e.criteria),
          e.recommendation,
          e.verdict,
          json(e.pros),
          json(e.cons),
          e.duplicateOf,
          e.closestExisting,
          json(e.checks),
          e.model,
        ],
      );
      return toEvaluation(rows[0]);
    },
    async latestEvaluations(versionId) {
      const { rows } = await pool.query<EvalRow>(
        `SELECT DISTINCT ON (game_id) * FROM evaluations WHERE version_id = $1 ORDER BY game_id, created_at DESC`,
        [versionId],
      );
      return new Map(rows.map((r) => [r.game_id, toEvaluation(r)]));
    },
  };

  return { ratings, evals, close: () => pool.end() };
}
