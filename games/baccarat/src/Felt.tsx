// The betting felt: four side-bet spots above the three main spots
// (Player · Tie · Banker). Click to add a chip, right-click or Shift-click to
// take one off. After a deal, spots light up won / push / lost.

import { formatAmount } from '@originals/game-sdk';
import { fmtChance } from '@originals/game-sdk/ui';
import type { MouseEvent } from 'react';
import { ChipStack } from './Cards';
import { BET_NAME, betWinChance, paysLabel, type BetId, type Layout, type Variant } from './math';

export type SpotState = 'won' | 'push' | 'lost';

const SIDES: BetId[] = ['playerPair', 'eitherPair', 'perfectPair', 'bankerPair'];
const MAINS: BetId[] = ['player', 'tie', 'banker'];
const KEYS: Partial<Record<BetId, string>> = { player: 'P', tie: 'T', banker: 'B' };

function Spot({
  id,
  variant,
  amount,
  state,
  gain,
  disabled,
  main,
  onAdd,
  onRemove,
}: {
  id: BetId;
  variant: Variant;
  amount: number;
  state: SpotState | null;
  gain: number;
  disabled: boolean;
  main: boolean;
  onAdd(id: BetId): void;
  onRemove(id: BetId): void;
}) {
  const remove = (e: MouseEvent) => {
    e.preventDefault();
    if (!disabled) onRemove(id);
  };
  const key = KEYS[id];
  return (
    <button
      type="button"
      className={`bc-spot ${id}` + (main ? ' main' : ' side') + (state ? ` ${state}` : '') + (amount > 0 ? ' has' : '')}
      disabled={disabled}
      onClick={(e) => (e.shiftKey ? remove(e) : onAdd(id))}
      onContextMenu={remove}
      title={`${BET_NAME[id]} · pays ${paysLabel(id, variant)}${key ? ` (key ${key})` : ''}. Right-click or Shift-click to remove a chip.`}
      aria-label={`${BET_NAME[id]}, pays ${paysLabel(id, variant)}${amount > 0 ? `, ${formatAmount(amount, 2)} on it` : ''}`}
    >
      <span className="bc-spot-name">
        {BET_NAME[id]}
        {key && <kbd>{key}</kbd>}
      </span>
      <span className="bc-spot-pays">{id === 'perfectPair' ? '25:1 / 200:1' : paysLabel(id, variant)}</span>
      <span className="bc-spot-chance">{fmtChance(betWinChance(id, variant))}</span>
      {amount > 0 && (
        <span className="bc-spot-chips" key={amount}>
          <ChipStack amount={amount} />
          <b>{formatAmount(amount, 2)}</b>
        </span>
      )}
      {state === 'won' && gain > 0 && <span className="bc-spot-gain">+{formatAmount(gain, 2)}</span>}
      {state === 'push' && amount > 0 && <span className="bc-spot-gain push">Push</span>}
    </button>
  );
}

export function Felt({
  layout,
  variant,
  states,
  gains,
  disabled,
  onAdd,
  onRemove,
}: {
  layout: Layout;
  variant: Variant;
  /** Per-bet result of the last deal (null when no result is on the board). */
  states: Partial<Record<BetId, SpotState>> | null;
  gains: Partial<Record<BetId, number>>;
  disabled: boolean;
  onAdd(id: BetId): void;
  onRemove(id: BetId): void;
}) {
  const spot = (id: BetId, main: boolean) => (
    <Spot
      key={id}
      id={id}
      variant={variant}
      amount={layout[id] ?? 0}
      state={states?.[id] ?? null}
      gain={gains[id] ?? 0}
      disabled={disabled}
      main={main}
      onAdd={onAdd}
      onRemove={onRemove}
    />
  );
  return (
    <div className={'bc-felt' + (disabled ? ' locked' : '')} role="group" aria-label="Betting table">
      <div className="bc-felt-sides">{SIDES.map((id) => spot(id, false))}</div>
      <div className="bc-felt-mains">{MAINS.map((id) => spot(id, true))}</div>
    </div>
  );
}
