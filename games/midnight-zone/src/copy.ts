import type { SlotCopy } from '@originals/slots/ui';

// Every line is under 9 words (the blind reviewer cannot see longer text): checked by checkCopy in the tests.
export const copy: SlotCopy = {
  featureName: 'The Abyss',
  featureSpins: 'free spins',
  rule: '8 or more of a kind pay anywhere.',
  scatterText: 'Anglerfish lures pay nowhere. 4 start The Abyss.',
  // The rule of The Abyss: the board starts 6x5 with three dark rows below; each tumble opens the next one down.
  introNote: 'Each tumble opens a deeper row',
  featureRule: 'Each tumble opens a deeper row',
  featureNotes: ['Starts 6x5 with three dark rows below', 'Each tumble opens a deeper row', '31–48 of a kind pay as 20–30'],
  symbolText: { 12: '×2–×100, The Abyss up to ×500' },
};

/** The label on a locked deep row: the tumble of the spin that opens it ("Tumble 1" is the row just below the open board). */
export function lockedRowLabel(row: number, visibleRows: number, totalRows: number): string {
  const k = Math.min(totalRows, Math.max(visibleRows, row)) - visibleRows + 1;
  return `Tumble ${k}`;
}
