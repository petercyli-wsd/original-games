import { describe, expect, it } from 'vitest';
import { expandSteps, LABELS, sessionShortfalls, SPIN_WAIT, type PlayLogEntry } from './play';

describe('expandSteps', () => {
  it('expands spin×N into press, wait and a numbered screenshot', () => {
    const e = expandSteps('shot:start;spin×2');
    expect(e.steps).toEqual(['shot:start', `text:${LABELS.spin}`, `wait:${SPIN_WAIT.normal}`, 'shot:spin-001', `text:${LABELS.spin}`, `wait:${SPIN_WAIT.normal}`, 'shot:spin-002']);
    expect(e.counts.spins).toBe(2);
    expect(e.textTags).toEqual(['spin', 'spin']);
  });

  it('accepts x and * for ×, and a custom wait', () => {
    expect(expandSteps('spinx3').counts.spins).toBe(3);
    expect(expandSteps('spin*2@500').steps[1]).toBe('wait:500');
  });

  it('waits less after turbo', () => {
    const e = expandSteps('turbo;spin');
    expect(e.steps).toContain(`wait:${SPIN_WAIT.turbo}`);
    expect(e.counts.turbo).toBe(true);
  });

  it('feature calls the kit dev hook at its place in the run', () => {
    const e = expandSteps('spin;feature;spin');
    expect(e.steps.slice(3, 5)).toEqual(['key:SlotFeature', 'wait:300']);
    expect(e.counts.feature).toBe(true);
    expect(() => expandSteps('key:SlotScroll')).toThrow(/not allowed/);
  });

  it('opens the paytable and watches autoplay', () => {
    const e = expandSteps('paytable;scroll;close;autoplay;watch×2@1000');
    expect(e.steps).toEqual([
      `text:${LABELS.paytable}`,
      'wait:700',
      'shot:paytable-1',
      'key:SlotScroll',
      'wait:300',
      'shot:paytable-2',
      'key:SlotScroll',
      'wait:300',
      'shot:paytable-3',
      'key:SlotScroll',
      'wait:300',
      'shot:paytable-4',
      'key:Escape',
      'wait:300',
      `text:${LABELS.autoplayTab}`,
      'wait:300',
      `text:${LABELS.autoplayStart}`,
      'wait:400',
      'wait:1000',
      'shot:watch-001',
      'wait:1000',
      'shot:watch-002',
    ]);
    expect(e.textTags).toEqual(['paytable', 'other', 'autoplay']);
    expect(e.counts).toMatchObject({ paytable: true, autoplay: true, watches: 2 });
  });

  it('refuses anything outside the sandbox, and too many spins', () => {
    expect(() => expandSteps('click:.sl-reels')).toThrow(/not allowed/);
    expect(() => expandSteps('log:window.__slotDev')).toThrow(/not allowed/);
    expect(() => expandSteps('until:1')).toThrow(/not allowed/);
    expect(() => expandSteps('spin×41')).toThrow(/At most 40/);
  });
});

describe('sessionShortfalls', () => {
  const entry = (p: Partial<PlayLogEntry>): PlayLogEntry => ({ run: 1, date: '', spins: 0, spinsOk: 0, watches: 0, turbo: false, autoplay: false, feature: false, paytable: false, failedClicks: 0, ...p });
  it('lists what the session lacks against the brief', () => {
    expect(sessionShortfalls([entry({ spins: 20, spinsOk: 20 })])).toEqual(['about 20 spins (< 60)', 'no Turbo', 'no Autoplay', 'no feature run', 'never opened the paytable']);
  });
  it('is empty for a full session (autoplay watch shots count as spins)', () => {
    const log = [entry({ spinsOk: 30, paytable: true }), entry({ spinsOk: 20, turbo: true }), entry({ autoplay: true, watches: 10 }), entry({ feature: true, spinsOk: 1 })];
    expect(sessionShortfalls(log)).toEqual([]);
  });
});
