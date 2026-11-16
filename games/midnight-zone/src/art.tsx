// Midnight Zone art: creatures of the deep, drawn as filled bright bodies on near-black tiles.
// Flat shapes only. Every colour is the theme's: three tones (abyss, trench, tile) and four lights.

import type { ReactElement } from 'react';
import type { SlotSymbols, SlotTheme } from '@originals/slots/ui';

export const ABYSS = {
  bg: '#03071e',
  frame: '#0a3d62',
  tile: '#071a33',
  cyan: '#00f5d4',
  violet: '#9b5de5',
  gold: '#fee440',
  coral: '#f15bb5',
  // the free spins go deeper: a flat swap of the three tones
  deepBg: '#010310',
  deepFrame: '#2a1163',
  deepTile: '#0b0724',
} as const;
const C = ABYSS;

const svg = (size: number, body: ReactElement) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    {body}
  </svg>
);

// The four premiums sit on a lit, framed panel so the pay order reads before the creature does.
const lit = <rect x="6" y="6" width="88" height="88" rx="12" fill={C.frame} stroke={C.gold} strokeWidth="4" />;

/** The locked deep rows of The Abyss: an unlit tile with a down chevron (the row opens on a tumble). */
export const DEEP = 13;

export const midnightTheme: SlotTheme = {
  name: 'Midnight Zone',
  palette: {
    bg: C.bg,
    frame: C.frame,
    tile: C.tile,
    colors: [C.cyan, C.violet, C.gold, C.coral],
    ink: C.gold,
    featureBg: C.deepBg,
    featureFrame: C.deepFrame,
    featureTile: C.deepTile,
  },
  window: { cell: 'tile', separators: 'gap', frameWidth: 8, radius: 6, cellRadius: 4 },
};

export const midnightSymbols: SlotSymbols = {
  // Scatter: anglerfish with its glowing lure
  1: {
    name: 'Anglerfish lure',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M12 70 C12 48 34 40 56 42 C82 44 92 58 90 72 C88 88 66 92 44 90 C24 88 12 82 12 70 Z" fill={C.violet} />
          <path d="M12 66 L42 74 L12 82 Z" fill={C.tile} />
          <path d="M16 67 L21 73 L25 68 L30 74 L34 70 L39 75" fill="none" stroke={C.cyan} strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx="62" cy="58" r="7" fill={C.gold} />
          <circle cx="63" cy="58" r="3" fill={C.bg} />
          <path d="M52 43 C50 22 36 14 24 24" fill="none" stroke={C.gold} strokeWidth="5" strokeLinecap="round" />
          <circle cx="22" cy="26" r="12" fill={C.gold} />
          <circle cx="22" cy="26" r="5.5" fill={C.cyan} />
        </>,
      ),
  },
  // P1: gulper eel, the top pay: a huge open jaw that fills the panel, and a whip tail
  3: {
    name: 'Gulper eel',
    render: (s) =>
      svg(
        s,
        <>
          {lit}
          <path d="M12 46 L58 16 Q80 14 84 34 L70 48 Z" fill={C.violet} />
          <path d="M12 46 L70 48 Q90 58 80 76 Q60 94 22 84 Q10 70 12 46 Z" fill={C.coral} />
          <path d="M22 52 L66 50 Q74 62 64 72 Q44 84 26 76 Q18 66 22 52 Z" fill={C.bg} />
          <circle cx="64" cy="31" r="7" fill={C.gold} />
          <path d="M82 60 C92 64 92 78 84 84" fill="none" stroke={C.violet} strokeWidth="6" strokeLinecap="round" />
        </>,
      ),
  },
  // P2: giant isopod, a wide armoured oval
  4: {
    name: 'Giant isopod',
    render: (s) =>
      svg(
        s,
        <>
          {lit}
          <g transform="translate(50 50) scale(0.8) translate(-50 -50)">
          <ellipse cx="52" cy="58" rx="42" ry="26" fill={C.gold} />
          <path d="M36 38 V78 M52 34 V82 M68 38 V78" fill="none" stroke={C.tile} strokeWidth="4.5" strokeLinecap="round" />
          <circle cx="19" cy="50" r="5" fill={C.coral} />
          <circle cx="19" cy="66" r="5" fill={C.coral} />
          <path d="M16 42 L8 26 M24 40 L24 22" fill="none" stroke={C.gold} strokeWidth="3.5" strokeLinecap="round" />
          <path d="M34 82 L30 92 M52 84 L52 93 M70 82 L74 92" fill="none" stroke={C.gold} strokeWidth="4" strokeLinecap="round" />
                  </g>
</>,
      ),
  },
  // P3: vampire squid, a dome with webbed arms and glowing eyes
  5: {
    name: 'Vampire squid',
    render: (s) =>
      svg(
        s,
        <>
          {lit}
          <g transform="translate(50 50) scale(0.8) translate(-50 -50)">
          <ellipse cx="14" cy="38" rx="8" ry="12" fill={C.violet} />
          <ellipse cx="86" cy="38" rx="8" ry="12" fill={C.violet} />
          <path d="M14 64 C14 30 34 12 50 12 C66 12 86 30 86 64 L86 70 L76 90 L66 72 L58 92 L50 72 L42 92 L34 72 L24 90 L14 70 Z" fill={C.violet} />
          <circle cx="37" cy="46" r="8.5" fill={C.cyan} />
          <circle cx="63" cy="46" r="8.5" fill={C.cyan} />
          <circle cx="37" cy="46" r="3.5" fill={C.bg} />
          <circle cx="63" cy="46" r="3.5" fill={C.bg} />
          <path d="M28 68 Q50 56 72 68" fill="none" stroke={C.coral} strokeWidth="5" strokeLinecap="round" />
                  </g>
</>,
      ),
  },
  // P4: siphonophore, a tall chain of glowing bulbs
  6: {
    name: 'Siphonophore',
    render: (s) =>
      svg(
        s,
        <>
          {lit}
          <g transform="translate(50 50) scale(0.8) translate(-50 -50)">
          <path d="M50 24 Q28 40 40 46 Q72 52 60 62 Q36 70 46 78 Q60 84 54 90" fill="none" stroke={C.violet} strokeWidth="4.5" strokeLinecap="round" />
          <circle cx="50" cy="16" r="11" fill={C.coral} />
          <circle cx="40" cy="44" r="9" fill={C.cyan} />
          <circle cx="60" cy="61" r="8.5" fill={C.cyan} />
          <circle cx="46" cy="77" r="7.5" fill={C.cyan} />
          <circle cx="55" cy="88" r="5.5" fill={C.cyan} />
                  </g>
</>,
      ),
  },
  // L1: copepod, a drop with long feelers
  7: {
    name: 'Copepod',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 36 C72 42 76 70 50 90 C24 70 28 42 50 36 Z" fill={C.coral} />
          <path d="M43 40 C30 26 22 22 10 24 M57 40 C70 26 78 22 90 24" fill="none" stroke={C.coral} strokeWidth="4" strokeLinecap="round" />
          <circle cx="50" cy="58" r="5" fill={C.tile} />
        </>,
      ),
  },
  // L2: krill, a gold arch with a tail fan
  8: {
    name: 'Glowing krill',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M18 74 C16 40 50 24 84 44" fill="none" stroke={C.gold} strokeWidth="16" strokeLinecap="round" />
          <path d="M80 38 L94 28 L92 56 Z" fill={C.gold} />
          <circle cx="21" cy="72" r="4.5" fill={C.tile} />
          <circle cx="25" cy="49" r="3.5" fill={C.coral} />
          <circle cx="45" cy="36" r="3.5" fill={C.coral} />
        </>,
      ),
  },
  // L3: sea gooseberry, a round comb jelly with two long trailing tentacles (not an oval: the isopod is the oval)
  9: {
    name: 'Sea gooseberry',
    render: (s) =>
      svg(
        s,
        <>
          <circle cx="40" cy="38" r="26" fill={C.violet} />
          <circle cx="32" cy="30" r="5" fill={C.tile} />
          <circle cx="48" cy="44" r="5" fill={C.tile} />
          <path d="M54 58 C70 62 64 78 80 80 C88 82 90 88 88 92" fill="none" stroke={C.violet} strokeWidth="4" strokeLinecap="round" />
          <path d="M30 62 C30 76 44 78 44 90" fill="none" stroke={C.violet} strokeWidth="4" strokeLinecap="round" />
        </>,
      ),
  },
  // L4: bristle worm, a wavy body with bristles
  10: {
    name: 'Bristle worm',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M10 62 C24 30 38 30 50 50 C62 70 76 70 90 38" fill="none" stroke={C.cyan} strokeWidth="12" strokeLinecap="round" />
          <path d="M26 38 L20 26 M40 38 L40 26 M58 60 L60 74 M72 64 L80 76" fill="none" stroke={C.coral} strokeWidth="4" strokeLinecap="round" />
          <circle cx="90" cy="38" r="4" fill={C.tile} />
        </>,
      ),
  },
  // L5: lantern shrimp, a curled body with a glowing cheek
  11: {
    name: 'Lantern shrimp',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M70 30 C40 20 20 44 34 66 C46 82 72 76 74 58" fill="none" stroke={C.violet} strokeWidth="14" strokeLinecap="round" />
          <path d="M66 62 L92 58 L84 80 Z" fill={C.violet} />
          <circle cx="72" cy="28" r="6" fill={C.gold} />
          <circle cx="34" cy="64" r="5" fill={C.gold} />
        </>,
      ),
  },
  // Orb: jellyfish. The value badge sits bottom right, so the bell is high and the tails fall to the left.
  12: {
    name: 'Jellyfish',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M14 54 C12 14 88 14 86 54 Q76 60 66 54 Q50 62 34 54 Q24 60 14 54 Z" fill={C.violet} />
          <circle cx="50" cy="34" r="12" fill={C.cyan} />
          <path d="M26 58 C22 70 30 76 24 90 M44 60 C40 72 50 78 44 92 M62 60 C58 72 66 76 62 86" fill="none" stroke={C.coral} strokeWidth="4" strokeLinecap="round" />
        </>,
      ),
  },
  // The locked deep row (The Abyss only): unlit water with a down chevron. It never pays.
  [DEEP]: {
    name: 'Locked deep row',
    render: (s) =>
      svg(
        s,
        <>
          <rect x="6" y="6" width="88" height="88" rx="8" fill={C.deepBg} />
          <path d="M34 44 L50 60 L66 44" fill="none" stroke={C.deepFrame} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        </>,
      ),
  },
};
