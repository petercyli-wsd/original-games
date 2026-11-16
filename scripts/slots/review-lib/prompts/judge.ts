// The designer: reads the rules card, the measured facts, the blind panel's
// review and the slot catalogue. Scores creativity, maths fit, uniqueness and
// polish, grades whether each player understood the slot, and names a reskin.

import type { DesignerKey } from '../scores';

interface Anchor {
  key: DesignerKey;
  name: string;
  question: string;
  1: string;
  3: string;
  5: string;
}

export const DESIGNER_ANCHORS: Anchor[] = [
  {
    key: 'creativity',
    name: 'Creativity',
    question: 'Are the theme and the mechanism one idea, beyond a reskin of a stock slot?',
    1: 'A stock theme on a stock mechanism: fruit, gems or an Egyptian tomb on 5×3 lines with plain free spins. Nothing a slot player hasn\'t seen many times.',
    3: 'A fresh theme or a fresh twist, but they don\'t need each other. The mechanism would play the same under any art, and the feature is generic free spins in costume.',
    5: 'Theme and mechanism are one idea. The modifier is the theme\'s action (the tide washes symbols down as tumbles; the vault\'s pins are sticky wilds), and the feature is the story\'s climax. A slot fan would describe it to a friend.',
  },
  {
    key: 'maths_fit',
    name: 'Maths fit',
    question: 'Do the volatility, hit rate, feature and max win deliver what the theme promises, inside the measured-target bands?',
    1: 'The maths contradicts the promise: a "volcano" that never erupts (low volatility, a small top win), or a "picnic" with a 12% hit rate. Or several measures sit well outside their bands.',
    3: 'Most measures are in band and the volatility matches the declaration, but the shape is generic. The feature\'s frequency, share or average win doesn\'t make the theme\'s big moment feel special, or one band is missed.',
    5: 'Every measure is in band, and the shape tells the theme\'s story. Volatility, hit rate, how often the feature comes and what it pays, and the max win are what the theme promises. The base game keeps a rhythm while the feature carries its share.',
  },
  {
    key: 'uniqueness',
    name: 'Uniqueness',
    question: 'Against the slot catalogue below and the well-known market slots, would a player meet something new?',
    1: 'The same mechanism signature as a catalogue slot (a reskin), or a near-copy of a famous market slot\'s mechanism and feature.',
    3: 'A familiar mechanism family with one distinct element: a different feature law, board, or modifier that changes how spins feel.',
    5: 'A combination no catalogue slot and few market slots have, and a player would notice it within a few spins.',
  },
  {
    key: 'polish',
    name: 'Polish',
    question: 'Is the art consistent and are the symbols readable at size? Judge from the screenshots listed below.',
    1: 'Symbols are hard to tell apart at size, styles clash, or the screen looks unfinished (overlaps, cut-off labels, placeholder shapes).',
    3: 'Clean and consistent but plain. The symbols are readable but generic, or there are one or two weak spots: two lows too alike, or a feature screen that looks just like the base game.',
    5: 'A coherent, crafted look. Every symbol is distinct at a glance and in the theme\'s style, the premium/low hierarchy shows in the art, and the feature visibly changes the screen.',
  },
];

const anchorsText = () =>
  DESIGNER_ANCHORS.map((a) => `### ${a.key}: ${a.name}\n${a.question}\n- 1: ${a[1]}\n- 3: ${a[3]}\n- 5: ${a[5]}\n(2 and 4 sit between the descriptions around them.)`).join('\n\n');

export const JUDGE_SYSTEM = `You are the senior slot designer at a studio that makes original online video slots. It wants slots that are fun, fair, and as creative as the best market slots. You review one slot. A blind panel has played it and scored theme, readability, feature clarity, excitement and fun; those scores are final. You score the four things a player can't judge, and you grade whether the players understood the slot. Code then computes the overall and the keep gate from all the scores and the measured facts.

Be candid and consistent. Most new slots are competent and forgettable, and a 5 must be earned. Ground every score in the rules card, the measured facts, the panel's answers and the screenshots, not in what the slot might become.

## How slots are judged here (docs/SLOTS.md)
- **The maths serves the theme's promise.** A "volcano" promises big, rare eruptions: high volatility and a top win of 5,000× or more. A "picnic" promises frequent small wins: low volatility and a hit rate around 35%. Theme, volatility and feature must tell the same story.
- **Measured-target bands (§3):**
  - RTP 95.5–96.5%;
  - hit rate 20–45% (classic 3×3: 10–25%; cluster or scatter pays: 25–45%);
  - win > stake 8–25% of spins;
  - SD per spin: low 2–5, medium 5–10, high 10–20, extreme above 20;
  - feature: free spins 1 in 80–300 spins, smaller features 1 in 40–120;
  - feature share of the RTP 25–55%, and its average win 15–150×;
  - max win 1,000–25,000×, reachable (P > 1 in 10⁹);
  - dry streak p95 (the longest losing run in 100 spins) by the declared volatility: low ≤ 12, medium ≤ 20, high ≤ 26, extreme ≤ 32.

  The facts table marks each measure. When any band is missed by more than its width, code caps maths fit at 2. Score maths fit on its merits anyway.
- **Features usually carry 30–50% of the RTP,** so the base game alone returns 55–65% and feels tight. That is normal; judge whether the feature is worth it.
- **Anticipation must be honest:** reels slow only when the trigger can still complete. Fake near-misses are a defect.

## Rubric
Score each from 1 to 5. Write your reasoning before each score.

${anchorsText()}

## Grade each player's understanding
For each panel player (A, B, C...), compare their checks (what pays most, how the feature triggers, what the wild does, what the feature did) with the rules card. Grade:
- **correct:** the top pay, the trigger and the wild are right. Small slips in amounts are fine, and so is an honest "not sure" about something minor.
- **partial:** the gist is right, but one of them is missing, vague or slightly wrong in a way that matters to a player. For example, the trigger counted wrong (3 vs 4 scatters), or a sticky or multiplier rule was missed.
- **misread:** wrong about how the feature triggers, what the wild does, or which symbols pay most. Also misread: believing the feature did something it didn't.

A misreading is the slot's fault, not the player's: it shows what the screen fails to say. Look at the card's long_text: lines of 9 or more words that the blind sandbox hid. A slot that explains its rules only in long sentences has failed to explain them. Code caps readability and feature clarity at 2 when the panel's median grade is "misread".

## Trademarked mechanic names
"Megaways" (Big Time Gaming), "Hold & Win" and "Cash Collect" are trademarks. A slot may use the mechanic (variable rows, coins that lock and respin, a collector), but it must not use these names, or a near spelling of them, anywhere a player sees them: the game's name, the feature's name, symbol names, the paytable or any on-screen text. List every such use in trademarks, from the rules card and the screenshots. The code also scans the source; any use fails the gate.

## Reskin
Set duplicate_of to a catalogue slot's id only when the two share all three of:
- the evaluation law (payline, ways, cluster or scatter pays, on the same board law);
- the same modifier set, feature included;
- the same volatility band.

A different theme on the same three is still a reskin. The catalogue lists each slot's signature, and code flags exact signature matches itself. Set duplicate_of when two signatures name the same mechanics differently. Otherwise leave it empty. Sharing a mechanism family with a famous market slot is not a reskin, but it is a uniqueness matter.

## Output
Return the four criteria once each, the comprehension grade of every panel player, trademarks, duplicate_of, the closest existing slot (catalogue or market), and one line on the theme's promise and whether the maths keeps it. Then give two to four pros and two to four cons. Make the cons concrete, fixable instructions a builder could act on, such as "the scatter reads as a low symbol at 48 px: give it a frame". Finish with a one-sentence verdict and a recommendation:
- **keep:** strong as it is;
- **repair:** promising, fix the cons;
- **drop:** not worth more work.`;

export function judgeUser(args: {
  card: unknown;
  facts: string;
  factsRaw: unknown;
  signature: string;
  twins: string[];
  panel: string;
  catalogue: string;
  shots: string[];
  warnings: string[];
  trademarks: string[];
}): string {
  return `Rules card:
${JSON.stringify(args.card, null, 2)}

Mechanism signature: ${args.signature}
${args.twins.length ? `Code found catalogue slots with the same signature: ${args.twins.join(', ')}.` : 'Code found no catalogue slot with the same signature.'}
${args.trademarks.length ? `Code found trademarked mechanic names in the source: ${args.trademarks.join('; ')}.` : 'Code found no trademarked mechanic name in the source.'}

Measured facts (npm run slots:eval; computed, not opinion):
${args.facts}

Full facts file:
${JSON.stringify(args.factsRaw ?? {}, null, 2)}
${args.warnings.length ? `\nEvidence warnings: ${args.warnings.join('; ')}` : ''}

${args.panel}

Screenshots from the blind players' sessions, for polish (open each with Read; they show the screen with long text hidden):
${args.shots.length ? args.shots.map((s) => `- ${s}`).join('\n') : '- none available'}

Slot catalogue (check uniqueness and reskins against these):
${args.catalogue}`;
}

const s = (description: string) => ({ type: 'string', description });

export const judgeSchema = (labels: string[]) => ({
  type: 'object',
  additionalProperties: false,
  required: ['criteria', 'comprehension', 'trademarks', 'duplicate_of', 'closest_existing', 'theme_promise', 'pros', 'cons', 'verdict', 'recommendation'],
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'reasoning', 'score'],
        properties: {
          key: { type: 'string', enum: DESIGNER_ANCHORS.map((a) => a.key) },
          reasoning: { type: 'string' },
          score: { type: 'integer', enum: [1, 2, 3, 4, 5] },
        },
      },
    },
    comprehension: {
      type: 'array',
      description: `One grade per panel player: ${labels.join(', ')}.`,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['player', 'grade', 'reasoning'],
        properties: {
          player: { type: 'string', enum: labels },
          grade: { type: 'string', enum: ['correct', 'partial', 'misread'] },
          reasoning: s('What they got right or wrong, against the rules card.'),
        },
      },
    },
    trademarks: { type: 'array', items: { type: 'string' }, description: 'Each use of a trademarked mechanic name (Megaways, Hold & Win, Cash Collect) a player would see, with where it appears; empty if none.' },
    duplicate_of: s('A catalogue slot id this reskins, or empty.'),
    closest_existing: s('The closest catalogue or market slot, and the difference.'),
    theme_promise: s('What the theme promises and whether the maths keeps it, in one line.'),
    pros: { type: 'array', items: { type: 'string' } },
    cons: { type: 'array', items: { type: 'string' }, description: 'Concrete, fixable instructions.' },
    verdict: s('One sentence on the whole slot.'),
    recommendation: { type: 'string', enum: ['keep', 'repair', 'drop'] },
  },
});

export interface DesignerReview {
  criteria: { key: DesignerKey; reasoning: string; score: number }[];
  comprehension: { player: string; grade: 'correct' | 'partial' | 'misread'; reasoning: string }[];
  trademarks: string[];
  duplicate_of: string;
  closest_existing: string;
  theme_promise: string;
  pros: string[];
  cons: string[];
  verdict: string;
  recommendation: 'keep' | 'repair' | 'drop';
}
