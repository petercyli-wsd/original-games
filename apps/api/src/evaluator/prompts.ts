// Prompts and output schemas for the evaluator calls:
//   extract  game source  -> rules card (what the player sees and does)
//   player   the game's UI only, played blind -> player criteria + what the player understood
//   judge    rules card + measured facts + the player's understanding -> designer criteria
//   refine   human reviews vs AI scores -> a revised prompt version

import { CRITERION_KEYS, DEAD_STRUCTURE, criteriaFor, type CriterionDef, type CriterionKey, type PromptVersion, type Review } from '../shared.js';

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
export function judgeSystem(version: PromptVersion, catalogue: string, withPlayer = false): string {
  const criteria = criteriaFor(version.criteria, withPlayer ? 'designer' : 'all');
  const playerPart = withPlayer
    ? `

## The player test
A separate judge played the game blind, from its UI alone, and scored the player criteria (win condition, simplicity, odds, fun) itself; you do not score those. The request includes what that player believed the game was. Compare it with the rules card and grade the player's comprehension: "correct" if they had the win condition and the core mechanic right, "partial" if they had the gist but missed or misread something that matters to a bet, "wrong" if they misunderstood what wins or how the game works. A misunderstanding is the game's fault, not the player's.`
    : '';
  return `You evaluate casino "Originals" game concepts for a studio that prototypes many of them and needs to pick the best. Your scores are compared with the team's own reviews, so be candid and consistent: most prototypes are mediocre, and a 5 must be earned.

${BRIEF}

## Rubric
Score each criterion below from 1 to 5. Score each criterion independently; a game can be unique but illegible. Write your reasoning for a criterion before deciding its score, and ground it in the rules card and the measured facts. Use the whole scale.

${rubricText(criteria)}${playerPart}

## Dead structure (a factual check)
From the rules card, list what the board shows and animates during a round, and ask of each part: does it bear on whether the player wins, or on a decision they make? Dead structure is a part that looks as if it matters but does not. Examples the team called out: a random walk drawn in two directions when only the distance from the centre decides the result; a grid of many edges or cells when only the one the player backed can affect the bet; a pattern framing (keep the zigzag going) over what is really a run of independent higher-or-lower draws. The draw that decides the result is never dead structure, however it is animated (a ball bouncing down pegs to its slot, reels spinning, cards dealt, a wheel turning). Answer dead_structure:
- "none": everything the player watches bears on the result or on a decision.
- "some": a noticeable part of what is shown or animated is irrelevant, or the presentation promises a richer game than the maths delivers.
- "most": the result rests on a small part of the board, and the rest is decoration around a simpler game.
The team rated games with dead structure low however clear and elegant they were: watching things that do not matter makes the game feel random and pointless. The score caps follow in code; do not lower other criteria for it.

## Guidance from the team's reviews
${version.guidance}

## Reference games
Each request includes a few games the team has already reviewed, with their scores and comments. Use them to calibrate the level of your scores (what the team considers a 2 or a 4), not as templates: judge the game in front of you on its own merits. The game under review is never among its own references.

## Catalogue of existing games
Check uniqueness against these and against well-known market games (Dice, Limbo, Crash, Mines, Plinko, Keno, Blackjack, Baccarat, Coin Flip, HiLo, Tower, Chicken Road, Wheel). Set duplicate_of to a catalogue id only if a player would meet the same game twice: the same kind of board, the same visible draw and the same decision, with only the look or theme changed. Sharing a maths family (an exponential race, a fair cash-out ladder, a fixed-chance reveal) under a different board and draw is not a duplicate: the team rated such games very differently from each other, so judge them on the board, draw and decision the player meets, not on the maths alone. Otherwise leave duplicate_of empty.
${catalogue}

## Output
Return every criterion in the rubric above exactly once. Then list the strongest pros and the most important cons (two to four each), name the closest existing game, and give a one-sentence verdict with a recommendation: ship (strong as is), iterate (promising, fix the cons) or drop (not worth more work).`;
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
  player?: string,
): string {
  const playerText = player ? `\n\nWhat the blind player understood from playing the UI (grade it against the rules card):\n${player}` : '';
  return `Reference games the team has reviewed, lowest score first:
${referencesText(references)}

Evaluate the game "${name}" (id: ${id}).
Standing: ${standing}${playerText}

Rules card:
${JSON.stringify(card, null, 2)}

Measured facts (computed by simulation, not opinion):
${checks}

Monte Carlo eval:
${evalTable}`;
}

const criteriaSchema = (keys: readonly CriterionKey[]) => ({
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['key', 'reasoning', 'score'],
    properties: {
      key: { type: 'string', enum: [...keys] },
      reasoning: { type: 'string' },
      score: { type: 'integer', enum: [1, 2, 3, 4, 5] },
    },
  },
});

/** The designer judge's schema: its criteria, plus a comprehension grade when a player review exists. */
export function judgeSchema(keys: readonly CriterionKey[] = CRITERION_KEYS, withPlayer = false) {
  const required = ['criteria', 'pros', 'cons', 'closest_existing', 'duplicate_of', 'dead_structure', 'dead_structure_reasoning', 'verdict', 'recommendation'];
  return {
    type: 'object',
    additionalProperties: false,
    required: withPlayer ? [...required, 'player_comprehension', 'comprehension_reasoning'] : required,
    properties: {
      criteria: criteriaSchema(keys),
      pros: { type: 'array', items: str },
      cons: { type: 'array', items: str },
      closest_existing: { type: 'string' },
      duplicate_of: { type: 'string', description: 'A catalogue id, or empty.' },
      dead_structure: { type: 'string', enum: [...DEAD_STRUCTURE] },
      dead_structure_reasoning: { type: 'string', description: 'Which parts of the board bear on the result or a decision, and which do not.' },
      verdict: { type: 'string', description: 'One sentence on the whole game, taking the player test into account.' },
      recommendation: { type: 'string', enum: ['ship', 'iterate', 'drop'] },
      ...(withPlayer
        ? {
            player_comprehension: { type: 'string', enum: ['correct', 'partial', 'wrong'] },
            comprehension_reasoning: { type: 'string', description: 'What the player got right or wrong, versus the rules card.' },
          }
        : {}),
    },
  };
}

export const JUDGE_SCHEMA = judgeSchema();

// ---------------------------------------------------------------------------
// Player (blind UI review)
// ---------------------------------------------------------------------------

export function playerSystem(version: PromptVersion): string {
  return `You are play-testing a casino game for a studio, as a typical online casino player meeting it for the first time. You get no description, rules or source code: only the game's screen, which you can play. Paragraphs of explanatory text have been hidden, because the test is whether the game explains itself. Real players skim; they do not study numbers or charts, and they decide within a round or two whether they get it.

Your scores are compared with the team's own reviews. The team's experience so far: games whose win condition and odds a player could not read from the screen scored 1-2 with people, even when an expert could work them out. Do not be generous because you can deduce the rules with effort; judge what a casual player would get from one play.

## How to test
1. Look at the first screen and write down, before playing, what you think the game is.
2. Play one round with the default settings, taking screenshots as it unfolds. Then play once more if you need to, perhaps after changing one setting.
3. Write down what you understood: what wins, how the game works in one sentence, what you think your chances were (overall and at each step), and what the settings do. If you are guessing, say so.
4. Answer the three checks below. They are facts about the game, not opinions, and they set limits on your scores in code, so answer them strictly.
5. Only then score the criteria.

## Checks
- **outcome**: how is a round decided?
  - "direct": by random draws you watch, each of which plainly decides the result or moves you closer to or further from it: a number is rolled, a card is dealt, a tile is revealed, a ball lands, a multiplier stops, a racer moves, a match is won.
  - "pattern": by a property of what the random steps build up, which you have to check: whether lines cross, whether a grid fills or connects, whether a group survives or dies out, the shape of a path.
  - "hidden": by something you never see directly while playing; the screen shows clues, signals or estimates about it.
- **known_casino_game**: true only if this is a casino game you already know (cards like baccarat, blackjack or poker; dice; roulette; a wheel; slots; crash; limbo; mines; plinko; keno; a tower or ladder), so a regular player needs no explanation.
- **odds_source**: where your sense of your chances came from.
  - "see_why": you could have guessed roughly the chance yourself from the picture (the green share of a bar, safe tiles left, cards in a deck, half the wheel).
  - "trust": a percentage is shown, and you know which event it is for, but you could not say why it is that number.
  - "unclear": no chance is shown, or you were not sure what a shown number referred to.

## Rubric
Score each criterion from 1 to 5. Write your reasoning before each score and base it only on what you saw.

${rubricText(criteriaFor(version.criteria, 'player'))}

## Guidance from the team's reviews
${playerGuidance(version.guidance)}`;
}

/**
 * The guidance a blind player may see: the general and player paragraphs only.
 * The designer and benchmark paragraphs name games and say how they should
 * score, which would tell the player what to expect.
 */
export function playerGuidance(guidance: string): string {
  return guidance
    .split(/\n\s*\n/)
    .filter((p) => !/^[\s*_#]*(designer|benchmark)/i.test(p))
    .join('\n\n');
}

/** The blind player is never told which game it is playing: the tool names it by an alias. */
export function playerUser(tool: string, references: string): string {
  return `You are not told which game this is.

How the team scored some other games on these criteria (for the scale only; they are different games, unnamed):
${references}

Tool: you play the game with this command (Bash), and nothing else:
${tool}

Rules: run only that command, and read only the screenshots it writes (with the Read tool). Do not open any other file: not the game's source, docs, the rules card or earlier reviews. Keep to about 25 actions in total.`;
}

export const PLAYER_OUTCOMES = ['direct', 'pattern', 'hidden'];
export const PLAYER_ODDS_SOURCES = ['see_why', 'trust', 'unclear'];

export const playerSchema = (keys: readonly CriterionKey[]) => ({
  type: 'object',
  additionalProperties: false,
  required: ['first_impression', 'understanding', 'checks', 'criteria', 'confusions'],
  properties: {
    first_impression: { type: 'string', description: 'What you thought the game was from the first screen, before playing.' },
    checks: {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'known_casino_game', 'odds_source', 'reasoning'],
      properties: {
        outcome: { type: 'string', enum: PLAYER_OUTCOMES },
        known_casino_game: { type: 'boolean' },
        odds_source: { type: 'string', enum: PLAYER_ODDS_SOURCES },
        reasoning: { type: 'string', description: 'One or two sentences on each answer.' },
      },
    },
    understanding: {
      type: 'object',
      additionalProperties: false,
      required: ['win_condition', 'how_it_works', 'odds', 'settings', 'confidence'],
      properties: {
        win_condition: { type: 'string' },
        how_it_works: { type: 'string', description: 'The whole game in one sentence, as you would explain it to a friend.' },
        odds: { type: 'string', description: 'What you believed your chances were, overall and at each step, and how you could tell.' },
        settings: { type: 'string', description: 'What the settings seemed to do to your risk.' },
        confidence: { type: 'string', enum: ['sure', 'fairly sure', 'guessing'] },
      },
    },
    criteria: criteriaSchema(keys),
    confusions: { type: 'array', items: str, description: 'Moments you were unsure what was happening or what to do.' },
  },
});

// ---------------------------------------------------------------------------
// Refine
// ---------------------------------------------------------------------------

export const REFINE_SYSTEM = `You maintain the rubric of an automated evaluator for casino "Originals" games. The evaluator scores each game on fixed criteria; its overall score is a weighted mean. The team also reviews games by hand (1–5 stars plus comments). Your job is to revise the evaluator's prompt so its scores agree better with the team's judgment, without overfitting to a handful of reviews.

${BRIEF}

The overall is the weighted mean, then capped by the weakest of win condition, simplicity and odds, and (for prototypes) by uniqueness. Win condition, simplicity, odds and fun are scored by a blind player judge that only plays the UI; the rest by a judge that reads the rules card.

You may change:
- each criterion's weight (0 to 3) and its 1/3/5 descriptions; the criterion keys, names, questions and which judge scores them are fixed;
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
    .map(([id, reviews]) => `### ${id}\n${reviews.map((r) => `- ${r.stars}★${r.reviewer ? ` (${r.reviewer}${/pierre/i.test(r.reviewer) ? ', the manager, counts 3×' : ''})` : ''}: ${r.comment}`).join('\n')}`)
    .join('\n\n');

  return `Current version (id ${version.id}):
${JSON.stringify({ criteria: version.criteria, guidance: version.guidance, exemplars: version.exemplars }, null, 2)}

Training games (${rows.length}; another ${holdoutCount} reviewed ${holdoutCount === 1 ? 'game is' : 'games are'} held out to test your changes). Human average (weighted: Pierre, the manager, counts 3×) vs AI overall, with the AI's criterion scores:
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
