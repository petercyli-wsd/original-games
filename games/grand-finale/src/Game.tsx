import { SlotGame, parseSlotFacts, type CellOverlayInfo, type SlotCopy } from '@originals/slots/ui';
import { useRef } from 'react';
import manifest from './manifest';
import { finaleFx, finaleSymbols, finaleTheme } from './art';
import spec from './slot.spec.json';
import featureSpec from './feature.spec.json';
import config from './slot.config.json';
import factsRaw from './slot-facts.json';
import type { SlotSpec } from '@originals/slots';

const facts = parseSlotFacts(factsRaw);
const S = spec as unknown as SlotSpec;

/** The fuse (scatter) id and how many start the finale (the spec's trigger). */
export const FUSE = S.symbols.find((s) => s.role === 'scatter')!.id;
export const FUSES_NEEDED = (S.trigger as { scatter_min: number }).scatter_min;

/**
 * The fuse counter: once a spin's board is shown, each fuse carries "k/4", k its place in reading order
 * (reel by reel, top down), so the last one says how many are lit. The kit lays the cells out in that order,
 * starting at reel 1, row 1, in each render. Nothing shows while the reels spin (no decor yet).
 */
export function fuseCount(seen: { n: number }, cell: CellOverlayInfo): string | null {
  if (cell.col === 0 && cell.row === 0) seen.n = 0;
  if (cell.symbol !== FUSE) return null;
  seen.n += 1;
  if (!cell.decor) return null;
  return `${seen.n}/${FUSES_NEEDED}`;
}

// Short lines only: every line is under 9 words.
const copy: SlotCopy = {
  featureName: 'Finale spins',
  introNote: 'The show builds: ×1, ×2, ×3 …',
  featureRule: 'Spin n pays ×n, times the rockets.',
  rule: '10+ of a kind pays anywhere.',
  wildText: 'Counts for every firework at once. Adds +N.',
  scatterText: 'Fuse pays anywhere. 4 fuses = 12 spins.',
  decorLabels: { 'global_additive.wildMults': (v) => `+${v}` },
  extrasLabels: { 'SCATTER PAY': 'Fuse pay' },
  noWinMultiplier: 'label',
  paytableFirst: [2, 1],
};

export { copy };

export default function Game() {
  const seen = useRef({ n: 0 });
  return (
    <SlotGame
      manifest={manifest}
      spec={S}
      featureSpecs={{ 'feature.spec.json': featureSpec as unknown as SlotSpec }}
      config={config as never}
      facts={facts}
      theme={finaleTheme}
      symbols={finaleSymbols}
      copy={copy}
      symbolFx={finaleFx}
      renderOverlay={(cell) => {
        const t = fuseCount(seen.current, cell);
        return t ? (
          <span className="sl-badge" style={{ top: 3, bottom: 'auto', left: 3, right: 'auto', fontSize: 12 }}>
            {t}
          </span>
        ) : null;
      }}
    />
  );
}
