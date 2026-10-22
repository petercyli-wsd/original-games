// Prompts and output schemas for the three evaluator calls:
//   extract  game source  -> rules card (what the player sees and does)
//   judge    rules card + measured facts -> criterion scores
//   refine   human reviews vs AI scores -> a revised prompt version

import { CRITERION_KEYS, type CriterionDef, type PromptVersion, type Review } from '../shared.js';

const BRIEF = `"Originals" are the casino games crypto casinos build in-house: purposefully simple, quick to load and play, with player-customisable volatility, and simple to understand. They are single-player. Most are built on mines-style maths (reveal safe cells, a survival ladder) or crash-style maths (a rising multiplier you cash out before a bust), though any maths concept could in principle carry one.

A good Original meets these conditions:
1. Gameplay can be fast or slow.
2. The player can customise volatility.
3. The win condition is clear.
4. Win probabilities are visually clear and intuitive as the game plays out.
5. There are usually checkpoints where the player can pause or continue quickly, and cash out during the pause.
6. The concept makes sense with geometry only; if it only makes sense with a particular theme, it is probably bad. (Least important.)`;

// ---------------------------------------------------------------------------
// Extract
// ---------------------------------------------------------------------------

export const EXTRACT_SYSTEM = `You read the source code of a casino "Originals" game and write a factual rules card: what the player sees and does. Another model will judge the game from your card alone, so be accurate and concrete, and describe the player's experience rather than the implementation.

${BRIEF}

Write each field in one to three plain sentences. Do not evaluate or praise the game. If the code does not show something (for example, there is no turbo mode), say so plainly instead of guessing.`;

export function extractUser(manifest: unknown, files: { path: string; content: string }[]): string {
  const code = files.map((f) => `<file path="${f.path}">\n${f.content}\n</file>`).join('\n\n');
  return `Manifest:\n${JSON.stringify(manifest, null, 2)}\n\nSource files:\n${code}\n\nWrite the rules card for this game.`;
}

const str = { type: 'string' };
export const RULES_CARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'concept',
    'win_condition',
    'odds_display',
    'volatility_controls',
    'checkpoints',
    'round_flow',
    'maths_family',
    'dynamics',
    'theme_dependence',
    'closest_known_games',
  ],
  properties: {
    concept: { type: 'string', description: 'The game in one sentence.' },
    win_condition: { type: 'string', description: 'What wins and what loses.' },
    odds_display: { type: 'string', description: 'How the current win probability appears on screen during a round.' },
    volatility_controls: { type: 'string', description: 'The settings the player can change and their effect on risk.' },
    checkpoints: { type: 'string', description: 'Where a round pauses and how cashing out works.' },
    round_flow: { type: 'string', description: 'The steps of a round from bet to result, and pace options such as turbo or auto.' },
    maths_family: { type: 'string', description: 'The underlying probability model or theorem.' },
    dynamics: {
      type: 'array',
      items: { type: 'string', enum: ['ladder', 'martingale', 'staged-reveal', 'choice', 'other'] },
      description: 'ladder: bust-or-climb; martingale: odds swing both ways; staged-reveal: a few reveals redraw the board; choice: the player picks elements.',
    },
    theme_dependence: { type: 'string', description: 'Whether the concept needs its theme or works as plain shapes.' },
    closest_known_games: { type: 'array', items: str, description: 'Well-known casino games with the same or similar maths.' },
  },
};

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

/** A team-reviewed game shown to the judge as a calibration reference. */
export interface ExemplarContext {
  name: string;
  /** One line on what the game is, so the reference means something. */
  concept: string;
  humanAverage: number;
  humanCount: number;
  /** Why it was picked: a scale pin, a similar game, or the refiner's note. */
  note: string;
  comments: string[];
}

function rubricText(criteria: CriterionDef[]): string {
  return criteria
    .map(
      (c) =>
        `### ${c.key}: ${c.name}\n${c.question}\n- 1: ${c.descriptors[1]}\n- 3: ${c.descriptors[3]}\n- 5: ${c.descriptors[5]}\n(2 and 4 sit between the descriptions around them.)`,
    )
    .join('\n\n');
}

// The system prompt depends only on the prompt version and the catalogue, so it
// is identical for every game in a batch and caches; per-game material
// (references, rules card, facts) goes in the user message.
export function judgeSystem(version: PromptVersion, catalogue: string): string {
  return `You evaluate casino "Originals" game concepts for a studio that prototypes many of them and needs to pick the best. Your scores are compared with the team's own reviews, so be candid and consistent: most prototypes are mediocre, and a 5 must be earned.

${BRIEF}

## Rubric
Score each criterion from 1 to 5 using the descriptions below. Score each criterion independently; a game can be unique but illegible. Write your reasoning for a criterion before deciding its score, and ground it in the rules card and the measured facts. Use the whole scale.

${rubricText(version.criteria)}

## Guidance from the team's reviews
${version.guidance}

## Reference games
Each request includes a few games the team has already reviewed, with their scores and comments. Use them to calibrate the level of your scores (what the team considers a 2 or a 4), not as templates: judge the game in front of you on its own merits. The game under review is never among its own references.

## Catalogue of existing games
Check uniqueness against these and against well-known market games (Dice, Limbo, Crash, Mines, Plinko, Keno, Blackjack, Baccarat, Coin Flip, HiLo, Tower, Chicken Road, Wheel). Set duplicate_of to a catalogue id only if the game under review is essentially the same maths and decision as that game with a different look; otherwise leave it empty.
${catalogue}

## Output
Return every criterion exactly once. Then list the strongest pros and the most important cons (two to four each), name the closest existing game, and give a one-sentence verdict with a recommendation: ship (strong as is), iterate (promising, fix the cons) or drop (not worth more work).`;
}

function referencesText(refs: ExemplarContext[]): string {
  if (!refs.length) return 'None yet: the team has not reviewed other games.';
  return refs
    .map((e) => {
      const said = e.comments.length ? `\n  Reviewers said: ${e.comments.map((c) => `"${c}"`).join(' ')}` : '';
      return `- ${e.name} (team: ${e.humanAverage.toFixed(1)}/5 from ${e.humanCount} ${e.humanCount === 1 ? 'review' : 'reviews'}). ${e.concept} [${e.note}]${said}`;
    })
    .join('\n');
}

export const CLASSIC_STANDING =
  'A proven casino classic: one of the benchmark games the studio already runs. Judge how well this implementation meets each criterion; as the original of its format it is not a reskin.';
export const PROTOTYPE_STANDING = 'A new prototype being considered for the catalogue.';

export function judgeUser(
  name: string,
  id: string,
  standing: string,
  card: unknown,
  checks: string,
  evalTable: string,
  references: ExemplarContext[],
): string {
  return `Reference games the team has reviewed, lowest score first:
${referencesText(references)}

Evaluate the game "${name}" (id: ${id}).
Standing: ${standing}

Rules card:
${JSON.stringify(card, null, 2)}

Measured facts (computed by simulation, not opinion):
${checks}

Monte Carlo eval:
${evalTable}`;
}

export const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['criteria', 'pros', 'cons', 'closest_existing', 'duplicate_of', 'verdict', 'recommendation'],
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'reasoning', 'score'],
        properties: {
          key: { type: 'string', enum: [...CRITERION_KEYS] },
          reasoning: { type: 'string' },
          score: { type: 'integer', enum: [1, 2, 3, 4, 5] },
        },
      },
    },
    pros: { type: 'array', items: str },
    cons: { type: 'array', items: str },
    closest_existing: { type: 'string' },
    duplicate_of: { type: 'string', description: 'A catalogue id, or empty.' },
    verdict: { type: 'string' },
    recommendation: { type: 'string', enum: ['ship', 'iterate', 'drop'] },
  },
};

// ---------------------------------------------------------------------------
// Refine
// ---------------------------------------------------------------------------

export const REFINE_SYSTEM = `You maintain the rubric of an automated evaluator for casino "Originals" games. The evaluator scores each game on fixed criteria; its overall score is a weighted mean. The team also reviews games by hand (1–5 stars plus comments). Your job is to revise the evaluator's prompt so its scores agree better with the team's judgment, without overfitting to a handful of reviews.

${BRIEF}

You may change:
- each criterion's weight (0 to 3) and its 1/3/5 descriptions; the criterion keys, names and questions are fixed;
- the guidance text: the lessons the evaluator should apply. Rewrite and consolidate it; do not just append. Keep it under 350 words;
- the curated exemplars: up to 4 reviewed games that teach something the rubric alone does not. The judge also sees the team's highest- and lowest-rated games and the most similar reviewed games, picked automatically, so don't spend exemplars on those. Explain in each note what the judge should learn from it.

Rules:
- Change only what the evidence supports. Where human reviews are few or conflict, keep the current wording.
- Write lessons as general principles, never as facts about specific games ("odds shown only as a number cap odds_legibility at 3", not "Slice deserves a 3"). Some reviewed games are held out to test whether your changes generalise.
- Explain the reason for each change in the changelog, citing the games and comments that motivated it.
- Proven games (Mines, Crash, Dice, Russian roulette) must keep scoring highly, and theme reskins must keep scoring low.`;

export function refineUser(
  version: PromptVersion,
  rows: { gameId: string; name: string; humanAverage: number; humanCount: number; ai: number | null; criteria: Record<string, number> | null }[],
  comments: Map<string, Review[]>,
  fittedWeights: Record<string, number> | null,
  anchorResults: string,
  holdoutCount: number,
): string {
  const table = rows
    .map(
      (r) =>
        `| ${r.gameId} | ${r.humanAverage.toFixed(2)} (${r.humanCount}) | ${r.ai?.toFixed(2) ?? 'n/a'} | ${
          r.criteria ? Object.entries(r.criteria).map(([k, v]) => `${k}=${v}`).join(' ') : ''
        } |`,
    )
    .join('\n');
  const commentText = [...comments]
    .map(([id, reviews]) => `### ${id}\n${reviews.map((r) => `- ${r.stars}★${r.reviewer ? ` (${r.reviewer})` : ''}: ${r.comment}`).join('\n')}`)
    .join('\n\n');

  return `Current version (id ${version.id}):
${JSON.stringify({ criteria: version.criteria, guidance: version.guidance, exemplars: version.exemplars }, null, 2)}

Training games (${rows.length}; another ${holdoutCount} reviewed ${holdoutCount === 1 ? 'game is' : 'games are'} held out to test your changes). Human average vs AI overall, with the AI's criterion scores:
| game | human (n) | AI | AI criteria |
|---|---|---|---|
${table}

Human review comments:
${commentText || 'None yet.'}

${fittedWeights ? `A least-squares fit of the human averages on the AI's criterion scores suggests these relative weights (treat as a hint; small samples are noisy):\n${JSON.stringify(fittedWeights)}\n` : ''}
Anchor results under the current version:
${anchorResults}

Propose the revised version.`;
}

export const REFINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['changelog', 'guidance', 'criteria', 'exemplars'],
  properties: {
    changelog: { type: 'string' },
    guidance: { type: 'string' },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'weight', 'descriptor_1', 'descriptor_3', 'descriptor_5'],
        properties: {
          key: { type: 'string', enum: [...CRITERION_KEYS] },
          weight: { type: 'number' },
          descriptor_1: str,
          descriptor_3: str,
          descriptor_5: str,
        },
      },
    },
    exemplars: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['gameId', 'note'],
        properties: { gameId: str, note: str },
      },
    },
  },
};
