// Where the slot review reads and writes. SLOT_REVIEW_GAMES_DIR and
// SLOT_REVIEW_WORK override the games folder and the working folder, so a dry
// run can use a fixture without touching games/ or .evaluator/.

import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..', '..', '..');
export const GAMES_DIR = process.env.SLOT_REVIEW_GAMES_DIR ? resolve(process.env.SLOT_REVIEW_GAMES_DIR) : join(ROOT, 'games');
/** Working files (git-ignored): .evaluator/slots/<id>/ and the blind players' .evaluator/slots/_blind/<alias>/. */
export const WORK = process.env.SLOT_REVIEW_WORK ? resolve(process.env.SLOT_REVIEW_WORK) : join(ROOT, '.evaluator', 'slots');
export const BLIND = join(WORK, '_blind');
export const CATALOGUE_MD = join(ROOT, 'docs', 'SLOT-CATALOGUE.md');
export const PLAY_MJS = join(ROOT, 'scripts', 'play.mjs');
