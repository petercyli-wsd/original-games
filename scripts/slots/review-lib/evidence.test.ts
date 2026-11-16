import { describe, expect, it } from 'vitest';
import { factsIntegrity, TRADEMARKS } from './evidence';

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

describe('factsIntegrity', () => {
  const oracle = { present: true, families: [], features: [], problems: [], specHash: 'aaa' };
  it('passes a facts file whose oracle check passed on the same spec', () => {
    expect(factsIntegrity({ specHash: 'aaa', oracle: { status: 'pass', detail: '' } }, oracle)).toEqual([]);
  });
  it('fails a failed or stale oracle check, and facts from another spec', () => {
    expect(factsIntegrity({ specHash: 'aaa', oracle: { status: 'stale', detail: 'spec changed' } }, oracle)).toEqual(['oracle check stale in slots:eval: spec changed']);
    expect(factsIntegrity({ specHash: 'bbb', oracle: { status: 'pass' } }, oracle)).toEqual([expect.stringMatching(/different specs/)]);
  });
  it('fails facts that slots:eval did not write (no oracle check or no specHash)', () => {
    expect(factsIntegrity({ rtp: 0.96, note: 'game-local script' }, oracle)).toEqual([expect.stringMatching(/^facts not from slots:eval/)]);
    expect(factsIntegrity({ oracle: { status: 'pass' } }, oracle)).toEqual([expect.stringMatching(/^facts not from slots:eval/)]);
  });
});
