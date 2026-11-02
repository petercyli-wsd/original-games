import { fmtChance } from '@originals/game-sdk/ui';
import { useEffect, useState } from 'react';
import { isOpen, type Mask, type NextTotal } from './math';

const W = 480;
const PAD = 12;
export const BOARD_H = 300;

// Pip positions on a 3×3 grid (0..2) for each face.
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function Die({ x, y, size, face, tumbling }: { x: number; y: number; size: number; face: number | null; tumbling: boolean }) {
  const step = size / 4;
  return (
    <g className={'die' + (tumbling ? ' tumbling' : '')} style={{ transformOrigin: `${x + size / 2}px ${y + size / 2}px` }}>
      <rect x={x} y={y} width={size} height={size} rx={10} className="die-body" />
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
  openSum: number;
  busted: boolean;
  won: boolean;
}

export default function Board({ n, mask, preview, justClosed, dice, diceCount, tumbling, total, strip, openSum, busted, won }: BoardProps) {
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
  const tileY = 10;
  const tileH = 62;

  // ---- Dice tray ----
  const trayY = 92;
  const trayH = 84;
  const dieSize = 52;
  const faces: (number | null)[] = Array.from({ length: diceCount }, (_, i) =>
    tumbling ? ((frame * (i === 0 ? 5 : 1) + i * 3 + frame * i) % 6) + 1 : dice ? dice[i] ?? null : null,
  );
  const one = diceCount === 1;
  const landed = total !== null && !tumbling;

  // ---- Totals band: one cell per dice total, as wide as its chance; green = the open tiles can make it ----
  const sx = PAD;
  const sw = W - 2 * PAD;
  const headY = 206;
  const bandY = 216;
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
            <rect x={x} y={tileY} width={tileW} height={tileH} rx={7} />
            <text x={x + tileW / 2} y={tileY + tileH / 2 + 8} style={{ fontSize: Math.min(24, tileW * 0.62) }}>
              {tile}
            </text>
          </g>
        );
      })}

      {/* Dice tray, with the dice rule that applies right now */}
      <rect x={PAD} y={trayY} width={W - 2 * PAD} height={trayH} rx={12} className={'tray' + (one ? ' one' : '')} />
      {faces.map((f, i) => (
        <Die key={i} x={PAD + 16 + i * (dieSize + 12)} y={trayY + (trayH - dieSize) / 2} size={dieSize} face={f} tumbling={tumbling} />
      ))}
      <text x={PAD + 16 + diceCount * (dieSize + 12) + 6} y={trayY + trayH / 2 + 12} className={'roll-total' + (busted ? ' bust' : '')}>
        {landed ? `= ${total}` : ''}
      </text>
      <text x={W - PAD - 14} y={trayY + 34} className={'dice-rule' + (one ? ' one' : '')}>
        {won ? 'Box shut' : one ? 'One die' : 'Two dice'}
      </text>
      <text x={W - PAD - 14} y={trayY + 56} className="dice-sub">
        {won ? 'every tile closed' : one ? `open tiles total ${openSum} (6 or less)` : `open tiles total ${openSum}`}
      </text>

      {/* Totals band: width = chance of rolling it, green = playable with the open tiles, red = round lost */}
      <text x={sx} y={headY} className="strip-head">
        {landed ? 'THIS ROLL' : 'NEXT ROLL'}
        <tspan className="strip-sub"> · green totals can be played</tspan>
      </text>
      <text x={sx + sw} y={headY} className="strip-legend">
        <tspan className="g">{fmtChance(greenShare)}</tspan> playable
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
      <text x={sx} y={bandY + bandH + 24} className="strip-key">
        Width = chance of rolling it
      </text>
      <text x={sx + sw} y={bandY + bandH + 24} className="strip-key end">
        <tspan className="r">red</tspan> = no tiles add up: lost
      </text>
    </svg>
  );
}
