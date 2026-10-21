export interface Config {
  port: number;
  databaseUrl?: string;
  databaseSsl: boolean;
  corsOrigins: string[] | '*';
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: Number(env.PORT ?? 8787),
    databaseUrl: env.DATABASE_URL || undefined,
    // Only for hosts with self-signed certs. Neon URLs carry ?sslmode=require
    // and verify properly without it.
    databaseSsl: env.DATABASE_SSL === 'true',
    corsOrigins: parseOrigins(env.CORS_ORIGINS ?? '*'),
  };
}

/** "*" or a comma-separated list; bare hostnames get https://. */
export function parseOrigins(raw: string): string[] | '*' {
  if (raw.trim() === '*') return '*';
  return raw
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .map((o) => (/^https?:\/\//.test(o) ? o : `https://${o}`));
}
