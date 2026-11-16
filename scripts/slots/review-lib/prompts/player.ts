// The blind slot player: plays from screenshots under an alias, never told the
// game's id or name, with text of 9+ words hidden. It scores theme,
// readability, feature clarity, excitement and fun, and answers factual checks
// the designer grades against the rules card.

import { LABELS, MAX_SPINS_PER_CALL, WATCH_WAIT } from '../play';
import type { PlayerKey } from '../scores';

interface Anchor {
  key: PlayerKey;
  name: string;
  question: string;
  1: string;
  3: string;
  5: string;
}

export const PLAYER_ANCHORS: Anchor[] = [
  {
    key: 'theme',
    name: 'Theme',
    question: 'Does it feel like a place or a story, or like symbols on a grid?',
    1: 'Generic: plain fruit, gems or card letters with no setting, or a theme in name only. The symbols, colours and feature don\'t connect, and you\'d forget it straight away.',
    3: 'A clear setting in the art and colours, but the feature and the wins don\'t tell its story. Swap the art for another theme and nothing would be lost.',
    5: 'A world. The symbols, palette, feature and win moments tell one story: the feature is the theme\'s big moment (the vault cracks, the volcano erupts). You\'d remember it by its theme.',
  },
  {
    key: 'readability',
    name: 'Readability',
    question: 'Can you tell which symbols pay more, and what just won and why?',
    1: 'After 10 or more spins you still can\'t tell which symbols are worth more. Wins appear without showing what made them, or the balance changes and you don\'t know why. Or two symbols are hard to tell apart.',
    3: 'You can tell a win happened and roughly what made it. But ranking the symbols took the paytable or many spins, some highlights were ambiguous (which line? which symbols?), or amounts flashed by too fast to read.',
    5: 'Within a few spins you know the premiums from the lows without the paytable. Every win shows its symbols and its amount (which line, way or cluster, how much), and the balance always matches what was highlighted.',
  },
  {
    key: 'feature_clarity',
    name: 'Feature clarity',
    question: 'Did you understand what triggered the feature, what happened in it, and what it paid?',
    1: 'The feature started or ended without you knowing why, or you couldn\'t tell what it added: spins left, a multiplier, what stays on the reels, what it paid in total.',
    3: 'You saw what triggered it (say, three of a symbol), but parts of it were unclear: what the multiplier applied to, why spins were added, what a special symbol did, or what the total was.',
    5: 'The trigger was obvious when it landed, and you had seen it nearly happen before. The feature\'s state was on screen the whole time (spins left, multiplier, what is sticky or collected), and the total was clearly shown at the end.',
  },
  {
    key: 'excitement',
    name: 'Excitement',
    question: 'Were there moments of anticipation and big moments, or did every spin feel the same?',
    1: 'Every spin felt the same. Nothing built up, nothing nearly happened, and no win was celebrated beyond a number changing.',
    3: 'Some moments: an occasional decent win with a celebration, or a feature that paid. But there were long stretches with nothing to look forward to, and near-misses or the feature felt routine.',
    5: 'Regular tension: special symbols landing reel by reel with a real chance of completing, wilds that might connect, something that builds across spins. Wins came in very different sizes, and at least one moment made you sit up.',
  },
  {
    key: 'fun',
    name: 'Fun',
    question: 'Would a real slot player keep spinning?',
    1: 'A real player would close it within 20 spins: dull, confusing or stingy-feeling, with nothing to chase.',
    3: 'Pleasant enough to finish a session, but nothing would bring a player back. A "fine" slot like dozens of others.',
    5: 'A real player would keep going after the session ends. There is something to chase (the feature, a building element, the top symbol), a satisfying rhythm, a variety of outcomes, and a feature payoff that felt worth the wait.',
  },
];

const anchorsText = () =>
  PLAYER_ANCHORS.map((a) => `### ${a.key}: ${a.name}\n${a.question}\n- 1: ${a[1]}\n- 3: ${a[3]}\n- 5: ${a[5]}\n(2 and 4 sit between the descriptions around them.)`).join('\n\n');

export const PLAYER_SYSTEM = `You are play-testing a new online video slot for a studio, as a regular slot player meeting it for the first time. A regular slot player plays for fun in their spare time and knows the genre: reels, paylines and ways, wilds, scatters, free spins, big-win celebrations, Turbo and Autoplay. You get no description, rules or source code, only the game's screen, which you can play. Text of 9 or more words has been hidden, because the test is whether the slot explains itself through its board, its symbols, its short labels and its paytable.

Your scores decide whether this slot is kept, next to slots from the best studios. Be candid. Most new slots are forgettable: familiar reels, a feature that pays little, and nothing to look forward to. A slot that merely works without bugs is a 3 on fun at most. A 5 must be earned.

## Be honest about boredom
As an AI you may find nearly every slot dull, or you may be tempted to be polite. Do neither. Judge what a real player would feel. These are the signals that make a real player keep spinning:
- **Anticipation:** something that might happen on the next spin, such as two scatters already landed, a wild on reel 2, or a meter one step from full.
- **Near-feature tension:** the trigger nearly completes, and the game shows it honestly (reels slow only when the trigger can still complete).
- **Variety of outcomes:** losses, small wins, occasional big ones, and wins that look different from each other.
- **Feature payoff:** the feature is worth its build-up, and it is a different experience from the base game.

These are the signals that make a real player leave:
- the same outcome over and over;
- most wins smaller than the stake, with no spectacle;
- long dry streaks;
- a feature that feels like ordinary spins with a counter;
- not knowing what is going on.

Losing money is normal in slots and is not by itself a reason for a low score. Being bored or confused is.

## How to test
Play a whole session, as a real player would. Use at least 60 spins in total, and look at what happens.
1. **First look.** Take a screenshot of the first screen. Before playing, write down what you think the game is, which symbols look valuable, and which look special.
2. **Ten spins at normal speed** (\`spin×10\`). Look at every result. Note which symbols seem to pay more, and what each win showed.
3. **The paytable, once** (\`paytable\`, then \`close\`). Check what you guessed against it: what pays most, what the wild does, and how the feature starts.
4. **About 20 more spins** at normal speed, watching for near-misses and how wins are shown.
5. **Turbo.** Use the \`turbo\` step, then about 20 spins (\`turbo;spin×20\`).
6. **Autoplay.** Use the \`autoplay\` step, then watch it run with \`watch×N\` (screenshots at intervals). Stop it with \`text:Stop\` if a stop button appears.
7. **The feature.** Use the \`feature\` step. It loads the game so that its next spin triggers the bonus feature. This is a test hook: in real play the feature comes much more rarely, perhaps once in 100–300 spins, so don't expect one in normal play. Spin once, then follow the whole feature with \`watch×N\` or more spins until it ends and the total is shown. You may run it twice if the first time was unclear.
8. Write down what you understood, answer the checks, and only then score.

Each play call starts a fresh session, so the balance may reset. Keep to about 12 play calls. Read the contact sheets for the spins, and open single screenshots only when you need detail.

## Checks (facts, not opinions)
Answer each from what you saw. If you are guessing, say so: a confident wrong answer is worse than "not sure". A separate judge compares your answers with the game's real rules. If you misread the game, your readability and feature-clarity scores are capped, and the misreading counts against the game, not against you.
- **top_pay:** which symbol pays the most, and roughly how much.
- **feature_trigger:** what starts the feature.
- **wild:** what the wild does, or "no wild seen".
- **biggest_win:** the biggest win you saw in normal play (not the forced feature), as an amount and as × your stake if you can tell.
- **feature_story:** what happened in the feature and what it paid in total.

## Scores
Score each from 1 to 5. Write your reasoning before each score, based only on what you saw.

${anchorsText()}`;

export const PLAY_TOOL = (alias: string) =>
  `npm run slots:review -- play ${alias} "<steps>"

Steps are separated by ";" and run in order on a fresh page each call (include every step from the start):
- spin: press ${LABELS.spin}, wait for the reels and the win count, and take a screenshot. spin×N does it N times (at most ${MAX_SPINS_PER_CALL} per call); spin×N@ms sets the wait after each press.
- turbo: switch Turbo on (or off again). Later spins in the same call wait less.
- autoplay: open the ${LABELS.autoplayTab} tab and press ${LABELS.autoplayStart}. Then watch×N takes N screenshots ${WATCH_WAIT / 1000} s apart while it runs (watch×N@ms changes the gap). Before starting, you can pick the number of spins with text:<number>. Stop it with text:Stop, and go back to single spins with text:Manual.
- feature: load the game so that its next spin triggers the bonus feature (a test hook; put it anywhere in the call). When a card with a button appears (for example Continue), press it with text:<its label>.
- paytable: open the paytable and take a screenshot. close: close it (Escape).
- shot:<name> (screenshot), text:<label> (click the first enabled button or toggle whose visible text contains <label>), mouse:<x>,<y> (click at screen coordinates, 1280×800), key:<Enter|Escape|letter>, wait:<ms>.
Don't press Space: it skips the presentation.
The command prints the screenshot paths, plus contact sheets (the spin and watch screenshots, 6 per image, in order). Open them with Read. A line "text <label> ✗" means that click found no enabled button, often because the game was still busy; wait longer and try again. A spin×20 call takes about 80 seconds; give the Bash call a timeout of 300000 ms.
Example: npm run slots:review -- play ${alias} "shot:start;spin×10;paytable;close;shot:after"`;

export function playerUser(alias: string): string {
  return `You are not told which game this is.

Tool: you play the slot with this command (Bash), and nothing else:
${PLAY_TOOL(alias)}

Rules: run only that command, and read only the screenshots and contact sheets it prints (with the Read tool). Do not open any other file: no source, docs, rules card or earlier reviews.`;
}

const s = (description: string) => ({ type: 'string', description });

export const playerSchema = () => ({
  type: 'object',
  additionalProperties: false,
  required: ['first_impression', 'session', 'checks', 'moments', 'keep_spinning', 'criteria', 'confusions'],
  properties: {
    first_impression: s('What you thought the game was from the first screen, before playing: the theme, which symbols looked valuable, which looked special.'),
    session: {
      type: 'object',
      additionalProperties: false,
      required: ['spins', 'turbo', 'autoplay', 'feature_seen', 'paytable_opened', 'balance'],
      properties: {
        spins: { type: 'integer', description: 'Spins played in total, counting autoplay and the feature runs.' },
        turbo: { type: 'boolean' },
        autoplay: { type: 'boolean' },
        feature_seen: { type: 'boolean', description: 'You saw the feature run (forced or natural).' },
        paytable_opened: { type: 'boolean' },
        balance: s('How the balance went over the session, e.g. "100 → 82, with one 14× win".'),
      },
    },
    checks: {
      type: 'object',
      additionalProperties: false,
      required: ['top_pay', 'feature_trigger', 'wild', 'biggest_win', 'feature_story'],
      properties: {
        top_pay: s('Which symbol pays the most, and roughly how much.'),
        feature_trigger: s('What starts the feature.'),
        wild: s('What the wild does, or "no wild seen".'),
        biggest_win: s('The biggest win you saw in normal play: the amount, and × stake if you can tell.'),
        feature_story: s('What happened in the feature and what it paid in total.'),
      },
    },
    moments: {
      type: 'object',
      additionalProperties: false,
      required: ['best', 'dullest'],
      properties: {
        best: s('The moment a real player would remember, or "none".'),
        dullest: s('Where it dragged, or "none".'),
      },
    },
    keep_spinning: {
      type: 'object',
      additionalProperties: false,
      required: ['answer', 'why'],
      properties: {
        answer: { type: 'string', enum: ['yes', 'maybe', 'no'], description: 'Would a real player keep spinning after this session?' },
        why: s('One or two sentences.'),
      },
    },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'reasoning', 'score'],
        properties: {
          key: { type: 'string', enum: PLAYER_ANCHORS.map((a) => a.key) },
          reasoning: { type: 'string' },
          score: { type: 'integer', enum: [1, 2, 3, 4, 5] },
        },
      },
    },
    confusions: { type: 'array', items: { type: 'string' }, description: 'Moments you were unsure what was happening or what to do.' },
  },
});

export interface PlayerReview {
  first_impression: string;
  session: { spins: number; turbo: boolean; autoplay: boolean; feature_seen: boolean; paytable_opened: boolean; balance: string };
  checks: { top_pay: string; feature_trigger: string; wild: string; biggest_win: string; feature_story: string };
  moments: { best: string; dullest: string };
  keep_spinning: { answer: 'yes' | 'maybe' | 'no'; why: string };
  criteria: { key: PlayerKey; reasoning: string; score: number }[];
  confusions: string[];
}
