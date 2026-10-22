import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { loadEvidence } from './evaluator/evidence.js';
import { createClaude } from './evaluator/llm.js';
import { createEvaluator } from './evaluator/service.js';
import { createPgStores } from './pg-store.js';
import { createMemoryEvalStore, createMemoryStore } from './store.js';

const config = loadConfig(process.env);

const stores = config.databaseUrl
  ? await createPgStores(config.databaseUrl, { ssl: config.databaseSsl })
  : { ratings: createMemoryStore(), evals: createMemoryEvalStore(), close: async () => {} };
if (!config.databaseUrl) console.warn('DATABASE_URL not set: using in-memory stores, data resets on restart');

// Evidence packs are built next to dist/ by `npm run build` (scripts/evidence.ts).
const evidenceDir = config.evidenceDir ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'evidence');
const evidence = loadEvidence(evidenceDir);
// In-app AI reviews are behind a feature flag while the Claude Code path is the default.
const llm = config.inAppAiReviews && config.anthropicApiKey ? createClaude(config.anthropicApiKey) : null;
const aiState = llm ? 'on' : config.inAppAiReviews ? 'off (no ANTHROPIC_API_KEY)' : 'off (IN_APP_AI_REVIEWS is not "true")';
console.log(`Evaluator: ${evidence.all().length} games of evidence, in-app AI reviews ${aiState}, admin ${config.adminKey ? 'on' : 'off (no ADMIN_KEY)'}`);

const evaluator = createEvaluator({ llm, evals: stores.evals, ratings: stores.ratings, evidence });
await evaluator.activeVersion(); // seeds version 1 on first start

const server = createServer(createApp({ ratings: stores.ratings, evaluator, corsOrigins: config.corsOrigins, adminKey: config.adminKey }));
server.listen(config.port, () => console.log(`API listening on :${config.port}`));

const shutdown = () => server.close(() => void stores.close().then(() => process.exit(0)));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
