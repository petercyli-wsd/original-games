import { useEffect, useState } from 'react';
import { isOpen, type Mask, type NextTotal } from './math';

const W = 480;
const PAD = 12;
export const BOARD_H = 240;

// Pip positions on a 3×3 grid (0..2) for each face.
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

/** A flat light square with dark pips. */
function Die({ x, y, size, face }: { x: number; y: number; size: number; face: number | null }) {
  const step = size / 4;
  return (
    <g className="die">
      <rect x={x} y={y} width={size} height={size} rx={6} className="die-body" />
      {face === null ? (
        <text x={x + size / 2} y={y + size / 2 + 8} className="die-blank">
          ?
        </text>
      ) : (
        PIPS[face].map(([cx, cy], i) => <circle key={i} cx={x + step * (cx + 1)} cy={y + step * (cy + 1)} r={size / 11} className="pip" />)
      )}
    </g>
  );
}

export interface BoardProps {
  n: number;
  /** Open tiles. */
  mask: Mask;
  /** Tiles the hovered or best option would close (preview). */
  preview: Mask;
  /** Tiles closed by the last roll (flash). */
  justClosed: Mask;
  /** Dice on the tray (null = not rolled yet). */
  dice: number[] | null;
  /** How many dice the tray holds now. */
  diceCount: number;
  tumbling: boolean;
  /** The rolled total, once landed. */
  total: number | null;
  /** The totals strip for the roll being shown: which totals the open tiles can make. */
  strip: NextTotal[];
  busted: boolean;
  won: boolean;
}

export default function Board({ n, mask, preview, justClosed, dice, diceCount, tumbling, total, strip, busted, won }: BoardProps) {
  // Cosmetic tumbling faces while the dice are in the air (the result is already decided).
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!tumbling) return;
    const id = window.setInterval(() => setFrame((f) => f + 1), 70);
    return () => window.clearInterval(id);
  }, [tumbling]);

  // ---- Tiles ----
  const gap = 5;
  const tileW = Math.min(52, (W - 2 * PAD - gap * (n - 1)) / n);
  const rowW = n * tileW + (n - 1) * gap;
  const x0 = (W - rowW) / 2;
  const tileY = 6;
  const tileH = 56;

  // ---- Dice ----
  const diceY = 86;
  const dieSize = 56;
  const faces: (number | null)[] = Array.from({ length: diceCount }, (_, i) =>
    tumbling ? ((frame * (i === 0 ? 5 : 1) + i * 3 + frame * i) % 6) + 1 : dice ? dice[i] ?? null : null,
  );
  const one = diceCount === 1;
  const landed = total !== null && !tumbling;
  const diceX = PAD + 8;

  // ---- Totals band: one cell per dice total, as wide as its chance; green = the open tiles can make it ----
  const sx = PAD;
  const sw = W - 2 * PAD;
  const headY = 178;
  const bandY = 188;
  const bandH = 34;
  const share = strip.reduce((a, s) => a + (s.playable ? s.p : 0), 0);
  const greenShare = share > 1 - 1e-9 ? 1 : share;
  let acc = 0;
  const cells = strip.map((s) => {
    const x = sx + acc * sw;
    acc += s.p;
    const hit = landed && total === s.total;
    const cls = 'cell' + (s.playable ? ' ok' : ' dead') + (hit ? ' hit' : '') + (landed && !hit ? ' dim' : '');
    return { ...s, x, w: s.p * sw, hit, cls };
  });

  return (
    <svg viewBox={`0 0 ${W} ${BOARD_H}`} className="shut" role="img" aria-label={`${n} tiles, ${Math.round(greenShare * 100)}% of next rolls playable`}>
      {/* Tiles 1..n */}
      {Array.from({ length: n }, (_, i) => {
        const tile = i + 1;
        const open = isOpen(mask, tile);
        const bit = 1 << i;
        const cls = ['tile', open ? 'open' : 'closed', preview & bit && open ? 'pick' : '', justClosed & bit ? 'just' : ''].join(' ');
        const x = x0 + i * (tileW + gap);
        return (
          <g key={tile} className={cls}>
            <rect x={x} y={tileY} width={tileW} height={tileH} rx={6} />
            <text x={x + tileW / 2} y={tileY + tileH / 2 + 8} style={{ fontSize: Math.min(24, tileW * 0.62) }}>
              {tile}
            </text>
          </g>
        );
      })}

      {/* The dice (one when the open tiles total 6 or less) and what they made */}
      {faces.map((f, i) => (
        <Die key={i} x={diceX + i * (dieSize + 12)} y={diceY} size={dieSize} face={f} />
      ))}
      <text x={diceX + diceCount * (dieSize + 12) + 6} y={diceY + dieSize / 2 + 15} className={'roll-total' + (busted ? ' bust' : '')}>
        {landed ? `= ${total}` : ''}
      </text>
      <text x={W - PAD - 8} y={diceY + dieSize / 2 + 6} className="dice-rule">
        {won ? 'Box shut' : one ? 'One die' : 'Two dice'}
      </text>

      {/* Totals band: width = chance of rolling it, green = playable with the open tiles, red = round lost */}
      <text x={sx} y={headY} className="strip-head">
        {landed ? 'This roll' : 'Next roll'}
      </text>
      {cells.map((c) => (
        <g key={c.total} className={c.cls}>
          <title>{c.playable ? `Roll ${c.total}: open tiles can make it` : `Roll ${c.total}: no open tiles add up to it, round lost`}</title>
          <rect x={c.x + 1} y={bandY} width={Math.max(1, c.w - 2)} height={bandH} rx={3} className="band" />
          <text x={c.x + c.w / 2} y={bandY + bandH / 2 + 5} className={'tot' + (c.w < 20 ? ' tight' : '')}>
            {c.total}
          </text>
        </g>
      ))}
      {cells
        .filter((c) => c.hit)
        .map((c) => (
          <rect key="hit" x={c.x - 1.5} y={bandY - 4} width={c.w + 3} height={bandH + 8} rx={5} className={'hit-frame' + (c.playable ? '' : ' bust')} />
        ))}
    </svg>
  );
}
