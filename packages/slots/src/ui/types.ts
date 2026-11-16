// Public types of the slot UI kit (docs/SLOT-STYLE.md).
//
// A game hands `SlotGame` six things: its manifest, the engine spec, the theme,
// the symbol art, the presentation config and the measured facts. Everything the
// player sees about the maths (pays, RTP, hit rate) is generated from the spec
// and the facts, so the screen can never disagree with the game.

import type { ReactElement } from 'react';
import type { SlotConfig as GameConfig } from '../engine';
import type { SlotRound, SlotSpec } from '../engine/types';

/** One symbol's art: a screen-reader name and a flat-vector SVG drawn in a 0 0 100 100 viewBox. */
export interface SlotSymbolArt {
  /** Spoken and shown name, e.g. "Crab". Every symbol has one (aria label, paytable, win chip). */
  name: string;
  /**
   * Returns an `<svg width={size} height={size} viewBox="0 0 100 100">`. Flat shapes in the
   * theme's own colours: no gradients, filters, emoji or text (docs/SLOT-STYLE.md §3).
   */
  render: (size: number) => ReactElement;
}

/** Symbol id (the spec's `symbols[].id`) → art. */
export type SlotSymbols = Record<number, SlotSymbolArt>;

/** How the reel window itself is drawn. The panel and buttons are never themed. */
export interface SlotWindowStyle {
  /** `tile`: every cell is a tile in `palette.tile`. `plain`: symbols sit straight on `palette.bg`. */
  cell: 'tile' | 'plain';
  /** Between reels: a gap of the frame tone, a 1px line, or nothing. */
  separators: 'gap' | 'line' | 'none';
  /** Frame thickness in px (4–14). */
  frameWidth: number;
  /** Corner radius of the frame in px (0–12). */
  radius: number;
  /** Corner radius of the tiles in px (0–10). */
  cellRadius: number;
}

/** A game's palette: a background tone, a frame tone and 2–4 theme colours. Hex strings only, no gradients. */
export interface SlotPalette {
  /** Behind the reels. */
  bg: string;
  /** The frame around the window (and the gaps between reels). */
  frame: string;
  /** Cell tile tone for `cell: 'tile'`. Defaults to `frame`. */
  tile?: string;
  /** 2–4 theme colours. [0] is the win highlight (it must show on `bg` and on `tile`); the rest are for art and badges. */
  colors: string[];
  /** Text colour on `bg` / `frame` (decor badges). Defaults to the site's `--text`. */
  ink?: string;
  /** During a feature the window can switch to these (flat swap, no fade). */
  featureBg?: string;
  featureFrame?: string;
  featureTile?: string;
}

export interface SlotTheme {
  name: string;
  palette: SlotPalette;
  window: SlotWindowStyle;
}

/**
 * Words the UI cannot get from the maths: names and one-line texts. Everything numeric (the feature's awards,
 * retriggers, multiplier and caps, the pays, the RTP) is read from the game's `config`, `spec` and `facts`.
 */
export interface SlotCopy {
  /** The feature's name on its cards and in the paytable, e.g. "Tide spins". Default "Free spins". */
  featureName?: string;
  /** A line under the intro's spin count, e.g. "Every win pays double". Default: generated from the multiplier law. */
  introNote?: string;
  /** The one sentence under the board. Default: generated from the evaluation kind. */
  rule?: string;
  /** Paytable text for the wild and the scatter. Defaults are minimal and role-only. */
  wildText?: string;
  scatterText?: string;
  /** How to label decor values on cells, by decor key (default: `×v` for keys with "orb", "mult" or "badge", else the number). */
  decorLabels?: Record<string, (v: number) => string>;
}

/** Measured facts from analytics (`games/<id>/src/slot-facts.json`), shown in the paytable. */
export interface SlotFacts {
  /** 0.96 */
  rtp: number;
  /** How the RTP was computed (docs/SLOTS.md §2.6). */
  rtpTier: 'exact' | 'exact_mixture' | 'mc';
  rtpSe?: number;
  rtpN?: number;
  /** P(a spin pays anything), 0–1. */
  hitRate: number;
  /** The measured or declared top win in stakes. */
  maxWinStakes: number;
  /** "1 in N spins" triggers the feature; undefined when there is none. */
  featureOneIn?: number;
  /** A word: low / medium / high / extreme. */
  volatility?: string;
}

/** What `SlotGame` needs from the engine (`createSlot(...)` returns this shape). */
export interface SlotEngine {
  /**
   * Plays one paid round: the base spin plus any feature it triggers. `rng32` returns uniform
   * uint32 values from the host RNG, and is only called after the bet is placed.
   */
  playRound(seed: number, rng32: () => number): SlotRound;
}

/** The game's `slot.config.json`: the feature law, the max win, the volatility band, the target RTP. */
export type SlotGameConfig = GameConfig;

export interface SlotGameProps {
  /** The lobby manifest: `name`, `accent`, `id`. */
  manifest: { id: string; name: string; accent: string };
  /** `games/<id>/src/slot.spec.json`. */
  spec: SlotSpec;
  /** The feature's spin specs, keyed by file name (as `createSlot` takes them). */
  featureSpecs?: Record<string, SlotSpec>;
  /** `slot.config.json`: what the engine runs, and what the intro, outro and paytable describe. */
  config: SlotGameConfig;
  /** `slot-facts.json`, read with `parseSlotFacts`. */
  facts: SlotFacts;
  theme: SlotTheme;
  symbols: SlotSymbols;
  /** Names and one-line texts (optional). */
  copy?: SlotCopy;
  /** Test and demo only: use this engine instead of `createSlot(...)`. */
  engine?: SlotEngine;
}
