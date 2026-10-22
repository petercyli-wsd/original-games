import type { CSSProperties } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { fmtRisk, fmtSafe } from './format';
import { OFFSPRING, lineSlices, type Family } from './math';
import { R, aliveMask, nodeRadius, ringRadius, type Tree } from './tree';

const W = 560;
const H = 440;
const CX = 280;
const CY = 218;
/** Where the goal-ring label runs, outside the ring. */
const LABEL_R = R + 16;

const polar = (r: number, a: number) => ({ x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) });
const f = (n: number) => n.toFixed(1);

/** A branch from a parent to its child: leaves the parent radially, arrives radially. */
function edgePath(r1: number, a1: number, r2: number, a2: number) {
  const m = (r1 + r2) / 2;
  const p = polar(r1, a1);
  const c1 = r1 === 0 ? polar(m * 0.4, a2) : polar(m, a1);
  const c2 = polar(m, a2);
  const q = polar(r2, a2);
  return `M${f(p.x)} ${f(p.y)}C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(q.x)} ${f(q.y)}`;
}

/** A circle drawn as a stroke from the top, clockwise, for dash-based arcs. */
function Arc({ r, start, length, className, cx = CX, cy = CY }: { r: number; start: number; length: number; className: string; cx?: number; cy?: number }) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      pathLength={1}
      className={className}
      strokeDasharray={`${Math.max(0, length)} 1`}
      strokeDashoffset={-start}
      transform={`rotate(-90 ${cx} ${cy})`}
    />
  );
}

export interface BoardProps {
  family: Family;
  gens: number;
  tree: Tree;
  /** The newest generation is being drawn right now. */
  animating: boolean;
  /** P(family alive at the goal), drawn as the lit share of the goal ring. */
  chance: number;
  /** P(every line dies out first) = 1 − chance, computed directly. */
  risk: number;
  /** Each living line's own survival chance, drawn on every frontier node. */
  s: number;
  /** Lines alive. */
  z: number;
  /** Generation reached (the frontier). */
  reached: number;
  live: boolean;
  idle: boolean;
  outcome: 'extinct' | 'cashed' | 'survived' | 'secured' | null;
  growMs: number;
  easeMs: number;
}

export default function Board({ family, gens, tree, animating, chance, risk, s, z, reached, live, idle, outcome, growMs, easeMs }: BoardProps) {
  const last = tree.length - 1;
  // While a generation grows, keep the old colouring: the reveal does the talking.
  const mask = animating ? [...aliveMask(tree.slice(0, -1)), tree[last].map(() => true)] : aliveMask(tree);
  const nr = nodeRadius(gens);
  const slices = chance >= 1 ? [{ start: 0, length: 1 }] : chance <= 0 ? [] : lineSlices(s, z);
  const showPies = (live || idle) && !animating;
  const frontier = animating ? last - 1 : last;
  const p = OFFSPRING[family];
  const style = { '--grow': `${growMs}ms`, '--ease': `${easeMs}ms` } as CSSProperties;

  const tone = outcome === 'extinct' ? ' lost' : outcome === 'survived' || outcome === 'secured' ? ' won' : '';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={'branching' + tone} style={style} role="img" aria-label={`Family alive at generation ${gens}: ${fmtSafe(chance)}`}>
      {/* Generation rings: passed, next, still to come. */}
      <g className="rings">
        {Array.from({ length: gens - 1 }, (_, i) => i + 1).map((g) => (
          <circle key={g} cx={CX} cy={CY} r={ringRadius(g, gens)} className={g <= reached ? 'done' : g === reached + 1 && live ? 'next' : ''} />
        ))}
      </g>

      {/* The goal ring doubles as the odds: its green share is the chance to reach it. */}
      <g className="goal">
        <circle cx={CX} cy={CY} r={R} className="goal-track" />
        {slices.map((sl, i) => (
          <Arc key={i} r={R} start={sl.start} length={sl.length} className={'goal-slice' + (i % 2 ? ' alt' : '')} />
        ))}
        {/* Dark seams between the lines' slices. */}
        {slices.length > 1 &&
          slices.slice(1).map((sl, i) => {
            const a = sl.start * 2 * Math.PI - Math.PI / 2;
            const p = polar(R - 7, a);
            const q = polar(R + 7, a);
            return <line key={i} x1={f(p.x)} y1={f(p.y)} x2={f(q.x)} y2={f(q.y)} className="seam" />;
          })}
        <line x1={CX} y1={CY - R - 9} x2={CX} y2={CY - R + 9} className="goal-tick" />
        <path id="br-goal-label" d={`M${CX - LABEL_R} ${CY} A${LABEL_R} ${LABEL_R} 0 0 0 ${CX + LABEL_R} ${CY}`} fill="none" />
        <text className="goal-label">
          <textPath href="#br-goal-label" startOffset="50%">
            GOAL · GENERATION {gens}
          </textPath>
        </text>
      </g>

      {/* Branches. */}
      <g className="edges">
        {tree.map((gen, g) =>
          g === 0
            ? null
            : gen.map((node, i) => {
                const parent = tree[g - 1][node.parent];
                const d = edgePath(ringRadius(g - 1, gens), parent.angle, ringRadius(g, gens), node.angle);
                const fresh = animating && g === last;
                return <path key={`${g}-${i}`} d={d} pathLength={1} className={'edge' + (mask[g][i] ? ' alive' : ' dead') + (fresh ? ' new' : '')} />;
              }),
        )}
      </g>

      {/* Nodes; the frontier carries its own survival pie. */}
      <g className="nodes">
        {tree.map((gen, g) =>
          gen.map((node, i) => {
            const { x, y } = polar(ringRadius(g, gens), node.angle);
            const fresh = animating && g === last;
            const dying = animating && g === last - 1 && node.kids === 0;
            const ended = !animating && node.kids === 0;
            const cls =
              'node' +
              (mask[g][i] ? ' alive' : ' dead') +
              (g === frontier ? ' frontier' : '') +
              (fresh ? ' new' : '') +
              (dying ? ' dying' : '') +
              (ended ? ' ended' : '') +
              (g === 0 ? ' seed' : '');
            return (
              <g key={`${g}-${i}`}>
                {showPies && g === frontier && (
                  <>
                    <circle cx={x} cy={y} r={nr + 4} className="pie-track" />
                    <Arc cx={x} cy={y} r={nr + 4} start={0} length={s} className="pie" />
                  </>
                )}
                <circle cx={x} cy={y} r={g === 0 ? nr + 1.5 : nr} className={cls} />
              </g>
            );
          }),
        )}
      </g>

      {/* Top left: where we are. */}
      <g className="corner">
        <text x={16} y={30} className="cap">
          GENERATION
        </text>
        <text x={16} y={62} className="big">
          {reached}
          <tspan className="of"> / {gens}</tspan>
        </text>
      </g>

      {/* Top right: the legend for the goal ring. */}
      <g className="corner end">
        <text x={W - 16} y={30} className="cap">
          FAMILY SURVIVES
        </text>
        <text x={W - 16} y={62} className="big win">
          {fmtSafe(chance)}
        </text>
        <text x={W - 16} y={84} className="small lose">
          dies out {fmtRisk(risk)}
        </text>
      </g>

      {/* Bottom left: the offspring law. */}
      <g className="corner law">
        <text x={16} y={318} className="cap">
          CHILDREN
        </text>
        <text x={16} y={335} className="cap">
          PER NODE
        </text>
        {p.map((pk, k) => {
          const h = pk * 90;
          const x = 18 + k * 30;
          return (
            <g key={k}>
              <rect x={x} y={408 - h} width={22} height={Math.max(h, 1)} rx={3} className={k === 0 ? 'bar zero' : 'bar'} />
              <text x={x + 11} y={402 - h} className="pct">
                {Math.round(pk * 100)}%
              </text>
              <text x={x + 11} y={425} className="k">
                {k}
              </text>
            </g>
          );
        })}
      </g>

      {/* Bottom right: the per-line pie, labelled. */}
      {z > 0 && chance < 1 && chance > 0 && (
        <g className="corner end">
          <text x={W - 16} y={346} className="cap">
            EACH LINE
          </text>
          <circle cx={W - 30} cy={377} r={11} className="pie-track big-pie" />
          <Arc cx={W - 30} cy={377} r={11} start={0} length={s} className="pie big-pie" />
          <text x={W - 52} y={385} className="mid">
            {fmtChance(s)}
          </text>
          <text x={W - 16} y={414} className="small">
            {z === 1 ? '1 line alive' : `${z} lines alive`}
          </text>
        </g>
      )}
    </svg>
  );
}
