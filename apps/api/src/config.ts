export interface Config {
  port: number;
  databaseUrl?: string;
  databaseSsl: boolean;
  corsOrigins: string[] | '*';
  /** Enables AI reviews. */
  anthropicApiKey?: string;
  /** Required in the x-admin-key header for actions that call Claude. */
  adminKey?: string;
  /** Where evidence packs live; defaults to apps/api/evidence. */
  evidenceDir?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: Number(env.PORT ?? 8787),
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    adminKey: env.ADMIN_KEY || undefined,
    evidenceDir: env.EVIDENCE_DIR || undefined,
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
