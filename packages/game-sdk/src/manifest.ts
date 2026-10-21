import type { GameManifest } from './types';

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateManifest(m: GameManifest): string[] {
  const errors: string[] = [];
  if (!ID.test(m.id)) errors.push(`id "${m.id}" must be kebab-case`);
  if (!m.name.trim()) errors.push('name is required');
  if (!m.tagline.trim()) errors.push('tagline is required');
  if (!(m.rtp > 0 && m.rtp <= 1)) errors.push(`rtp ${m.rtp} must be in (0, 1]`);
  if (!(m.maxMultiplier >= 1)) errors.push(`maxMultiplier ${m.maxMultiplier} must be >= 1`);
  if (m.volatility.length === 0) errors.push('volatility needs at least one level');
  return errors;
}

/** Identity function that type-checks a manifest and fails fast on bad values. */
export function defineManifest(m: GameManifest): GameManifest {
  const errors = validateManifest(m);
  if (errors.length) throw new Error(`Invalid manifest for "${m.id}":\n  ${errors.join('\n  ')}`);
  return m;
}
