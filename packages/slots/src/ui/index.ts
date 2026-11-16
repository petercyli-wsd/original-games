// The slot UI kit (docs/SLOT-STYLE.md). A game mounts `SlotGame` with its spec, theme, symbol art,
// config and facts; the rest of the exports are the parts it is built from.

export { SlotGame } from './SlotGame';
export { ReelWindow, type ReelWindowHandle, type ReelWindowProps, type SpinOpts } from './ReelWindow';
export { PayTableSheet, rtpText, themeVars } from './PayTableSheet';
export { Card, RollNumber, WinChip, type CardProps, type RollHandle } from './parts';
export { slotGameStyles, slotStyles } from './styles';
export { createSeedSource, installDevHooks, resolveEngine, seededRng32, type Draw, type FeatureKind, type SeedSource } from './engine-bridge';
export { TIER_LABEL, anticipationPlan, bigWinTier, decorOverlays, parseSlotFacts, reelTimings, rollMs } from './util';
export type * from './types';
