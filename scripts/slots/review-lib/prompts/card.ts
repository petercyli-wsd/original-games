// The rules card: a factual description of the slot, from its spec, config and
// source. The designer judges from it; it never evaluates.

import type { SlotEvidence } from '../evidence';
import { signatureText } from '../evidence';

export const CARD_SYSTEM = `You read the source of an online video slot and write a factual rules card: what the player sees, what pays, and how its special symbols and feature work. Another model will judge the slot from your card, so be accurate and concrete. Describe the player's experience, not the implementation.

How to read the maths:
- \`slot.spec.json\` is the base game: a game_spec_v2 document. \`symbols\` lists ids, short labels and roles (low, premium, wild, scatter). \`geometry\` gives the reels and rows. \`evaluation.kind\` is the evaluation law (payline, ways, cluster or scatter_pays), and \`evaluation.paylines\` lists the lines. \`pays.paytable\` maps symbol id → count → coins. \`mechanics\` lists the modifier families. \`trigger.scatter_min\` is the scatter count that starts the feature.
- Every pay in coins converts to a multiple of the total stake as coins ÷ \`bet.coins\`. Always quote pays as × stake, e.g. "5 Crowns on a line pay 12.5×". For payline games, a line pay is per line, as a share of the whole stake.
- \`slot.config.json\` declares the feature (free spins: the awards per scatter count, retriggers, the multiplier schedule, the most spins), the max-win cap in stakes, the volatility the theme promises, and the target RTP.
- A \`feature*.spec.json\` file is the spec the free spins use. Say how it differs from the base game: other strips, more wilds, other pays, a multiplier.
- The game's own source code gives the symbol names and art, the theme, the palette, the feature's name and presentation, and any text on screen.

Rules:
- Facts only. Do not praise, criticise or score anything. Never write "engaging", "exciting", "clear" or "well designed".
- If the files don't show something, say so plainly. For example: "No feature buy", or "The code does not show how a retrigger is presented".
- Name symbols as the player sees them (their art and names), with the spec label in brackets: "Crown (P1)".
- List every line of on-screen text that is 9 words or longer. A blind reviewer's sandbox hides such lines, so the judge needs to know what the player could not read.`;

export function cardUser(e: SlotEvidence, files: { path: string; content: string; truncated: boolean }[]): string {
  const json = (x: unknown) => JSON.stringify(x, null, 2);
  const code = files.map((f) => `<file path="${f.path}"${f.truncated ? ' truncated="true"' : ''}>\n${f.content}\n</file>`).join('\n\n');
  return `Manifest:
${json(e.manifest)}

Mechanism signature (from the pack's oracle and the config): ${signatureText(e.signature)}

slot.spec.json:
${e.spec ? json(e.spec) : '(missing)'}

slot.config.json:
${e.config ? json(e.config) : '(missing)'}

${e.featureSpecs.map((f) => `${f.file}:\n${json(f.spec)}`).join('\n\n') || 'No feature spec files.'}

Source files (theme, symbols, presentation):
${code || '(none)'}

Write the rules card for this slot.`;
}

const str = (description: string) => ({ type: 'string', description });

export const CARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'concept',
    'theme',
    'mechanism',
    'symbols',
    'wild',
    'scatter_and_trigger',
    'feature',
    'modifiers',
    'max_win',
    'declared_volatility',
    'win_presentation',
    'anticipation',
    'controls',
    'paytable_sheet',
    'art_direction',
    'long_text',
    'closest_known_slots',
  ],
  properties: {
    concept: str('The slot in one sentence: theme, mechanism, feature.'),
    theme: str('The setting and story, and what kind of session the theme suggests (big rare eruptions, steady small catches, a heist that builds).'),
    mechanism: str('The evaluation law and board: reels × rows, lines or ways (count and direction), cluster size, or scatter-pays minimum; the board law (fixed reels, reel sets, variable heights).'),
    symbols: {
      type: 'array',
      description: 'Every symbol, highest pay first.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'role', 'art', 'pays'],
        properties: {
          name: str('As the player sees it, with the spec label in brackets.'),
          role: { type: 'string', enum: ['premium', 'low', 'wild', 'scatter', 'other'] },
          art: str('What it looks like, in a few words.'),
          pays: str('Pays by count as × stake, e.g. "3: 0.5×, 4: 2×, 5: 10×", or "none".'),
        },
      },
    },
    wild: str('What the wild does exactly: what it substitutes for, which reels it lands on, any multiplier, sticky, expanding or walking behaviour. "No wild" if none.'),
    scatter_and_trigger: str('The scatter, where it lands, what it pays, and exactly what starts the feature.'),
    feature: str('What happens in the feature: spins awarded per scatter count, retriggers, the multiplier schedule, what changes on the reels, the most spins, a feature buy. "No feature" for a pure base game.'),
    modifiers: str('Each modifier family in plain words (tumbles, sticky wilds, mystery symbols, collectors...), or "none".'),
    max_win: str('The max-win cap in × stake and what happens when it is reached.'),
    declared_volatility: str('The volatility the game declares (config or manifest).'),
    win_presentation: str('How wins are shown: line, way or cluster highlights, amounts, count-up, big-win tiers, Turbo differences.'),
    anticipation: str('When the reels slow down or tease, and whether it is real (the trigger can still complete).'),
    controls: str('Bet, Spin, Autoplay, Turbo, the info or paytable sheet, a feature buy; anything else.'),
    paytable_sheet: str('What the paytable sheet shows: symbol pays, wild and scatter rules, feature rules, RTP and other facts.'),
    art_direction: str('Palette, symbol art style, how premiums differ from lows, how the feature changes the screen.'),
    long_text: { type: 'array', items: { type: 'string' }, description: 'Every on-screen text line of 9+ words (hidden from the blind player), verbatim. Empty if none.' },
    closest_known_slots: { type: 'array', items: { type: 'string' }, description: 'Well-known market slots with the same mechanism or feature (e.g. a "book" expanding-symbol free spins, Sweet Bonanza-style tumbling scatter pays, hold-and-win coins).' },
  },
};
