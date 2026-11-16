// Slot analytics (docs/SLOTS.md §2–3): the spec model, exact RTP, the spin distribution, the
// free-spins algebra, the engine Monte Carlo, the §3 player statistics, slot-facts.json and the
// tuner. Pure browser code (no Node APIs); scripts/slots/*.ts do the file IO.

export * from './config';
export * from './model';
export * from './exact';
export * from './distribution';
export * from './features';
export * from './mc';
export * from './stats';
export * from './facts';
export * from './rng';
export * from './tune';
