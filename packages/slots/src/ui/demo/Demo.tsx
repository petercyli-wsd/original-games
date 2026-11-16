// DEMO ONLY. Mounts SlotGame on the stub engine. Pick the game with `?demo=reef|ember|ember8|mega`, or with
// the VITE_SLOT_DEMO environment variable (scripts/play.mjs can't pass a query).
import { SlotGame } from '../SlotGame';
import { pickDemo } from './demos';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
const name = (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('demo') : null) ?? env?.VITE_SLOT_DEMO;
const game = pickDemo(name);

export default function Demo() {
  return <SlotGame {...game} />;
}
