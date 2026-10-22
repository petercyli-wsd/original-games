// Loads the evidence packs written by scripts/evidence.ts and derives the
// deterministic checks. Anything a machine can measure is measured here rather
// than asked of the model.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MeasuredCheck } from '../shared.js';

export interface EvalReportRow {
  label: string;
  rounds: number;
  rtp: number;
  stdError: number;
  hitRate: number;
  stdDev: number;
  p50: number;
  p99: number;
  max: number;
  avgSteps: number;
}

export interface GameEvidence {
  id: string;
  manifest: {
    id: string;
    name: string;
    tagline: string;
    mechanic: string;
    status: string;
    rtp: number;
    maxMultiplier: number;
    volatility: string[];
    checkpoints: boolean;
  };
  codeHash: string;
  files: { path: string; content: string }[];
  eval: EvalReportRow[] | null;
}

export interface EvidenceIndex {
  get(gameId: string): GameEvidence | undefined;
  all(): GameEvidence[];
}

/** Reads every pack in `dir` once; packs are rebuilt on each deploy. */
export function loadEvidence(dir: string): EvidenceIndex {
  const byId = new Map<string, GameEvidence>();
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
      try {
        const e = JSON.parse(readFileSync(join(dir, name), 'utf8')) as GameEvidence;
        // Templates are starting points, not games to judge.
        if (e.manifest.status !== 'template') byId.set(e.id, e);
      } catch (err) {
        console.warn(`Skipping unreadable evidence ${name}:`, err);
      }
    }
  }
  return { get: (id) => byId.get(id), all: () => [...byId.values()] };
}

export const evidenceFrom = (games: GameEvidence[]): EvidenceIndex => {
  const byId = new Map(games.map((g) => [g.id, g]));
  return { get: (id) => byId.get(id), all: () => [...byId.values()] };
};

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function measuredChecks(e: GameEvidence): MeasuredCheck[] {
  const rows = e.eval ?? [];
  if (!rows.length) {
    return [{ key: 'rtp', label: 'RTP', pass: false, detail: 'No Monte Carlo eval for this game.' }];
  }

  const worstZ = Math.max(...rows.map((r) => Math.abs((r.rtp - e.manifest.rtp) / (r.stdError || Infinity))));
  const sds = rows.map((r) => r.stdDev).filter((s) => s > 0);
  const spread = sds.length > 1 ? Math.max(...sds) / Math.min(...sds) : 1;
  const steps = rows.map((r) => r.avgSteps).sort((a, b) => a - b);
  const medianSteps = steps[Math.floor(steps.length / 2)];

  return [
    {
      key: 'rtp',
      label: 'RTP matches target',
      pass: worstZ <= 4,
      detail: `Target ${pct(e.manifest.rtp)}; measured ${rows.map((r) => pct(r.rtp)).join(', ')} (worst |z| ${worstZ.toFixed(2)}).`,
    },
    {
      key: 'volatility_spread',
      label: 'Volatility spread ≥ 5×',
      pass: spread >= 5,
      detail:
        rows.length > 1
          ? `Std dev ${Math.min(...sds).toFixed(2)} to ${Math.max(...sds).toFixed(2)} across ${rows.length} settings (${spread.toFixed(1)}×).`
          : 'Only one setting was measured, so no spread.',
    },
    {
      key: 'round_length',
      label: 'Round length 1–15 steps',
      pass: medianSteps >= 1 && medianSteps <= 15,
      detail: `Median of per-setting average steps: ${medianSteps.toFixed(1)} (range ${steps[0].toFixed(1)}–${steps[steps.length - 1].toFixed(1)}).`,
    },
    {
      key: 'checkpoints',
      label: 'Has checkpoints',
      pass: e.manifest.checkpoints,
      detail: e.manifest.checkpoints ? 'The manifest declares cash-out checkpoints.' : 'The manifest declares no checkpoints.',
    },
  ];
}

/** A compact table of the eval for the judge. */
export function evalTable(e: GameEvidence): string {
  if (!e.eval?.length) return 'No eval available.';
  const head = '| setting | RTP | hit rate | std dev | p50 | p99 | max | avg steps |\n|---|---|---|---|---|---|---|---|';
  const body = e.eval
    .map((r) => `| ${r.label} | ${pct(r.rtp)} | ${pct(r.hitRate)} | ${r.stdDev.toFixed(2)} | ${r.p50.toFixed(2)}× | ${r.p99.toFixed(2)}× | ${r.max.toFixed(2)}× | ${r.avgSteps.toFixed(1)} |`)
    .join('\n');
  return `${head}\n${body}`;
}
