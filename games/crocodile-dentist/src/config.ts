// Default settings for the mock-up. All of these can also be changed live from
// the ⚙ Customise drawer, which saves to the browser and can copy the result
// out as JSON to paste back in here.

export interface CrocColors {
  bg: string;
  panel: string;
  accent: string;
  croc: string;
  crocShade: string;
  belly: string;
  mouth: string;
  tongue: string;
  tooth: string;
  you: string;
  house: string;
  bite: string;
  win: string;
}

export interface CrocConfig {
  rtp: number;
  teethOptions: number[];
  defaultTeeth: number;
  badTeethOptions: number[];
  defaultBadTeeth: number;
  // Bite Bonus = what the House getting bitten pays, relative to the next
  // cash-out rung. 1 = pure ladder, 2 = (with 1 bad tooth) a pure 50/50 duel.
  biteBonusMin: number;
  biteBonusMax: number;
  defaultBiteBonus: number;
  houseDelay: number;
  turboHouseDelay: number;
  colors: CrocColors;
}

export const DEFAULT_CONFIG: CrocConfig = {
  rtp: 0.99,
  teethOptions: [8, 10, 12, 16, 20],
  defaultTeeth: 12,
  badTeethOptions: [1, 2, 3, 4, 5],
  defaultBadTeeth: 1,
  biteBonusMin: 1,
  biteBonusMax: 2,
  defaultBiteBonus: 1.5,
  houseDelay: 900,
  turboHouseDelay: 200,
  colors: {
    bg: '#07070b',
    panel: '#101016',
    accent: '#ffffff',
    croc: '#46c463',
    crocShade: '#2f9a4a',
    belly: '#c9e98a',
    mouth: '#6e1f3a',
    tongue: '#e45d84',
    tooth: '#fffbea',
    you: '#4d8dff',
    house: '#ffb020',
    bite: '#e9113c',
    win: '#00e701',
  },
};

const KEY = 'croc.config.v2';

export function loadConfig(): CrocConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CONFIG;
    const saved = JSON.parse(raw) as Partial<CrocConfig>;
    return { ...DEFAULT_CONFIG, ...saved, colors: { ...DEFAULT_CONFIG.colors, ...saved.colors } };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg: CrocConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}

// CSS custom properties for the game's root element (crocShade -> --croc-shade).
// Scoped to the game so they never leak into the platform page.
export function colorVars(colors: CrocColors): Record<string, string> {
  return Object.fromEntries(
    Object.entries(colors).map(([name, value]) => ['--' + name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), value]),
  );
}
