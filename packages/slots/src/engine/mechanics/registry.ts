// The executable mechanic registry (pack: src/reelengine/mechanics/registry.py), restricted to the
// families this port reproduces byte for byte. A spec naming any other family is refused by name.

import type { SlotEngine } from '../engine';
import { MechanicPlugin, SINGLETON_STAGES, type Params, type Stage } from './protocol';

export type PluginCtor = new (engine: SlotEngine, params: Params, instance: string) => MechanicPlugin;

export const REGISTRY = new Map<string, PluginCtor>();
const STAGE_OF = new Map<string, Stage>();

/** Taxonomy family ids that execute on another plugin's law (the instance keeps the record's id). */
export const ALIASES: Record<string, string> = {
  tape_continuation_refill: 'tumble',
};

/** Register a plugin under its id with its STAGE (read before any instance exists). */
export function register(id: string, stage: Stage, cls: PluginCtor): void {
  if (REGISTRY.has(id) && REGISTRY.get(id) !== cls) throw new Error(`duplicate mechanic id '${id}'`);
  REGISTRY.set(id, cls);
  STAGE_OF.set(id, stage);
}

export function resolve(id: string): string {
  return ALIASES[id] ?? id;
}

export function knownIds(): string[] {
  return [...REGISTRY.keys(), ...Object.keys(ALIASES).filter((a) => REGISTRY.has(ALIASES[a]))].sort();
}

/** True for a registered continuation (a cluster spec naming one carries its own cascade). */
export function isContinuationId(id: string): boolean {
  return STAGE_OF.get(resolve(id)) === 'continuation';
}

export function instanceNames(entries: { id: string; instance?: string }[]): string[] {
  const seen = new Map<string, number>();
  const names: string[] = [];
  for (const e of entries) {
    if (e.instance) {
      names.push(String(e.instance));
      continue;
    }
    const n = (seen.get(e.id) ?? 0) + 1;
    seen.set(e.id, n);
    names.push(n === 1 ? e.id : `${e.id}#${n}`);
  }
  if (new Set(names).size !== names.length) throw new Error(`mechanic instance names collide: ${names.join(', ')}`);
  return names;
}

export function instantiate(engine: SlotEngine, entries: { id: string; params?: Params; instance?: string }[]): MechanicPlugin[] {
  const names = instanceNames(entries);
  const out: MechanicPlugin[] = [];
  const perStage = new Map<Stage, string[]>();
  entries.forEach((e, i) => {
    const cls = REGISTRY.get(resolve(e.id));
    if (!cls) throw new Error(`mechanic '${e.id}' is not ported to the TypeScript engine (ported: ${knownIds().join(', ')})`);
    const p = new cls(engine, e.params ?? {}, names[i]);
    if (p.APPLIES_TO !== null && !p.APPLIES_TO.includes(engine.evaluatorKind)) {
      throw new Error(`mechanic '${e.id}' applies to ${JSON.stringify([...p.APPLIES_TO].sort())} evaluators, not '${engine.evaluatorKind}'`);
    }
    if (engine.heightVariable && !p.RAGGED_OK) {
      throw new Error(`${e.id}: reads a uniform-height board (RAGGED_OK false) and has no law under height_law 'independent_categorical'`);
    }
    perStage.set(p.STAGE, [...(perStage.get(p.STAGE) ?? []), e.id]);
    out.push(p);
  });
  for (const st of SINGLETON_STAGES) {
    const ids = perStage.get(st) ?? [];
    if (ids.length > 1) throw new Error(`at most one ${st} mechanic per record, got ${ids.join(', ')}`);
  }
  for (const p of out) p.init();
  return out;
}
