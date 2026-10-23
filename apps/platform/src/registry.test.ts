import type { GameManifest, GameModule } from '@originals/game-sdk';
import { describe, expect, it, vi } from 'vitest';
import { buildRegistry, inLobbyOrder } from './registry';

const manifest = (id: string, extra: Partial<GameManifest> = {}): GameManifest => ({
  id,
  name: id.toUpperCase(),
  tagline: 't',
  mechanic: 'other',
  status: 'prototype',
  rtp: 0.99,
  maxMultiplier: 10,
  volatility: ['low'],
  checkpoints: false,
  accent: '#fff',
  ...extra,
});

const load = () => Promise.resolve({} as GameModule);
const paths = (id: string) => [`../../../games/${id}/src/manifest.ts`, `../../../games/${id}/src/index.ts`];

describe('buildRegistry', () => {
  it('pairs manifests with loaders and sorts live games first', () => {
    const [ma, la] = paths('alpha');
    const [mb, lb] = paths('beta');
    const reg = buildRegistry(
      { [ma]: manifest('alpha'), [mb]: manifest('beta', { status: 'live' }) },
      { [la]: load, [lb]: load },
    );
    expect(reg.map((g) => g.manifest.id)).toEqual(['beta', 'alpha']);
  });

  it('skips invalid games, mismatched ids and (by default) templates', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const [m1, l1] = paths('wrong-folder');
    const [m2] = paths('no-loader');
    const [m3, l3] = paths('template');
    const inputs = [
      { [m1]: manifest('other-id'), [m2]: manifest('no-loader'), [m3]: manifest('template', { status: 'template' }) },
      { [l1]: load, [l3]: load },
    ] as const;
    expect(buildRegistry(...inputs)).toEqual([]);
    expect(buildRegistry(...inputs, { includeTemplates: true }).map((g) => g.manifest.id)).toEqual(['template']);
  });
});

describe('inLobbyOrder', () => {
  it('puts core games first, then classics, then prototypes, keeping order within a section', () => {
    const entry = (id: string, extra: Partial<GameManifest>) => ({ manifest: manifest(id, extra), load });
    const ordered = inLobbyOrder([
      entry('proto', { status: 'prototype' }),
      entry('classic-a', { status: 'live', collection: 'classics' }),
      entry('core', { status: 'live' }),
      entry('classic-b', { status: 'live', collection: 'classics' }),
    ]);
    expect(ordered.map((g) => g.manifest.id)).toEqual(['core', 'classic-a', 'classic-b', 'proto']);
  });
});
