// Shared slot types. The spin result is the engine pack's canonical spin JSON
// (`slotlab.protocol.canonical_spin_json`), so a TypeScript spin and a pack spin
// for the same spec and seed compare object for object (docs/SLOTS.md §2.4).
//
// Board and cell convention (the pack's): board[col][row]; a cell is [col, row].
// Coins are integers; `bet.coins` is the stake (4096 in the pack's examples), so
// a win in stakes is totalCoins / bet.coins.

/** A game_spec_v2 document (the pack's spec schema). Only the fields the runtime reads are typed. */
export interface SlotSpec {
  schema: 'game_spec_v2';
  slug: string;
  engine: 'reel_engine';
  bet: { coins: number };
  geometry: { cols: number; rows: number[] };
  symbols: SpecSymbol[];
  board_law: BoardLaw;
  evaluation: Evaluation;
  pays: Pays;
  mechanics: SpecMechanic[];
  trigger?: { scatter_min?: number; feature_budget_rtp?: number; [k: string]: unknown };
  targets?: { rtp_requested?: number; [k: string]: unknown };
  [k: string]: unknown;
}

export interface SpecSymbol {
  id: number;
  /** Short code, e.g. "P1", "L3", "WD", "SC". The game maps ids to art and names. */
  label: string;
  role: 'scatter' | 'wild' | 'premium' | 'low' | string;
  [k: string]: unknown;
}

export interface BoardLaw {
  kind: string; // 'reel_set_mixture' | ...
  reel_sets?: { id: string; label?: string; strips: number[][]; weight: number }[];
  [k: string]: unknown;
}

export interface Evaluation {
  kind: 'payline' | 'ways' | 'cluster' | 'scatter_pays' | string;
  paylines?: number[][];
  [k: string]: unknown;
}

export interface Pays {
  /** symbol id → count → coins */
  paytable: Record<string, Record<string, number>>;
  scatter_pay?: Record<string, number>;
  [k: string]: unknown;
}

export interface SpecMechanic {
  family: string;
  [k: string]: unknown;
}

/** One win inside a step. */
export interface SpinWin {
  cells: [number, number][];
  coins: number;
  /** e.g. "P2 x3", "L1 x4 (1 ways)", "P1 x8 (count)" */
  label: string;
  lineIdx: number | null;
  ways: number | null;
}

/** One board state in a spin: the first board, then one per tumble/respin. */
export interface SpinStep {
  board: number[][];
  stepCoins: number;
  wins: SpinWin[];
}

/** The pack's canonical spin result. */
export interface SpinResult {
  decor: Record<string, unknown>;
  extras: { coins: number; label: string }[];
  finalBoard: number[][];
  flags: string[];
  set: number;
  steps: SpinStep[];
  stops: number[];
  totalCoins: number;
  trigger: unknown;
}

/** A paid spin as the game presents it: the base spin plus any feature it triggered. */
export interface SlotRound {
  seed: number;
  base: SpinResult;
  feature: FeatureRound | null;
  /** Total win in coins, after the max-win cap. */
  totalCoins: number;
  capped: boolean;
}

export interface FeatureRound {
  kind: string; // e.g. 'free_spins'
  spins: { result: SpinResult; multiplier: number; coins: number; retrigger: number }[];
  totalCoins: number;
}

/** RTP with its honesty tier (docs/SLOTS.md §2.6). */
export interface RtpReport {
  rtp: number;
  tier: 'exact' | 'exact_mixture' | 'mc';
  se?: number;
  n?: number;
}
