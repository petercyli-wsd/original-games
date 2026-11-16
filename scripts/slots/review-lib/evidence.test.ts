import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { factsIntegrity, TRADEMARKS } from './evidence';

const hits = (text: string) => TRADEMARKS.filter((t) => t.re.test(text)).map((t) => t.name);

describe('trademarked mechanic names (SLOTS.md §4)', () => {
  it('finds the names however they are spelled', () => {
    expect(hits('<Caption>Megaways: up to 117,649 ways</Caption>')).toEqual(['Megaways']);
    expect(hits("name: 'Mega Ways Madness'")).toEqual(['Megaways']);
    expect(hits('feature: { name: "Hold & Win" }')).toEqual(['Hold & Win']);
    expect(hits("title: 'Hold and Win bonus'")).toEqual(['Hold & Win']);
    expect(hits("title: 'Hold n Win'")).toEqual(['Hold & Win']);
    expect(hits('Cash-Collect symbols')).toEqual(['Cash Collect']);
  });

  it('ignores pack family ids and other words', () => {
    expect(hits("mechanics: ['megaways_collector_terminal', 'hold_and_spin_lock_respin']")).toEqual([]);
    expect(hits('Hold to spin; cash out; collect the coins; mega wins')).toEqual([]);
  });
});

describe('factsIntegrity', () => {
  const oracle = { present: true, families: [], features: [], problems: [], specHash: 'aaa' };
  it('passes a facts file whose oracle check passed on the same spec', () => {
    expect(factsIntegrity({ specHash: 'aaa', oracle: { status: 'pass', detail: '' } }, oracle)).toEqual([]);
  });
  it('fails a failed or stale oracle check, and facts from another spec', () => {
    expect(factsIntegrity({ specHash: 'aaa', oracle: { status: 'stale', detail: 'spec changed' } }, oracle)).toEqual(['oracle check stale in slots:eval: spec changed']);
    expect(factsIntegrity({ specHash: 'bbb', oracle: { status: 'pass' } }, oracle)).toEqual([expect.stringMatching(/different specs/)]);
  });
  it('fails facts that slots:eval did not write (no oracle check or no specHash)', () => {
    expect(factsIntegrity({ rtp: 0.96, note: 'game-local script' }, oracle)).toEqual([expect.stringMatching(/^facts not from slots:eval/)]);
    expect(factsIntegrity({ oracle: { status: 'pass' } }, oracle)).toEqual([expect.stringMatching(/^facts not from slots:eval/)]);
  });
});

describe('gameRuntimeFiles (the code hash covers only what reaches the player)', () => {
  it('keeps the entries, the slot JSON and what they import; drops tests, oracle, tools and test-only helpers', async () => {
    const games = mkdtempSync(join(tmpdir(), 'slot-hash-'));
    const src = join(games, 'g', 'src');
    mkdirSync(join(src, 'tools'), { recursive: true });
    const files: Record<string, string> = {
      'index.ts': "import Game from './Game';\nexport default Game;",
      'Game.tsx': "import { art } from './art';\nimport spec from './slot.spec.json';\nimport icon from './icon.svg?raw';",
      'art.tsx': 'export const art = 1;',
      'icon.svg': '<svg/>',
      'manifest.ts': "import facts from './slot-facts.json';",
      'slot.spec.json': '{}',
      'slot.config.json': '{}',
      'feature.spec.json': '{}',
      'slot-facts.json': '{}',
      'oracle.json': '{}',
      'mixture.ts': 'export const exact = 1;',
      'g.test.ts': "import { exact } from './mixture';\nimport oracle from './oracle.json';",
      'tools/fit.ts': 'export {};',
    };
    for (const [f, t] of Object.entries(files)) writeFileSync(join(src, f), t);
    vi.resetModules();
    vi.stubEnv('SLOT_REVIEW_GAMES_DIR', games);
    const { gameRuntimeFiles } = await import('./evidence');
    expect(gameRuntimeFiles('g')).toEqual(['Game.tsx', 'art.tsx', 'feature.spec.json', 'icon.svg', 'index.ts', 'manifest.ts', 'slot.config.json', 'slot.spec.json']);
    vi.unstubAllEnvs();
  });
});
