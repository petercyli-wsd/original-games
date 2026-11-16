// Parity with the engine pack: for every committed fixture (scripts/slots/oracle.py output for a pack
// example game, a family exemplar or a pack-built derived spec), the TypeScript engine's spin for
// each seed equals the pack's canonical spin: object for object on the first `fullSeeds` seeds and
// byte for byte (sha256 of the canonical JSON) on all 2,000 seeds.
//
// Fixtures are gzipped JSON (100 full spins + a hash per seed). Regenerate one:
//   npm run slots:oracle -- --example <name> --out packages/slots/src/engine/fixtures/<name>.json.gz --full-seeds 100 --no-analytics

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { checkParity, type OracleFixture } from './parity';
import { canonicalSpin, portedMechanics } from './index';
import { Mulberry32 } from './rng';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const files = readdirSync(dir).filter((f) => f.endsWith('.json.gz')).sort();
const load = (f: string) => JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString('utf8')) as OracleFixture;

describe('Mulberry32 matches slotlab.rng', () => {
  it('u32 streams', () => {
    const cases: [number, number[]][] = [
      [0, [1144304738, 1416247, 958946056, 627933444, 2007157716]],
      [1, [2693262067, 11749833, 2265367787, 4213581821, 4159151403]],
      [123456789, [1107202814, 4169434471, 3372958138, 885470128, 1301683845]],
      [0xffffffff, [3850105811, 813802916, 3073704848, 4054706436, 3630262831]],
    ];
    for (const [seed, want] of cases) {
      const r = new Mulberry32(seed);
      expect(Array.from({ length: 5 }, () => r.u32())).toEqual(want);
    }
  });
  it('randrange and pickWeighted (rejection sampling, randrange(1) draws nothing)', () => {
    let r = new Mulberry32(7);
    expect([1, 2, 3, 7, 1000, 2 ** 31 + 5].map((n) => r.randrange(n))).toEqual([0, 0, 2, 5, 430, 1741702388]);
    r = new Mulberry32(7);
    expect([[1], [5, 10], [1, 2, 3, 100], [0, 0, 4]].map((c) => r.pickWeighted(c))).toEqual([0, 0, 3, 2]);
  });
});

describe('parity with the engine pack', () => {
  it('has fixtures covering every evaluator and every ported family', () => {
    const fxs = files.map(load);
    const kinds = new Set(fxs.map((f) => f.spec.evaluation.kind));
    expect([...kinds].sort()).toEqual(['cluster', 'payline', 'scatter_pays', 'ways']);
    const covered = new Set(fxs.flatMap((f) => f.families));
    if (fxs.some((f) => f.spec.evaluation.kind === 'cluster')) covered.add('tumble');
    for (const id of portedMechanics()) expect(covered.has(id) || id === 'tumble', `family ${id} has no parity fixture`).toBe(true);
    const contexts = new Set(fxs.map((f) => f.context));
    for (const c of ['payline|global_mixture', 'payline|per_reel_pools', 'payline|window_catalog', 'ways|heights', 'ways|top_reel']) expect(contexts.has(c), c).toBe(true);
  });

  for (const f of files) {
    it(`${f.replace(/\.json\.gz$/, '')}: 2,000 seeds identical`, () => {
      const fx = load(f);
      expect(fx.spinHashes.length).toBe(2000);
      const r = checkParity(fx);
      expect(r.firstMismatch).toBeNull();
      expect(r.ok).toBe(true);
    });
  }

  it('canonicalSpin(spec, seed) returns the pack spin object', () => {
    const fx = load('plain-line-eval-no-modifier.json.gz');
    for (const seed of [0, 7, 99]) expect(canonicalSpin(fx.spec, seed)).toEqual(fx.spins[seed]);
  });
});
