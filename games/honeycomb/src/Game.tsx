// Honeycomb on the slot kit. The maths is all in slot.spec.json / slot.config.json / slot-facts.json.
import { SlotGame, parseSlotFacts } from '@originals/slots/ui';
import type { CellOverlayInfo, SlotGameConfig } from '@originals/slots/ui';
import type { SlotSpec } from '@originals/slots';
import { useMemo, useRef } from 'react';
import { honeycombFx, honeycombSymbols, honeycombTheme } from './art';
import config from './slot.config.json';
import { HONEY, copy } from './copy';
import spec from './slot.spec.json';
import factsRaw from './slot-facts.json';
import manifest from './manifest';

const S = spec as unknown as SlotSpec;
/** Honey cells needed on the board to start Honey Harvest (the mechanic's entry count). */
export const HONEY_NEEDED = (S.mechanics.find((m) => m.id === 'hold_and_spin_lock_respin')?.params as { entry_min: number }).entry_min;

/**
 * The base game's honey counter: once a base spin's board is shown, each honey cell carries "k/5", k its place in
 * reading order (reel by reel, top down), so the last one reads how many landed. The kit lays cells out in that
 * order, starting at reel 1, row 1, in each render. Not shown during the harvest (the kit's "Comb n/25" counts there).
 */
export function honeyCount(seen: { n: number }, cell: CellOverlayInfo): string | null {
  if (cell.col === 0 && cell.row === 0) seen.n = 0;
  if (cell.symbol !== HONEY) return null;
  seen.n += 1;
  if (!cell.decor || 'hold_and_spin_lock_respin.heldVals' in cell.decor) return null;
  return `${seen.n}/${HONEY_NEEDED}`;
}

export default function Game() {
  const facts = useMemo(() => parseSlotFacts(factsRaw), []);
  const seen = useRef({ n: 0 });
  return (
    <SlotGame
      manifest={{ id: manifest.id, name: manifest.name, accent: manifest.accent }}
      spec={S}
      config={config as unknown as SlotGameConfig}
      facts={facts}
      theme={honeycombTheme}
      symbols={honeycombSymbols}
      copy={copy}
      symbolFx={honeycombFx}
      renderOverlay={(cell) => {
        const t = honeyCount(seen.current, cell);
        return t ? (
          <span className="sl-badge" style={{ top: 3, bottom: 'auto', left: 3, right: 'auto', fontSize: 12 }}>
            {t}
          </span>
        ) : null;
      }}
    />
  );
}
