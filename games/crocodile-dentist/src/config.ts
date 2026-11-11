// Default settings for the mock-up. The maths (RTP, teeth, bad-teeth options)
// is fixed here and can't be changed from the Customise drawer: see withFixedMaths.

export interface CrocConfig {
  rtp: number;
  // The jaw size is fixed; the number of bad teeth is the one risk knob.
  teeth: number;
  badTeethOptions: number[];
  defaultBadTeeth: number;
}

export const DEFAULT_CONFIG: CrocConfig = {
  rtp: 0.99,
  teeth: 20,
  badTeethOptions: [1, 2, 4, 7, 12, 19],
  defaultBadTeeth: 4,
};

const KEY = 'croc.config.v3';

/**
 * The maths is not customisable: the RTP, the jaw size and the bad-teeth
 * options always come from DEFAULT_CONFIG, whatever is saved in the browser
 * or sent by the drawer. (An editable RTP let a player raise their own return
 * to 100%, and a custom jaw could pay more than manifest.maxMultiplier.)
 */
export function withFixedMaths(cfg: CrocConfig): CrocConfig {
  const { rtp, teeth, badTeethOptions, defaultBadTeeth } = DEFAULT_CONFIG;
  return { ...cfg, rtp, teeth, badTeethOptions, defaultBadTeeth };
}

export function loadConfig(): CrocConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CONFIG;
    // Older saves also held colours, pacing and editable maths; none of those are settings now.
    const saved = JSON.parse(raw) as Partial<CrocConfig>;
    return withFixedMaths({ ...DEFAULT_CONFIG, ...saved });
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
