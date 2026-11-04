// Default settings for the mock-up. The maths can also be changed live from
// the Customise drawer, which saves to the browser and can copy the result
// out as JSON to paste back in here.

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

export function loadConfig(): CrocConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CONFIG;
    // Older saves also held colours and pacing; those are no longer settings.
    const saved = JSON.parse(raw) as Partial<CrocConfig>;
    return {
      rtp: saved.rtp ?? DEFAULT_CONFIG.rtp,
      teeth: saved.teeth ?? DEFAULT_CONFIG.teeth,
      badTeethOptions: saved.badTeethOptions ?? DEFAULT_CONFIG.badTeethOptions,
      defaultBadTeeth: saved.defaultBadTeeth ?? DEFAULT_CONFIG.defaultBadTeeth,
    };
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
