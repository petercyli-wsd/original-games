import { describe, expect, it } from 'vitest';
import { TRADEMARKS } from './evidence';

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
