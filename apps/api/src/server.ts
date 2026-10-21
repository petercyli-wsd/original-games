import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPgStore } from './pg-store.js';
import { createMemoryStore } from './store.js';

const config = loadConfig(process.env);

const store = config.databaseUrl
  ? await createPgStore(config.databaseUrl, { ssl: config.databaseSsl })
  : createMemoryStore();
if (!config.databaseUrl) console.warn('DATABASE_URL not set: using an in-memory store, ratings reset on restart');

const server = createServer(createApp(store, { corsOrigins: config.corsOrigins }));
server.listen(config.port, () => console.log(`Ratings API listening on :${config.port}`));

const shutdown = () => server.close(() => void store.close().then(() => process.exit(0)));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
