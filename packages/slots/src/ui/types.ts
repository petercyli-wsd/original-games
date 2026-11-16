// Public types of the slot UI kit (docs/SLOT-STYLE.md).
//
// A game hands `SlotGame` six things: its manifest, the engine spec, the theme,
// the symbol art, the presentation config and the measured facts. Everything the
// player sees about the maths (pays, RTP, hit rate) is generated from the spec
// and the facts, so the screen can never disagree with the game.

import type { ReactElement, ReactNode } from 'react';
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
  /**
   * Px of margin (0–48) between the frame and the reel grid, filled with the theme's backdrop, so a scene frames the
   * reels without sitting under the symbols. Only with `theme.backdrop`. Default 0.
   */
  backdropMargin?: number;
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
  /** During a modifier chain (respins): defaults to a light tint of bg / frame / tile, not the feature palette. */
  chainBg?: string;
  chainFrame?: string;
  chainTile?: string;
}

export interface SlotTheme {
  name: string;
  palette: SlotPalette;
  window: SlotWindowStyle;
  /**
   * Optional flat-vector scene drawn behind the symbols, inside the reel window (a skyline over water, a seabed).
   * Returns SVG children for a `w × h` px canvas (the window's size, so draw relative to it); the kit wraps them in
   * an `<svg>`. Flat shapes in palette colours only, no gradients, glows or filters, and keep it quiet: symbols must
   * stay readable. It shows through the gaps between tiles, and fully with `window.cell: 'plain'`.
   */
  backdrop?: (w: number, h: number) => ReactNode;
  /** The same scene during a feature (a flat swap). Defaults to `backdrop`. */
  featureBackdrop?: (w: number, h: number) => ReactNode;
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
  /**
   * The engine's extras labels ("HOLD & SPIN: 9 coins", "ORB SUM x35") are raw engine text and are never shown as is.
   * Map them here: a function, or a record keyed by the label or by its start ("HOLD & SPIN"). Default: "Scatter pay",
   * "Bonus ×35" or "Bonus total". A label that is already in the game's own words (not engine capitals) is left alone.
   */
  extrasLabels?: Record<string, string> | ((raw: string) => string);
  /** Name of a modifier-driven feature (hold and spin, sticky respins): its intro card, counter, outro and paytable section. Default "Bonus". */
  modifierName?: string;
  /** Intro note and paytable rules for it (each under 9 words). Defaults are generated from the mechanic. */
  modifierIntro?: string;
  modifierRules?: string[];
  /** Which feature `?feature=1` finds for a game that has both: free spins (default when the config has one) or the respin chain. */
  mainFeature?: 'free' | 'respin';
  /** Name of the pending win while a chain runs ("Winding"). Default "Pending win". */
  pendingLabel?: string;
  /** The respin counter's word, default "Respin". */
  respinLabel?: string;
  /**
   * A multiplier reel (`global_iid`: the marquee) shown spinning with the reels. `values` default to the spec's
   * `global_iid` value_pmf keys; `decorKey` defaults to "global_iid.mult".
   */
  multiplierReel?: { label?: string; values?: number[] | { base?: number[]; feature?: number[] }; decorKey?: string };
}

/** What a cell overlay hook gets to draw on top of a symbol (for example a ticket in a cook's hand). */
export interface CellOverlayInfo {
  col: number;
  row: number;
  symbol: number;
  /** The spin's decor, once its final board is shown (else undefined). */
  decor?: Record<string, unknown>;
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
  /** Draws extra content over a symbol's tile: return null for none. It sits above the symbol and below the win frame. */
  renderOverlay?: (cell: CellOverlayInfo) => ReactNode;
  /** Test and demo only: use this engine instead of `createSlot(...)`. */
  engine?: SlotEngine;
}
