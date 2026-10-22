// The shared game UI kit: layout, controls, readouts and hooks that give every
// kit-based game the same panel, the same round flow and the same reset path.
// See docs/BUILDING-GAMES.md for the conventions.

export * from './autobet';
export * from './components';
export * from './format';
export * from './hooks';
export { kitStyles } from './styles';
export { RoundOver, type RoundOverProps } from '../round-over';
