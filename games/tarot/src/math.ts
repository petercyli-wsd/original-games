// Tarot (Stake's three-card reading, rebuilt): three cards are drawn
// independently from the same deck and revealed left to right. Each card shows
// a multiplier and the payout is the product of the three.
//
// Exact RTP. For independent cards, E[X₁·X₂·X₃] = E[X₁]·E[X₂]·E[X₃] = E[X]³.
// Every deck is priced so that E[X] = ∛0.99 exactly, hence RTP = (∛0.99)³ = 0.99
// exactly, for every risk level.
//
// How a deck hits ∛0.99 exactly. The face values v₀ < v₁ < … < vₙ are round
// numbers, and the cards above the floor card v₀ carry shape weights wᵢ. Their
// probabilities are pᵢ = s·wᵢ with the single scale
//
//     s = (∛0.99 − v₀) / Σᵢ₌₁ⁿ wᵢ (vᵢ − v₀),
//
// and the floor card takes the rest, p₀ = 1 − Σᵢ₌₁ⁿ pᵢ. Then
// E[X] = v₀ + Σ pᵢ(vᵢ − v₀) = v₀ + (∛0.99 − v₀) = ∛0.99, a closed form with no
// fitting. The draw is an inverse-CDF lookup on one uniform, so these real-valued
// probabilities are honoured to double precision. The tests check E[X]³ = 0.99
// both from the formula and by enumerating all n³ card triples.
//
// Risk only reshapes the deck (more Tower cards, bigger top cards); the mean
// card is ∛0.99 on every deck, so risk changes volatility, never the return.

export const RTP = 0.99;
/** The exact mean of one card on every deck: ∛RTP. */
export const CARD_MEAN = Math.cbrt(RTP);
export const CARDS_PER_ROUND = 3;

export type Risk = 'low' | 'medium' | 'high' | 'extreme';
export const RISKS: Risk[] = ['low', 'medium', 'high', 'extreme'];
export const RISK_NAMES: Record<Risk, string> = { low: 'Low', medium: 'Medium', high: 'High', extreme: 'Extreme' };

export type Arcana = 'tower' | 'moon' | 'hermit' | 'temperance' | 'star' | 'chariot' | 'fortune' | 'sun' | 'world';
export const ARCANA_NAMES: Record<Arcana, string> = {
  tower: 'The Tower',
  moon: 'The Moon',
  hermit: 'The Hermit',
  temperance: 'Temperance',
  star: 'The Star',
  chariot: 'The Chariot',
  fortune: 'Fortune',
  sun: 'The Sun',
  world: 'The World',
};
export const ARCANA_NUMERALS: Record<Arcana, string> = {
  tower: 'XVI',
  moon: 'XVIII',
  hermit: 'IX',
  temperance: 'XIV',
  star: 'XVII',
  chariot: 'VII',
  fortune: 'X',
  sun: 'XIX',
  world: 'XXI',
};

interface CardDef {
  arcana: Arcana;
  value: number;
  /** Shape weight; ignored for the floor card (index 0), which takes the remainder. */
  weight: number;
}

// Face values ascending. Index 0 is the floor card whose probability balances the deck.
const DECK_DEFS: Record<Risk, CardDef[]> = {
  low: [
    { arcana: 'moon', value: 0.4, weight: 0 },
    { arcana: 'hermit', value: 0.7, weight: 20 },
    { arcana: 'temperance', value: 1, weight: 30 },
    { arcana: 'star', value: 1.25, weight: 18 },
    { arcana: 'chariot', value: 1.5, weight: 10 },
    { arcana: 'sun', value: 2, weight: 5 },
    { arcana: 'world', value: 3, weight: 1.4 },
  ],
  medium: [
    { arcana: 'tower', value: 0, weight: 0 },
    { arcana: 'moon', value: 0.3, weight: 16 },
    { arcana: 'hermit', value: 0.6, weight: 22 },
    { arcana: 'temperance', value: 1, weight: 22 },
    { arcana: 'star', value: 1.5, weight: 14 },
    { arcana: 'chariot', value: 2, weight: 9 },
    { arcana: 'fortune', value: 3, weight: 5 },
    { arcana: 'sun', value: 5, weight: 2 },
    { arcana: 'world', value: 10, weight: 0.6 },
  ],
  high: [
    { arcana: 'tower', value: 0, weight: 0 },
    { arcana: 'moon', value: 0.2, weight: 16 },
    { arcana: 'hermit', value: 0.5, weight: 18 },
    { arcana: 'temperance', value: 1, weight: 14 },
    { arcana: 'star', value: 2, weight: 10 },
    { arcana: 'chariot', value: 3, weight: 6 },
    { arcana: 'fortune', value: 5, weight: 3.5 },
    { arcana: 'sun', value: 10, weight: 1.6 },
    { arcana: 'world', value: 20, weight: 0.6 },
  ],
  extreme: [
    { arcana: 'tower', value: 0, weight: 0 },
    { arcana: 'hermit', value: 0.5, weight: 10 },
    { arcana: 'temperance', value: 1, weight: 10 },
    { arcana: 'star', value: 2, weight: 8 },
    { arcana: 'chariot', value: 4, weight: 5 },
    { arcana: 'fortune', value: 8, weight: 3 },
    { arcana: 'sun', value: 15, weight: 1.2 },
    { arcana: 'world', value: 30, weight: 0.4 },
  ],
};

export interface Card {
  arcana: Arcana;
  value: number;
  /** Exact probability of drawing this card. */
  p: number;
}

/** pᵢ = s·wᵢ above the floor, floor = remainder (see header). */
function buildDeck(defs: CardDef[]): Card[] {
  const v0 = defs[0].value;
  let spread = 0;
  for (let i = 1; i < defs.length; i++) spread += defs[i].weight * (defs[i].value - v0);
  const s = (CARD_MEAN - v0) / spread;
  const cards: Card[] = defs.map((d, i) => ({ arcana: d.arcana, value: d.value, p: i === 0 ? 0 : s * d.weight }));
  let rest = 0;
  for (let i = 1; i < cards.length; i++) rest += cards[i].p;
  cards[0].p = 1 - rest;
  return cards;
}

export const DECKS: Record<Risk, Card[]> = {
  low: buildDeck(DECK_DEFS.low),
  medium: buildDeck(DECK_DEFS.medium),
  high: buildDeck(DECK_DEFS.high),
  extreme: buildDeck(DECK_DEFS.extreme),
};

/** Exact mean of one card (= ∛0.99 by construction). */
export const cardMean = (risk: Risk) => DECKS[risk].reduce((a, c) => a + c.p * c.value, 0);

/** The top card's value; the top prize is its cube. */
export const topCard = (risk: Risk) => DECKS[risk][DECKS[risk].length - 1].value;
export const topPrize = (risk: Risk) => topCard(risk) ** CARDS_PER_ROUND;
export const MAX_MULTIPLIER = Math.max(...RISKS.map(topPrize));

/** Product of face values, snapped to 6 decimals (every face has ≤ 2, so this is the exact product). */
export const productOf = (values: number[]) => Math.round(values.reduce((a, v) => a * v, 1) * 1e6) / 1e6;

/** Inverse-CDF draw of one card index from a uniform u ∈ [0, 1). */
export function drawIndex(risk: Risk, u: number): number {
  const deck = DECKS[risk];
  let acc = 0;
  for (let i = 0; i < deck.length - 1; i++) {
    acc += deck[i].p;
    if (u < acc) return i;
  }
  return deck.length - 1;
}

export interface Reading {
  /** Card indices into DECKS[risk], left to right. */
  cards: number[];
  values: number[];
  multiplier: number;
}

/** One round: three independent draws (exactly three uniforms), payout = product. */
export function playRound(next: () => number, risk: Risk): Reading {
  const cards: number[] = [];
  for (let i = 0; i < CARDS_PER_ROUND; i++) cards.push(drawIndex(risk, next()));
  const values = cards.map((i) => DECKS[risk][i].value);
  return { cards, values, multiplier: productOf(values) };
}

export interface Outcome {
  multiplier: number;
  p: number;
}

const distCache = new Map<Risk, Outcome[]>();

/** The exact payout distribution, by enumerating every ordered triple of cards. */
export function distribution(risk: Risk): Outcome[] {
  const hit = distCache.get(risk);
  if (hit) return hit;
  const deck = DECKS[risk];
  const map = new Map<number, number>();
  for (const a of deck)
    for (const b of deck)
      for (const c of deck) {
        const m = productOf([a.value, b.value, c.value]);
        map.set(m, (map.get(m) ?? 0) + a.p * b.p * c.p);
      }
  const out = [...map.entries()].map(([multiplier, p]) => ({ multiplier, p })).sort((x, y) => x.multiplier - y.multiplier);
  distCache.set(risk, out);
  return out;
}

/** Exact RTP of a deck, by enumeration. */
export const rtpOf = (risk: Risk) => distribution(risk).reduce((a, o) => a + o.p * o.multiplier, 0);

/** P(payout > x), exact. */
export const chanceAbove = (risk: Risk, x: number) => distribution(risk).reduce((a, o) => a + (o.multiplier > x + 1e-12 ? o.p : 0), 0);
/** P(payout ≥ x), exact. */
export const chanceAtLeast = (risk: Risk, x: number) => distribution(risk).reduce((a, o) => a + (o.multiplier >= x - 1e-12 ? o.p : 0), 0);

/** Chance the round returns more than the stake. */
export const profitChance = (risk: Risk) => chanceAbove(risk, 1);
/** Chance the round pays anything at all (no Tower drawn). */
export const returnChance = (risk: Risk) => chanceAbove(risk, 0);

/** Exact standard deviation of the payout: Var = E[X²]³ − E[X]⁶. */
export function stdDevOf(risk: Risk) {
  const m2 = DECKS[risk].reduce((a, c) => a + c.p * c.value * c.value, 0);
  return Math.sqrt(m2 ** 3 - CARD_MEAN ** 6);
}

export const RISK_VOL: Record<Risk, Risk> = { low: 'low', medium: 'medium', high: 'high', extreme: 'extreme' };
