#!/usr/bin/env node
// Runs scripts/slots/oracle.py with the engine pack's own venv python (docs/SLOTS.md §2.4).
// The pack path comes from SLOT_ENGINE_PACK (default: Peter's checkout). The pack is never edited.
//
//   npm run slots:oracle -- --game <id>                    -> games/<id>/src/oracle.json
//   npm run slots:oracle -- --example <name> --out <file>  -> a parity fixture
//   npm run slots:oracle -- --all-examples --out-dir <dir> [--only a,b] [--seeds N] [--no-analytics]
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const pack = process.env.SLOT_ENGINE_PACK || '/Users/petercyli-wsd/Dev/slot-math-engine-pack';
const python = process.platform === 'win32' ? join(pack, '.venv', 'Scripts', 'python.exe') : join(pack, '.venv', 'bin', 'python');

if (!existsSync(python)) {
  console.error(`slots:oracle: no pack venv python at ${python} (set SLOT_ENGINE_PACK to the engine pack folder)`);
  process.exit(2);
}

const res = spawnSync(python, [join(here, 'oracle.py'), ...process.argv.slice(2)], {
  cwd: repo,
  stdio: 'inherit',
  env: { ...process.env, SLOT_ENGINE_PACK: pack, PYTHONPATH: join(pack, 'src'), PYTHONHASHSEED: '0' },
});
if (res.error) {
  console.error(`slots:oracle: ${res.error.message}`);
  process.exit(2);
}
process.exit(res.status ?? 1);
