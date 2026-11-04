// Default settings for the mock-up. The pace and colours can also be changed
// live from the ⚙ Customise drawer, which saves to the browser and can copy the
// result out as JSON to paste back in here. The maths (RTP, teeth, bad-teeth
// options) is fixed here: see withFixedMaths.

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
  // The jaw size is fixed; the number of bad teeth is the one risk knob.
  teeth: number;
  badTeethOptions: number[];
  defaultBadTeeth: number;
  houseDelay: number;
  turboHouseDelay: number;
  colors: CrocColors;
}

export const DEFAULT_CONFIG: CrocConfig = {
  rtp: 0.99,
  teeth: 20,
  badTeethOptions: [1, 2, 4, 7, 12, 19],
  defaultBadTeeth: 4,
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

const KEY = 'croc.config.v3';

/**
 * The maths is not customisable: the RTP, the jaw size and the bad-teeth
 * options always come from DEFAULT_CONFIG, whatever is saved in the browser
 * or sent by the drawer. (An editable RTP let a player raise their own return
 * to 100%, and a custom jaw could pay more than manifest.maxMultiplier.) Only
 * the pace and the colours are the player's to change.
 */
export function withFixedMaths(cfg: CrocConfig): CrocConfig {
  const { rtp, teeth, badTeethOptions, defaultBadTeeth } = DEFAULT_CONFIG;
  return { ...cfg, rtp, teeth, badTeethOptions, defaultBadTeeth };
}

export function loadConfig(): CrocConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CONFIG;
    const saved = JSON.parse(raw) as Partial<CrocConfig>;
    return withFixedMaths({ ...DEFAULT_CONFIG, ...saved, colors: { ...DEFAULT_CONFIG.colors, ...saved.colors } });
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
