import { useMemo } from 'react';
import type { Presser } from '../game';

export type { Presser };

interface Props {
  N: number;
  pressed: (Presser | null)[];
  revealed: number[]; // bad teeth to show (end of round)
  playable: boolean;
  onPress: (i: number) => void;
  houseTarget: number | null;
}

// The teeth are plain cells along an arc. Pressed teeth are marked neutral
// (a filled dot for yours, a ring for the House's); a bad tooth is --lose.
const CX = 400;
const R = 340;
const A0 = 22;
const A1 = 158;

function layout(N: number) {
  const span = R * (((A1 - A0) * Math.PI) / 180);
  const w = Math.min(44, (span / N) * 0.78);
  const h = Math.min(62, w * 1.4);
  return Array.from({ length: N }, (_, i) => {
    const a = A0 + ((A1 - A0) * (i + 0.5)) / N;
    const rad = (a * Math.PI) / 180;
    return { x: CX + R * Math.cos(rad), y: R * Math.sin(rad), rot: a - 90, w, h };
  });
}

export default function Croc({ N, pressed, revealed, playable, onPress, houseTarget }: Props) {
  const teeth = useMemo(() => layout(N), [N]);

  return (
    <svg id="jaw" viewBox="30 90 740 280" className={playable ? 'playable' : ''} aria-label="Teeth">
      {teeth.map((t, i) => {
        const by = pressed[i];
        const bad = revealed.includes(i);
        const cls = ['tooth', by ? 'pressed' : 'fresh', bad && 'bad', houseTarget === i && 'aim'].filter(Boolean).join(' ');
        const r = t.w * 0.2;
        return (
          <g
            key={i}
            className={cls}
            transform={`translate(${t.x.toFixed(1)},${t.y.toFixed(1)}) rotate(${t.rot.toFixed(1)})`}
            onClick={() => playable && !by && onPress(i)}
          >
            <rect className="cell" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} rx="6" />
            {by === 'you' && <circle className="mark you" r={r} />}
            {by === 'house' && <circle className="mark house" r={r} />}
          </g>
        );
      })}
    </svg>
  );
}
