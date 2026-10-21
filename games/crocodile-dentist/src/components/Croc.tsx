import { useEffect, useMemo, useState } from 'react';
import type { Presser } from '../game';

interface Props {
  N: number;
  pressed: (Presser | null)[];
  revealed: number[]; // bad teeth to show (end of round)
  playable: boolean;
  onPress: (i: number) => void;
  houseTarget: number | null;
  fx: { id: number; kind: Presser | null };
  danger: number; // 0..1, closes the jaw a little as the odds worsen
  focused: boolean; // House is concentrating
  open: boolean; // a round is in play; the jaw stays shut otherwise
}

// Mouth geometry: teeth sit on the lower half of an ellipse.
const CX = 400;
const CY = 80;
const RX = 290;
const RY = 304;
const A0 = 14;
const A1 = 166;
const EYES = [
  { x: 250, y: -78 },
  { x: 550, y: -78 },
];
const SHUT_Y = 262;

function toothLayout(N: number) {
  const span = (Math.PI * (RX + RY)) / 2 * ((A1 - A0) / 180);
  const w = Math.min(58, (span / N) * 0.8);
  const h = Math.min(78, w * 1.35);
  return Array.from({ length: N }, (_, i) => {
    const a = ((A0 + ((A1 - A0) * (i + 0.5)) / N) * Math.PI) / 180;
    const x = CX + RX * Math.cos(a);
    const y = CY + RY * Math.sin(a);
    // Point each tooth at the centre of the mouth.
    const rot = (Math.atan2(CY + 40 - y, CX - x) * 180) / Math.PI + 90;
    return { x, y, rot, w, h };
  });
}

function toothPath(w: number, h: number) {
  const hw = w / 2;
  return `M${-hw},6 L${-hw},${-h * 0.5} Q${-hw},${-h} 0,${-h} Q${hw},${-h} ${hw},${-h * 0.5} L${hw},6 Z`;
}

// Upper-jaw bottom edge is the quadratic (30,90)-(400,140)-(770,90).
const upperEdgeY = (t: number) => 90 + 100 * t * (1 - t);

export default function Croc({ N, pressed, revealed, playable, onPress, houseTarget, fx, danger, focused, open }: Props) {
  const teeth = useMemo(() => toothLayout(N), [N]);
  const [hover, setHover] = useState<number | null>(null);
  const [chomp, setChomp] = useState<Presser | null>(null);
  const [shut, setShut] = useState(!open);

  useEffect(() => {
    if (open) {
      setShut(false);
      return;
    }
    // Let the bad-teeth reveal play before the jaw closes.
    const t = setTimeout(() => setShut(true), 1400);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!fx.kind) return;
    // A chomp always ends the round, so the jaw stays shut afterwards.
    setShut(true);
    setChomp(fx.kind);
    const t = setTimeout(() => setChomp(null), 820);
    return () => clearTimeout(t);
  }, [fx.id, fx.kind]);

  const look = houseTarget ?? hover;
  const pupil = (eye: { x: number; y: number }) => {
    if (look === null || !teeth[look]) return { x: 0, y: 8 };
    const dx = teeth[look].x - eye.x;
    const dy = teeth[look].y - eye.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: (dx / d) * 14, y: (dy / d) * 14 };
  };

  const openY = chomp || shut ? SHUT_Y : -26 + danger * 70;
  const upperTeeth = Array.from({ length: 11 }, (_, i) => 0.07 + (0.86 * i) / 10);
  // Lower teeth that poke up between the upper ones when the jaw is shut.
  const lowerTeeth = Array.from({ length: 8 }, (_, i) => 0.199 + 0.086 * i);
  const target = houseTarget !== null ? teeth[houseTarget] : null;

  return (
    <svg
      id="jaw"
      viewBox="0 -200 800 660"
      className={(playable ? 'playable' : '') + (chomp ? ' shake' : '')}
      aria-label="Crocodile mouth"
    >
      {/* Lower jaw, clipped so nothing shows above the upper jaw when it shuts.
          Its box starts at y=70; the upper jaw's edge sits at y=60+openY. */}
      <g className={'jawclip' + (chomp ? ' chomp' : '')} style={{ clipPath: `inset(${Math.max(0, openY - 10)}px -100px -100px -100px)` }}>
      <path d="M36,70 A364,384 0 0 0 764,70 Z" fill="var(--croc)" />
      <path className="belly" d="M150,330 Q400,470 650,330 Q620,440 400,452 Q180,440 150,330 Z" fill="var(--belly)" style={{ opacity: shut ? 0 : 0.55 }} />
      {[160, 230, 570, 640].map((x, i) => (
        <circle key={i} cx={x} cy={i % 3 ? 300 : 250} r="9" fill="var(--croc-shade)" />
      ))}
      <path d="M108,76 A292,306 0 0 0 692,76 Z" fill="var(--mouth)" />
      <ellipse cx="400" cy="282" rx="160" ry="74" fill="var(--tongue)" />
      <path d="M400,226 Q394,282 400,330" stroke="var(--mouth)" strokeWidth="6" fill="none" strokeLinecap="round" opacity="0.5" />

      {/* Teeth */}
      {teeth.map((t, i) => {
        const by = pressed[i];
        const bad = revealed.includes(i);
        const cls = ['tooth', by ? 'pressed' : 'fresh', by === 'you' && 'by-you', by === 'house' && 'by-house', bad && 'bad', bad && 'reveal']
          .filter(Boolean)
          .join(' ');
        return (
          <g
            key={i}
            className={cls}
            transform={`translate(${t.x.toFixed(1)},${t.y.toFixed(1)}) rotate(${t.rot.toFixed(1)})`}
            onClick={() => playable && !by && onPress(i)}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
          >
            <path className="shape" d={toothPath(t.w, t.h)} />
            <ellipse className="shine" cx={-t.w * 0.2} cy={-t.h * 0.62} rx={t.w * 0.09} ry={t.h * 0.14} />
            {bad ? (
              <path
                className="mark"
                d={`M${-t.w * 0.16},${-t.h * 0.34} L${t.w * 0.16},${-t.h * 0.02} M${t.w * 0.16},${-t.h * 0.34} L${-t.w * 0.16},${-t.h * 0.02}`}
                stroke="#fff"
                strokeWidth="4"
                strokeLinecap="round"
                style={{ opacity: 1 }}
              />
            ) : (
              <circle className="mark" cy={-t.h * 0.18} r={t.w * 0.15} fill={by === 'house' ? 'var(--house)' : 'var(--you)'} />
            )}
          </g>
        );
      })}
      </g>

      {/* House's pointer */}
      <g className={'finger' + (target ? ' show' : '')} transform={target ? `translate(${target.x},${target.y - 10})` : 'translate(400,200)'}>
        <circle r="24" fill="none" stroke="var(--house)" strokeWidth="5" />
        <circle r="7" fill="var(--house)" />
      </g>

      {/* Upper jaw */}
      <g className={'jawmove' + (chomp ? ' chomp' : '')} style={{ transform: `translateY(${openY}px)` }}>
        {upperTeeth.map((t, i) => {
          const x = 30 + 740 * t;
          const y = upperEdgeY(t);
          return <path key={i} d={`M${x - 15},${y - 6} L${x},${y + 24} L${x + 15},${y - 6} Z`} fill="var(--tooth)" />;
        })}
        {/* Broad, flat snout */}
        <path d="M30,90 C30,-24 110,-58 400,-60 C690,-58 770,-24 770,90 Q400,190 30,90 Z" fill="var(--croc)" />
        <path d="M30,90 Q400,190 770,90" stroke="var(--croc-shade)" strokeWidth="6" fill="none" strokeLinecap="round" />
        <path d="M120,-14 C230,-46 570,-46 680,-14" stroke="var(--belly)" strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.3" />
        {/* Scutes */}
        {[-1, 1].flatMap((s) =>
          [[130, 22], [168, 14], [206, 8], [150, 52], [188, 46], [226, 40], [280, 36], [318, 48]].map(([dx, y], i) => (
            <path key={`${s}${i}`} d={`M${400 + s * (400 - dx) - 15},${y + 6} Q${400 + s * (400 - dx)},${y - 12} ${400 + s * (400 - dx) + 15},${y + 6} Z`} fill="var(--croc-shade)" opacity="0.45" />
          )),
        )}
        {/* Sensory pits along the upper lip */}
        {Array.from({ length: 14 }, (_, i) => {
          const t = 0.08 + (0.84 * i) / 13;
          return <circle key={i} cx={30 + 740 * t} cy={upperEdgeY(t) - 22} r="3.5" fill="var(--croc-shade)" />;
        })}
        {/* Raised nostril bump at the snout tip */}
        <ellipse cx="400" cy="-14" rx="62" ry="28" fill="var(--belly)" opacity="0.18" />
        <ellipse cx="376" cy="-16" rx="9" ry="13" transform="rotate(-25 376 -16)" fill="#14201a" />
        <ellipse cx="424" cy="-16" rx="9" ry="13" transform="rotate(25 424 -16)" fill="#14201a" />
        {EYES.map((e, i) => {
          const p = pupil(e);
          return (
            <g key={i} className={focused ? 'angry' : ''}>
              <circle cx={e.x} cy={e.y} r="64" fill="var(--croc)" />
              <circle cx={e.x} cy={e.y} r="46" fill="#fff" />
              <g className="pupil" style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
                <circle cx={e.x} cy={e.y} r="20" fill="#14201a" />
                <circle cx={e.x - 7} cy={e.y - 7} r="6" fill="#fff" />
              </g>
              <circle className="lid" cx={e.x} cy={e.y} r="48" fill="var(--croc-shade)" />
              <path
                className="brow"
                d={i === 0 ? `M${e.x - 50},${e.y - 62} L${e.x + 40},${e.y - 38}` : `M${e.x + 50},${e.y - 62} L${e.x - 40},${e.y - 38}`}
                stroke="#14201a"
                strokeWidth="14"
                strokeLinecap="round"
              />
            </g>
          );
        })}
      </g>

      {/* Interlocking lower teeth, visible once the jaw is shut */}
      <g className="interlock" style={{ opacity: shut ? 1 : 0 }}>
        {lowerTeeth.map((t, i) => {
          const x = 30 + 740 * t;
          const y = upperEdgeY(t) + SHUT_Y;
          return <path key={i} d={`M${x - 12},${y + 8} L${x},${y - 20} L${x + 12},${y + 8} Z`} fill="var(--tooth)" />;
        })}
      </g>

      {chomp && (
        <text
          key={fx.id}
          className="burst show"
          x="400"
          y="260"
          textAnchor="middle"
          fontSize="104"
          fontWeight="800"
          fill={chomp === 'you' ? 'var(--bite)' : 'var(--win)'}
          stroke="#0b0f0d"
          strokeWidth="8"
          paintOrder="stroke"
        >
          CHOMP!
        </text>
      )}
    </svg>
  );
}
