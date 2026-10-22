// HiLo (Stake, BC.Game, Shuffle): guess whether the next card is higher or
// lower than the one showing.
//
// The deck is infinite: every card is an independent draw, rank uniform on
// A(1)…K(13) and suit uniform on the four suits (suits matter only for the
// Red / Black calls). From a card of rank r the calls are
//
//   Higher or same   wins on ranks r…13       P = (14 − r)/13
//   Lower or same    wins on ranks 1…r        P = r/13
//   at an Ace:  Higher (2…13, P = 12/13) and Same (P = 1/13)
//   at a King:  Lower  (1…12, P = 12/13) and Same (P = 1/13)
//   Extended calls:  Same rank (1/13), Red (1/2), Black (1/2).
//
// Pricing (one edge, applied once): the round starts with a cash-out value of
// RTP = 0.99 × stake, and a correct call with probability P multiplies it by
// exactly 1/P. So for every call E[cash after] = P · cash/P + (1 − P) · 0 = cash:
// the cash-out is a martingale from 0.99. Skipping a card draws a new one and
// leaves the value unchanged. By optional stopping, every strategy (which
// calls, which skips, when to cash out, Auto rules) returns exactly 99%.
// (Stake compounds 0.99 on every guess; ours keeps the single 1% edge.)
//
// Max win: a call is refused when winning it would push the cash-out above
// MAX_WIN, and the round cashes out automatically once no call on any card
// could stay under it (cash × 13/12 > MAX_WIN). Both are choice restrictions /
// stopping rules, so the RTP is unchanged and MAX_WIN bounds every payout.
//
// Auto "win streak" chance is exact: the current rank is a 13-state Markov
// chain, so P(n correct calls in a row) is a product of 13×13 transfer steps.

export const RTP = 0.99;
export const RANKS = 13;
export const MAX_WIN = 100_000;
export const MAX_MULTIPLIER = MAX_WIN;

export interface Card {
  /** 1 = Ace … 13 = King. */
  rank: number;
  /** 0 ♠, 1 ♥, 2 ♦, 3 ♣. */
  suit: number;
}

export type Guess = 'higher' | 'lower' | 'same' | 'red' | 'black';
export type Calls = 'classic' | 'extended';

export const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export const SUIT_GLYPH = ['♠', '♥', '♦', '♣'] as const;
export const isRed = (suit: number) => suit === 1 || suit === 2;

export const drawCard = (rng: { int(n: number): number }): Card => ({ rank: 1 + rng.int(RANKS), suit: rng.int(4) });

const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

/** The ranks that win a rank call from `rank` (empty when the call isn't offered there). */
export function winningRanks(guess: Guess, rank: number): number[] {
  switch (guess) {
    case 'higher':
      return rank === RANKS ? [] : rank === 1 ? range(2, RANKS) : range(rank, RANKS);
    case 'lower':
      return rank === 1 ? [] : rank === RANKS ? range(1, RANKS - 1) : range(1, rank);
    case 'same':
      return [rank];
    default:
      return [];
  }
}

/** Exact chance that a call wins from a card of this rank. */
export function chance(guess: Guess, rank: number): number {
  if (guess === 'red' || guess === 'black') return 1 / 2;
  return winningRanks(guess, rank).length / RANKS;
}

/** The two big buttons: at an Ace "Higher / Same", at a King "Same / Lower". */
export const mainPair = (rank: number): [up: Guess, down: Guess] => [rank === RANKS ? 'same' : 'higher', rank === 1 ? 'same' : 'lower'];

export function available(guess: Guess, rank: number, calls: Calls): boolean {
  if (mainPair(rank).includes(guess)) return true;
  return calls === 'extended' && (guess === 'same' || guess === 'red' || guess === 'black');
}

export function wins(guess: Guess, from: Card, to: Card): boolean {
  if (guess === 'red') return isRed(to.suit);
  if (guess === 'black') return !isRed(to.suit);
  return winningRanks(guess, from.rank).includes(to.rank);
}

/** The multiplier a correct call applies: exactly 1 / P. */
export const factor = (guess: Guess, rank: number) => 1 / chance(guess, rank);

export const afterWin = (cash: number, guess: Guess, rank: number) => cash * factor(guess, rank);

/** Whether winning this call keeps the cash-out within the max win. */
export const withinCap = (cash: number, guess: Guess, rank: number) => chance(guess, rank) > 0 && afterWin(cash, guess, rank) <= MAX_WIN * (1 + 1e-12);

/** No call on any card can stay under the cap (the smallest factor is 13/12): the round cashes out. */
export const maxWinReached = (cash: number) => (cash * RANKS) / (RANKS - 1) > MAX_WIN * (1 + 1e-12);

export function guessLabel(guess: Guess, rank: number): string {
  switch (guess) {
    case 'higher':
      return rank === 1 ? 'Higher' : 'Higher or same';
    case 'lower':
      return rank === RANKS ? 'Lower' : 'Lower or same';
    case 'same':
      return 'Same';
    case 'red':
      return 'Red';
    case 'black':
      return 'Black';
  }
}

/** The call with the better chance (Higher or same on a 7). */
export function likelier(rank: number): Guess {
  const [up, down] = mainPair(rank);
  return chance(up, rank) >= chance(down, rank) ? up : down;
}

// ---------- Auto ----------

export type AutoPick = 'likelier' | 'higher' | 'lower' | 'random';
export const AUTO_PICKS: AutoPick[] = ['likelier', 'higher', 'lower', 'random'];

/** Middle ranks Auto skips (free redraws) instead of calling. */
export const SKIP_SETS = { off: [] as number[], '7': [7], '6-8': [6, 7, 8], '5-9': [5, 6, 7, 8, 9] };
export type SkipRule = keyof typeof SKIP_SETS;
export const SKIP_RULES = Object.keys(SKIP_SETS) as SkipRule[];

export type AutoStop = { kind: 'target'; value: number } | { kind: 'streak'; value: number };

/** Ranks on which a rule always skips: the middle set, plus K for "Higher" and A for "Lower". */
export function skipSet(pick: AutoPick, skip: SkipRule): Set<number> {
  const s = new Set(SKIP_SETS[skip]);
  if (pick === 'higher') s.add(RANKS);
  if (pick === 'lower') s.add(1);
  return s;
}

/** What an Auto rule does on a card. `u` is a uniform draw, used by "random". */
export function autoChoice(pick: AutoPick, rank: number, skip: SkipRule, u: number): Guess | 'skip' {
  if (skipSet(pick, skip).has(rank)) return 'skip';
  const [up, down] = mainPair(rank);
  switch (pick) {
    case 'likelier':
      return likelier(rank);
    case 'higher':
      return 'higher';
    case 'lower':
      return 'lower';
    case 'random':
      return u < 0.5 ? up : down;
  }
}

/** The calls a rule makes on a card, with their weights (random splits 50/50). */
function ruleCalls(pick: AutoPick, rank: number, skip: SkipRule): { guess: Guess; w: number }[] {
  if (pick === 'random') {
    const [up, down] = mainPair(rank);
    return [
      { guess: up, w: 0.5 },
      { guess: down, w: 0.5 },
    ];
  }
  const g = autoChoice(pick, rank, skip, 0);
  return g === 'skip' ? [] : [{ guess: g, w: 1 }];
}

/**
 * Exact P(n correct calls in a row) for an Auto rule, starting from a fixed
 * rank or a random card. The current rank is a Markov chain: a skipped card
 * is redrawn until a callable one shows (uniform over callable ranks), then a
 * call moves the mass to the winning ranks. (The max-win auto cash-out can
 * only add to this, by at most 0.99 / (MAX_WIN · 12/13) ≈ 1e-5.)
 */
export function streakChance(pick: AutoPick, skip: SkipRule, n: number, start: number | null = null): number {
  const skipping = skipSet(pick, skip);
  const callable = range(1, RANKS).filter((r) => !skipping.has(r));
  let d = new Array<number>(RANKS + 1).fill(0);
  if (start === null) for (let r = 1; r <= RANKS; r++) d[r] = 1 / RANKS;
  else d[start] = 1;
  for (let step = 0; step < n; step++) {
    // Skip: mass on skipped ranks is redrawn onto the callable ones.
    let held = 0;
    for (const r of skipping) {
      held += d[r];
      d[r] = 0;
    }
    for (const r of callable) d[r] += held / callable.length;
    const next = new Array<number>(RANKS + 1).fill(0);
    for (const r of callable) {
      if (d[r] === 0) continue;
      for (const { guess, w } of ruleCalls(pick, r, skip)) for (const r2 of winningRanks(guess, r)) next[r2] += (d[r] * w) / RANKS;
    }
    d = next;
  }
  return d.reduce((a, b) => a + b, 0);
}

export interface Frame {
  card: Card;
  action: Guess | 'skip' | 'start';
  /** Whether the call that drew this card won (null for start and skips). */
  won: boolean | null;
  /** The cash-out multiplier after this card. */
  cash: number;
}

export type AutoOutcome = 'bust' | 'cashed' | 'max';

export interface AutoResult {
  frames: Frame[];
  multiplier: number;
  outcome: AutoOutcome;
  /** Correct calls made. */
  wins: number;
}

const MAX_AUTO_SKIPS = 400;

/** Plays one whole Auto round: the rule calls or skips until it busts, hits its stop, or the max win. */
export function autoRound(
  { pick, skip, stop, start, limit = Infinity }: { pick: AutoPick; skip: SkipRule; stop: AutoStop; start: Card | null; /** Also cash out once the value reaches this (a take-profit). */ limit?: number },
  rng: { next(): number; int(n: number): number },
): AutoResult {
  let card = start ?? drawCard(rng);
  let cash = RTP;
  let won = 0;
  let skips = 0;
  const frames: Frame[] = [{ card, action: 'start', won: null, cash }];
  const done = () => won > 0 && (cash >= limit || (stop.kind === 'target' ? cash >= stop.value * (1 - 1e-12) : won >= stop.value));
  for (;;) {
    if (done()) return { frames, multiplier: cash, outcome: 'cashed', wins: won };
    const a = autoChoice(pick, card.rank, skip, rng.next());
    if (a === 'skip') {
      // A runaway run of skips (≈ never) ends by cashing out, or with a call.
      if (++skips > MAX_AUTO_SKIPS && won > 0) return { frames, multiplier: cash, outcome: 'cashed', wins: won };
      card = drawCard(rng);
      frames.push({ card, action: 'skip', won: null, cash });
      continue;
    }
    if (!withinCap(cash, a, card.rank)) return { frames, multiplier: cash, outcome: 'max', wins: won };
    const next = drawCard(rng);
    const ok = wins(a, card, next);
    cash = ok ? afterWin(cash, a, card.rank) : 0;
    frames.push({ card: next, action: a, won: ok, cash });
    if (!ok) return { frames, multiplier: 0, outcome: 'bust', wins: won };
    won++;
    card = next;
    if (maxWinReached(cash)) return { frames, multiplier: cash, outcome: 'max', wins: won };
  }
}

/**
 * P(an Auto "cash out at ×target" round reaches its target) for a rule.
 * An exact answer needs every reachable cash value (millions of states at
 * big targets), so this solves the same recursion on a fine grid in log-cash:
 * V_r(y) = Σ_call w · (1/13) Σ_{winning r'} V_{r'}(y + log factor), with
 * V = 1 once y reaches log(target / RTP) or the max win, and skipped ranks
 * taking the average over the callable ones. Every factor is at least 13/12,
 * so each grid point depends only on higher ones (solved top-down, linear
 * interpolation between points). With a step of 5e-4 in log-cash (6,000 to
 * 24,000 points) it matches the exact
 * enumeration to within about 0.5% (relative; the readout shows "≈") and runs in
 * a few milliseconds. It also gives the average payout of a win: RTP / P.
 */
export function targetChance(pick: AutoPick, skip: SkipRule, target: number, start: number | null = null): number {
  const top = Math.log(target / RTP);
  if (top <= 0) return 1;
  const capTop = Math.log(((MAX_WIN * (RANKS - 1)) / RANKS) * (1 + 1e-12) / RTP);
  const bins = Math.min(24_000, Math.max(6_000, Math.ceil(top / 5e-4)));
  const h = top / bins;
  const skipping = skipSet(pick, skip);
  const callable = range(1, RANKS).filter((r) => !skipping.has(r));
  const V = Array.from({ length: RANKS + 1 }, () => new Float64Array(bins + 1));
  const at = (r: number, y: number) => {
    if (y >= top * (1 - 1e-12) || y > capTop) return 1;
    const t = y / h;
    const j = Math.floor(t);
    const a = V[r][j];
    // Just below the target, hold the last grid value: the jump to 1 is exactly at the target.
    const b = j + 1 >= bins ? a : V[r][j + 1];
    return a + (b - a) * (t - j);
  };
  const plan = callable.map((r) => ({
    r,
    calls: ruleCalls(pick, r, skip).map(({ guess, w }) => ({ w: w / RANKS, step: Math.log(factor(guess, r)), to: winningRanks(guess, r) })),
  }));
  for (let i = bins - 1; i >= 0; i--) {
    const y = i * h;
    let sum = 0;
    for (const { r, calls } of plan) {
      let v = 0;
      for (const { w, step, to } of calls) for (const r2 of to) v += w * at(r2, y + step);
      V[r][i] = v;
      sum += v;
    }
    for (const r of skipping) V[r][i] = sum / callable.length;
  }
  if (start !== null) return V[start][0];
  let p = 0;
  for (let r = 1; r <= RANKS; r++) p += V[r][0] / RANKS;
  return p;
}
