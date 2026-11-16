// Parity against an oracle fixture (scripts/slots/oracle.py): the same spec and seed must give the
// pack's canonical spin, object for object (full spins) and byte for byte (per-seed hashes).
// Node-only (uses node:crypto); imported by the parity tests and scripts, never by the browser.

import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical';
import { SlotEngine } from './engine';
import type { SlotSpec, SpinResult } from './types';

export interface OracleFixture {
  schema: 'slot_oracle_v1';
  example?: string;
  exemplar?: string;
  spec: SlotSpec;
  packVersion: string;
  specHash: string;
  context: string;
  families: string[];
  decorSchema: Record<string, string>;
  analytics?: Record<string, unknown>;
  seeds: number;
  spinHashes: string[];
  fullSeeds: number;
  spins: SpinResult[];
}

export function spinHash(spin: SpinResult): string {
  return createHash('sha256').update(canonicalJson(spin)).digest('hex').slice(0, 16);
}

export interface ParityReport {
  ok: boolean;
  seeds: number;
  fullChecked: number;
  firstMismatch: null | { seed: number; kind: 'full' | 'hash' | 'error'; detail: string };
}

function firstDiff(a: unknown, b: unknown, path = '$'): string | null {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) {
    return `${path}: ${JSON.stringify(a)?.slice(0, 200)} != ${JSON.stringify(b)?.slice(0, 200)}`;
  }
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return `${path}: length ${a.length} != ${bb.length} (${JSON.stringify(a).slice(0, 300)} vs ${JSON.stringify(bb).slice(0, 300)})`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], bb[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && typeof a === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.join() !== kb.join()) return `${path}: keys ${ka.join(',')} != ${kb.join(',')}`;
    for (const k of ka) {
      const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
}

/** Spin every fixture seed with the TypeScript engine and compare (stops at the first mismatch). */
export function checkParity(fx: OracleFixture, engine?: SlotEngine): ParityReport {
  const eng = engine ?? new SlotEngine(fx.spec);
  const n = fx.spinHashes.length;
  for (let seed = 0; seed < n; seed++) {
    let ours: SpinResult;
    try {
      ours = eng.spin(seed);
    } catch (e) {
      return { ok: false, seeds: n, fullChecked: Math.min(seed, fx.fullSeeds), firstMismatch: { seed, kind: 'error', detail: String((e as Error).stack ?? e) } };
    }
    if (seed < fx.spins.length) {
      const d = firstDiff(ours, fx.spins[seed]);
      if (d) return { ok: false, seeds: n, fullChecked: seed, firstMismatch: { seed, kind: 'full', detail: d } };
    }
    const h = spinHash(ours);
    if (h !== fx.spinHashes[seed]) {
      return { ok: false, seeds: n, fullChecked: Math.min(seed, fx.spins.length), firstMismatch: { seed, kind: 'hash', detail: `${h} != ${fx.spinHashes[seed]}` } };
    }
  }
  return { ok: true, seeds: n, fullChecked: fx.spins.length, firstMismatch: null };
}
