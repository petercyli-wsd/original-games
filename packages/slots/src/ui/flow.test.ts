// A real flow test: SlotGame is rendered in a DOM and played (docs/SLOTS.md §2.2, docs/BUILDING-GAMES.md).
//   - `ticket.place()` is awaited before any seed is drawn and before the engine plays;
//   - a double press (clicks and Space) does not spin twice;
//   - the ticket settles once, with the round's total.
//
// It needs `jsdom` (a root devDependency, `jsdom@25.0.1`). Without it the test is skipped, with a notice, so a checkout
// that has not installed it still passes; set JSDOM_PATH to a jsdom install to run it from elsewhere.

import { createDemoHost, mountStandalone } from '@originals/game-sdk/dev';
import { createDemoWallet, createRng, createStore, seededSource } from '@originals/game-sdk';
import type { BetTicket, HostContext, HostSettings, Wallet } from '@originals/game-sdk';
import { defineReactGame } from '@originals/game-sdk/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { SlotRound, SpinResult } from '../engine/types';
import { reefDemo } from './demo/demos';
import { SlotGame } from './SlotGame';
import { slotGameStyles } from './styles';

type JsdomModule = { JSDOM: new (html: string, opts?: Record<string, unknown>) => { window: Window & typeof globalThis } };
const jsdom = (await import(process.env.JSDOM_PATH ?? 'jsdom').catch(() => null)) as JsdomModule | null;
if (!jsdom) console.warn('flow.test: jsdom is not installed; the SlotGame flow test is skipped (npm i -D jsdom@25.0.1)');

/** A one-line win: 2.5× the stake, no feature. */
function fixedRound(coins: number, bet: number): SlotRound {
  void bet;
  const board = [[7, 8, 9], [8, 9, 10], [9, 10, 7], [10, 7, 8], [7, 8, 9]];
  const base: SpinResult = {
    decor: {},
    extras: [],
    finalBoard: board,
    flags: [],
    set: 0,
    steps: [{ board, stepCoins: coins, wins: coins ? [{ cells: [[0, 0], [1, 0], [2, 0]], coins, label: 'L1 x3', lineIdx: 0, ways: null }] : [] }],
    stops: [0, 0, 0, 0, 0],
    totalCoins: coins,
    trigger: null,
  };
  return { seed: 1, base, feature: null, totalCoins: coins, capped: false };
}

/** The globals React DOM and the kit need, from jsdom (which has neither WAAPI nor layout). */
function setupDom() {
    const { JSDOM } = jsdom!;
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
    const w = dom.window as unknown as Record<string, unknown>;
    // The globals React DOM and the kit use.
    const g = globalThis as unknown as Record<string, unknown>;
    for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'KeyboardEvent', 'Event', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      Object.defineProperty(g, k, { value: w[k], configurable: true, writable: true });
    }
    g.IS_REACT_ACT_ENVIRONMENT = false;
    g.ResizeObserver = class {
      constructor(private cb: () => void) {}
      observe() {
        this.cb();
      }
      disconnect() {}
    };
    // The reel window measures its width and animates with WAAPI; jsdom has neither.
    (w.Element as { prototype: Record<string, unknown> }).prototype.getBoundingClientRect = () => ({ width: 800, height: 480, top: 0, left: 0, right: 800, bottom: 480, x: 0, y: 0, toJSON: () => ({}) });
    (w.Element as { prototype: Record<string, unknown> }).prototype.animate = (_k: unknown, o: { duration?: number }) => {
      const done = new Promise<void>((r) => setTimeout(r, Math.min(20, o?.duration ?? 0)));
      return { finished: done, finish() {}, cancel() {} };
    };

}

describe.skipIf(!jsdom)('SlotGame flow (rendered)', () => {
  it('awaits place() before drawing, ignores a double press, and settles once with the total', async () => {
    setupDom();
    const demo = reefDemo();
    const log: string[] = [];
    const base = createDemoWallet();
    const settled: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let placeCalls = 0;
    const wallet: Wallet = {
      currency: base.currency,
      balance: base.balance,
      async placeBet(amount: number): Promise<BetTicket> {
        placeCalls++;
        log.push('place:start');
        await gate; // the bet is not accepted until we say so
        const t = await base.placeBet(amount);
        log.push('place:accepted');
        return { id: t.id, amount: t.amount, settle: (m: number) => (settled.push(m), t.settle(m)) };
      },
    };
    const src = seededSource(5);
    const rng = createRng(() => (log.push('rng'), src()));
    const engine = {
      playRound: (seed: number) => (log.push('playRound'), fixedRound(250, demo.spec.bet.coins), { ...fixedRound(250, demo.spec.bet.coins), seed }),
    };
    const host: HostContext = { ...createDemoHost(), wallet, rng, settings: createStore<HostSettings>({ turbo: true, sound: false }) };

    const Game = () => createElement(SlotGame, { ...demo, engine });
    const root = document.getElementById('root')!;
    mountStandalone(defineReactGame(Game, { styles: slotGameStyles }), root, host);
    await new Promise((r) => setTimeout(r, 100));

    const spin = () => [...root.shadowRoot!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Spin') as HTMLButtonElement;
    expect(spin()).toBeTruthy();
    log.length = 0;

    // A double press: two clicks and the Space key, all before the bet is accepted.
    spin().click();
    spin().click();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    expect(placeCalls).toBe(1);
    expect(log).toEqual(['place:start']); // nothing drawn, the engine has not played, while the bet is pending

    release();
    await new Promise((r) => setTimeout(r, 4000)); // Turbo: the whole round plays out
    expect(log.slice(0, 3)).toEqual(['place:start', 'place:accepted', 'rng']); // the seed is drawn only after place() resolved
    expect(log.indexOf('playRound')).toBeGreaterThan(log.indexOf('place:accepted'));
    expect(log.filter((l) => l === 'playRound')).toHaveLength(1);
    expect(placeCalls).toBe(1);
    expect(settled).toEqual([2.5]); // once, with the total (250 coins of a 100-coin stake)
  }, 15000);

  it('a respin chain announces what starts, plays by itself and ends on its outro', async () => {
    setupDom();
    const demo = reefDemo();
    // A hold-and-spin style mechanic that starts with 3 respins; the chain that plays has 2 (not to be announced).
    const spec = { ...demo.spec, mechanics: [{ id: 'hold_and_spin_lock_respin', params: { coin_symbol: 7, entry_min: 6, respins: 3 } }] };
    const b0 = [[7, 8, 9], [8, 9, 10], [9, 10, 7], [10, 7, 8], [7, 8, 9]];
    const b1 = b0.map((c, i) => (i === 1 ? [10, 10, 10] : c));
    const b2 = b1.map((c, i) => (i === 2 ? [8, 8, 8] : c));
    const res = (steps: number[][][]) =>
      ({ decor: {}, extras: [], finalBoard: steps[steps.length - 1], flags: [], set: 0, steps: steps.map((board) => ({ board, stepCoins: 0, wins: [] })), stops: [0, 0, 0, 0, 0], totalCoins: 0, trigger: null }) as SpinResult;
    const base = res([b0, b1, b2]);
    const engine = { playRound: (seed: number) => ({ seed, base, feature: null, totalCoins: 0, capped: false }) as SlotRound };
    const host: HostContext = { ...createDemoHost(), settings: createStore<HostSettings>({ turbo: false, sound: false }) };
    const root = document.getElementById('root')!;
    mountStandalone(defineReactGame(() => createElement(SlotGame, { ...demo, spec, engine }), { styles: slotGameStyles }), root, host);
    await new Promise((r) => setTimeout(r, 100));
    const sr = root.shadowRoot!;
    const button = (label: string) => [...sr.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
    const until = async (f: () => unknown, ms = 12000) => {
      for (let t = 0; t < ms && !f(); t += 50) await new Promise((r) => setTimeout(r, 50));
      return f();
    };

    button('Spin')!.click();
    // The intro card says what starts and never the chain's length; a chain has no button to press (it plays by itself).
    expect(await until(() => /3 respins/.test(sr.querySelector('.sl-card')?.textContent ?? ''))).toBeTruthy();
    const card = sr.querySelector('.sl-card')!;
    expect(card.textContent).not.toContain('2 respins');
    expect(card.querySelector('button')).toBeNull();
    expect(sr.textContent).not.toMatch(/\d+ of \d+/);
    // The chain plays and ends on its outro card.
    expect(await until(() => /Total win/.test(sr.querySelector('.sl-card')?.textContent ?? ''), 10000)).toBeTruthy();
  }, 25000);

  it('after each round the newest chip is that round\'s paid ÷ its own stake, whatever the bet box says later', async () => {
    setupDom();
    const demo = reefDemo();
    const engine = { playRound: (seed: number) => ({ ...fixedRound(250, demo.spec.bet.coins), seed }) };
    const host: HostContext = { ...createDemoHost(), settings: createStore<HostSettings>({ turbo: true, sound: false }) };
    const root = document.getElementById('root')!;
    mountStandalone(defineReactGame(() => createElement(SlotGame, { ...demo, engine }), { styles: slotGameStyles }), root, host);
    await new Promise((r) => setTimeout(r, 100));
    const sr = root.shadowRoot!;
    const until = async (f: () => unknown, ms = 9000) => {
      for (let t = 0; t < ms && !f(); t += 50) await new Promise((r) => setTimeout(r, 50));
      return f();
    };
    const spinBtn = () => [...sr.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Spin') as HTMLButtonElement | undefined;
    const status = () => sr.querySelector('.og-status')?.textContent ?? '';
    const newest = () => sr.querySelector('.sl-hist .og-hist.now') as HTMLElement | null;

    // round 1 at a stake of 1.00: 250 coins of a 100-coin stake = 2.5×, paid 2.50
    await until(spinBtn);
    spinBtn()!.click();
    const first = await until(() => /Won 2\.50/.test(status()) && newest());
    expect(first).toBeTruthy();
    expect(newest()!.textContent).toBe('2.50× bet');
    expect(newest()!.title).toContain('Bet 1.00, paid 2.50');

    // the bet box changes after the round: nothing already shown is recomputed with the new stake
    const input = sr.querySelector('input[aria-label="Bet amount"]') as HTMLInputElement;
    ([...sr.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Double bet') as HTMLButtonElement).click(); // 1.00 → 2.00
    await new Promise((r) => setTimeout(r, 100));
    expect(status()).toContain('Won 2.50');
    expect(newest()!.textContent).toBe('2.50× bet');

    // round 2 at a stake of 2.00: the same 2.5×, paid 5.00; the first round's chip is now the second, unmarked
    await until(spinBtn);
    spinBtn()!.click();
    const second = await until(() => /Won 5\.00/.test(status()));
    expect(input.value).toBe('2.00');
    expect(second).toBeTruthy();
    expect(newest()!.textContent).toBe('2.50× bet');
    expect(newest()!.title).toContain('Bet 2.00, paid 5.00');
    const chips = [...sr.querySelectorAll('.sl-hist .og-hist')];
    expect(chips.map((c) => c.textContent)).toEqual(['2.50× bet', '2.50×']);
    expect((chips[1] as HTMLElement).title).toContain('Bet 1.00, paid 2.50');
  }, 30000);
});
