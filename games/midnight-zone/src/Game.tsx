import { SlotGame, parseSlotFacts, type CellOverlayInfo } from '@originals/slots/ui';
import type { SlotSpec } from '@originals/slots';
import { DEEP, midnightSymbols, midnightTheme } from './art';
import { copy, lockedRowLabel } from './copy';
import manifest from './manifest';
import spec from './slot.spec.json';
import featureSpec from './feature.spec.json';
import config from './slot.config.json';
import rawFacts from './slot-facts.json';

const facts = parseSlotFacts(rawFacts);
const featureRows = (featureSpec as unknown as SlotSpec).geometry.rows[0];
const visibleRows = (spec as unknown as SlotSpec).geometry.rows[0];

/** On the first reel of each locked deep row: the tumble that opens it. */
function renderOverlay({ col, row, symbol }: CellOverlayInfo) {
  if (symbol !== DEEP || col !== 0) return null;
  return (
    <span className="sl-badge" style={{ top: '50%', bottom: 'auto', left: '50%', right: 'auto', transform: 'translate(-50%, -50%)', fontSize: 11, whiteSpace: 'nowrap' }}>
      {lockedRowLabel(row, visibleRows, featureRows)}
    </span>
  );
}

export default function MidnightZone() {
  return (
    <SlotGame
      manifest={manifest}
      spec={spec as unknown as SlotSpec}
      featureSpecs={{ 'feature.spec.json': featureSpec as unknown as SlotSpec }}
      config={config as never}
      facts={facts}
      theme={midnightTheme}
      symbols={midnightSymbols}
      copy={copy}
      renderOverlay={renderOverlay}
    />
  );
}
