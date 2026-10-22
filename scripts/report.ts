// Prints a markdown table of every game's eval: measured RTP, the volatility
// spread (std-dev of the riskiest config ÷ the safest) and round length.
// Used to keep docs/CATALOGUE.md's results section current.
//
//   npx tsx scripts/report.ts [--rounds 100000] [--game <id>]

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { formatPercent, runEval, type EvalSpec, type GameManifest } from '@originals/game-sdk';

const { values } = parseArgs({
  options: {
    rounds: { type: 'string', default: '100000' },
    game: { type: 'string' },
  },
});

const gamesDir = join(import.meta.dirname, '..', 'games');
const rounds = Number(values.rounds);
const rows: string[] = [
  '| Game | Mechanic | RTP range (z) | Std dev low → high | Spread | Avg steps | Max seen | ok |',
  '|---|---|---|---|---|---|---|---|',
];

for (const id of readdirSync(gamesDir).sort()) {
  if (values.game && id !== values.game) continue;
  const src = join(gamesDir, id, 'src');
  if (!existsSync(join(src, 'eval.ts'))) continue;
  const load = async <T>(file: string) => ((await import(pathToFileURL(join(src, file)).href)) as { default: T }).default;
  const manifest = await load<GameManifest>('manifest.ts');
  if (manifest.status === 'template') continue;
  const reports = runEval(await load<EvalSpec>('eval.ts'), { rounds });
  const zs = reports.map((r) => (r.rtp - manifest.rtp) / (r.stdError || Infinity));
  const ok = zs.every((z) => Math.abs(z) <= 4) && reports.every((r) => r.max <= manifest.maxMultiplier + 1e-9);
  const stds = reports.map((r) => r.stdDev);
  const lo = Math.min(...stds);
  const hi = Math.max(...stds);
  const rtps = reports.map((r) => r.rtp);
  const steps = reports.map((r) => r.avgSteps);
  rows.push(
    `| ${manifest.name} | ${manifest.mechanic} | ${formatPercent(Math.min(...rtps), 2)}–${formatPercent(Math.max(...rtps), 2)} (max \\|z\\| ${Math.max(...zs.map(Math.abs)).toFixed(1)}) | ${lo.toFixed(2)} → ${hi.toFixed(2)} | ${(hi / (lo || Infinity)).toFixed(1)}× | ${Math.min(...steps).toFixed(1)}–${Math.max(...steps).toFixed(1)} | ${Math.max(...reports.map((r) => r.max)).toFixed(0)}× | ${ok ? '✓' : '✗'} |`,
  );
  console.error(`${id} done`);
}

console.log(rows.join('\n'));
