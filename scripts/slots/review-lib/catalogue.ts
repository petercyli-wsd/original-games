// The slot catalogue the designer checks uniqueness against: every other slot
// game (with its mechanism signature and, when a review has run, its rules
// card's concept), the older hand-built slots, and docs/SLOT-CATALOGUE.md.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildEvidence, legacySlotIds, loadManifest, sameSignature, signatureText, slotGameIds, type Signature } from './evidence';
import { CATALOGUE_MD, WORK } from './paths';

export interface CatalogueEntry {
  id: string;
  name: string;
  status: string;
  signature: Signature;
  concept: string;
}

export async function catalogueEntries(exclude: string): Promise<CatalogueEntry[]> {
  const out: CatalogueEntry[] = [];
  for (const id of slotGameIds()) {
    if (id === exclude) continue;
    try {
      const e = await buildEvidence(id);
      const cardFile = join(WORK, id, 'card.json');
      const card = existsSync(cardFile) ? (JSON.parse(readFileSync(cardFile, 'utf8')) as { concept?: string }) : {};
      out.push({ id, name: e.manifest.name, status: e.manifest.status ?? '?', signature: e.signature, concept: card.concept ?? e.manifest.tagline ?? '' });
    } catch (err) {
      console.log(`! catalogue: skipped ${id} (${(err as Error).message})`);
    }
  }
  return out;
}

/** Catalogue slots with exactly the same signature: reskins by the §5 definition. */
export const twinsOf = (sig: Signature, entries: CatalogueEntry[]) => entries.filter((c) => sameSignature(sig, c.signature)).map((c) => c.id);

export async function catalogueText(exclude: string, entries: CatalogueEntry[]): Promise<string> {
  const rows = entries.map((c) => `- ${c.id} "${c.name}" (${c.status}): ${c.concept} Signature: ${signatureText(c.signature)}.`);
  const legacy: string[] = [];
  for (const id of legacySlotIds()) {
    if (id === exclude) continue;
    try {
      const m = await loadManifest(id);
      legacy.push(`- ${id} "${m.name}" (${m.status ?? '?'}, a hand-built slot in the Originals lobby, not on the engine): ${m.tagline ?? ''}`);
    } catch {
      /* unreadable manifest: leave it out */
    }
  }
  const doc = existsSync(CATALOGUE_MD) ? readFileSync(CATALOGUE_MD, 'utf8') : '(docs/SLOT-CATALOGUE.md is missing)';
  return `Slot games in this repo:
${rows.join('\n') || '- none yet'}

Older hand-built slots:
${legacy.join('\n') || '- none'}

docs/SLOT-CATALOGUE.md (roster, dropped concepts and why):
${doc}`;
}
