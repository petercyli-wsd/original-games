import type { CSSProperties } from "react";
import { BALL_Y, ITEM_ROW, ROW, VIEW, markerX, slotCell } from "./geometry";
import { N, countRecords, isRecord, outOfReach } from "./math";

export type Phase = "idle" | "running" | "checkpoint" | "over";
export type Outcome = "target" | "cashed" | "short";

export interface BoardProps {
  k: number;
  /** The items on show, as the slot each one landed in (slot t of t is a record). */
  ranks: readonly number[];
  /** Changes every round, so the newest item's animation replays. */
  roundId: number;
  phase: Phase;
  outcome: Outcome | null;
  /** True while the newest item's ball is still falling. */
  dropping: boolean;
  /** How long the newest item takes to land. */
  itemMs: number;
  /** Small frames get larger type. */
  narrow?: boolean;
  svgRef?: (el: SVGSVGElement | null) => void;
}

const ROW_CX = (ROW.x0 + ROW.x1) / 2;
const ROW_CY = ROW.y + ROW.h / 2;
const vars = (v: Record<string, string | number>) => v as CSSProperties;

export default function Board({
  k,
  ranks,
  roundId,
  phase,
  outcome,
  dropping,
  itemMs,
  narrow,
  svgRef,
}: BoardProps) {
  const n = N;
  const j = ranks.length;
  // While the ball falls, the item row and the tally still show the items before it.
  const settled = dropping ? ranks.slice(0, -1) : ranks;
  const js = settled.length;
  const r = countRecords(settled);
  const live = phase === "running" || phase === "checkpoint";

  // The stage shows the item that just landed (while it lands, and after the round), else the next one waiting.
  const landed = (phase === "running" || phase === "over") && j > 0;
  const t = landed ? j : Math.min(j + 1, n);
  const rank = landed ? ranks[j - 1] : null;
  const hit = rank !== null && isRecord(rank, t);
  const gap = t <= 60 ? 2 : 0;
  const top = slotCell(t, t);
  const ballX =
    rank === null ? ROW_CX : slotCell(t, rank).x + slotCell(t, rank).w / 2;

  const pipGap = Math.min(18, 150 / k);
  const fs = narrow ? 1.25 : 1;
  const ruleY = narrow ? [260, 281, 302] : [260, 278, 296];

  let verdict = t === 1 ? "ALWAYS A RECORD" : `1 IN ${t} IS A RECORD`;
  if (rank !== null && !dropping) verdict = hit ? "NEW RECORD!" : "NO RECORD";

  // Legend for the item row, laid out right to left from the row's end.
  const charW = 6.4 * fs;
  const legend = [
    { cls: "mk record", label: "record" },
    { cls: "mk miss", label: "miss" },
    { cls: "mk future", label: "to come" },
  ];
  let lx = ITEM_ROW.x1;
  const legendAt = legend
    .slice()
    .reverse()
    .map((l) => {
      const textX = lx - l.label.length * charW;
      const dotX = textX - 8 * fs;
      lx = dotX - 14 * fs;
      return { ...l, textX, dotX };
    });

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      className={
        "rec" +
        (phase === "over" ? " over" : "") +
        (outcome === "target" ? " won" : "") +
        (narrow ? " narrow" : "")
      }
      role="img"
      aria-label={`${r} of ${k} records after ${j} of ${n} items`}
    >
      {/* Header: the record tally against the target, and the items still to come. */}
      <text x={ROW.x0} y={26} className="cap">
        RECORDS
      </text>
      {Array.from({ length: k }, (_, i) => (
        <circle
          key={`${roundId}-pip-${i}`}
          cx={ROW.x0 + (narrow ? 96 : 80) + i * pipGap}
          cy={22}
          r={Math.min(6, pipGap * 0.36)}
          className={
            "pip" +
            (i < r ? " on" : "") +
            (i === r - 1 && phase === "running" && !dropping && hit
              ? " pop"
              : "")
          }
        />
      ))}
      <text
        x={ROW.x0 + (narrow ? 96 : 80) + (k - 0.5) * pipGap + 8}
        y={27}
        className="tally"
      >
        {Math.min(r, k)} / {k}
      </text>
      <text x={ROW.x1} y={26} className="cap end">
        {n - js} {n - js === 1 ? "ITEM" : "ITEMS"} LEFT
      </text>

      {/* The draw: item t lands in one of t equal slots; the green top slot is a record. */}
      <text x={ROW.x0} y={ROW.y - 12} className="cap">
        ITEM {t} OF {n}
      </text>
      <text
        x={ROW.x1}
        y={ROW.y - 12}
        className={
          "verdict end" + (rank === null || dropping || hit ? " g" : " miss")
        }
      >
        {verdict}
      </text>
      {Array.from({ length: t }, (_, i) => {
        const c = slotCell(t, i + 1);
        const isTop = i + 1 === t;
        return (
          <rect
            key={`s-${t}-${i}`}
            x={c.x + gap / 2}
            y={ROW.y}
            width={Math.max(0.6, c.w - gap)}
            height={ROW.h}
            rx={t <= 30 ? 3 : 0}
            className={
              "slot" +
              (isTop ? " top" : "") +
              (rank === i + 1 && !dropping ? " landed" : "")
            }
          />
        );
      })}
      <text
        x={top.x + top.w}
        y={ROW.y + ROW.h + 15}
        className="slot-label g end"
      >
        {t === 1 ? "RECORD SLOT" : "▲ RECORD SLOT"}
      </text>
      {t > 1 && (
        <text x={ROW.x0} y={ROW.y + ROW.h + 15} className="slot-label">
          GREY SLOTS: NO RECORD
        </text>
      )}
      <circle
        key={`${roundId}-ball-${t}-${rank ?? "wait"}`}
        cx={ballX}
        cy={rank === null ? BALL_Y : ROW_CY}
        r={9}
        className={
          "ball" +
          (rank === null ? " waiting" : "") +
          (hit && !dropping ? " hit" : "") +
          (dropping ? " drop" : "")
        }
        style={
          dropping
            ? vars({
                "--fx": `${ROW_CX - ballX}px`,
                "--fy": `${BALL_Y - ROW_CY}px`,
                "--ms": `${itemMs}ms`,
              })
            : undefined
        }
      />

      {/* The queue: one marker per item. Green tick = record, grey dot = miss, ring = still to come. */}
      <text x={ITEM_ROW.x0} y={ITEM_ROW.y - 20} className="cap">
        THE {n} ITEMS
      </text>
      {legendAt.map((l) => (
        <g key={l.label}>
          <circle
            cx={l.dotX}
            cy={ITEM_ROW.y - 24 * (narrow ? 1.04 : 1)}
            r={l.label === "miss" ? 3 : 4.5}
            className={l.cls}
          />
          <text x={l.textX} y={ITEM_ROW.y - 20} className="legend">
            {l.label}
          </text>
        </g>
      ))}
      {Array.from({ length: n }, (_, i) => {
        const m = i + 1;
        const x = markerX(n, m);
        const num = (
          <text
            x={x}
            y={ITEM_ROW.y + 23}
            className={
              "num" + (m === t && (live || phase === "idle") ? " now" : "")
            }
          >
            {m}
          </text>
        );
        if (m > js) {
          const next = (live || phase === "idle") && m === js + 1;
          return (
            <g
              key={`f-${m}`}
              className={phase === "over" ? "faded" : undefined}
            >
              <circle
                cx={x}
                cy={ITEM_ROW.y}
                r={next ? 7.5 : 6}
                className={"mk future" + (next ? " next" : "")}
              />
              {num}
            </g>
          );
        }
        const rec = isRecord(ranks[i], m);
        const anim = phase === "running" && m === j;
        return (
          <g key={`${roundId}-a-${m}`} className={anim ? "appear" : undefined}>
            {rec ? (
              <>
                <circle cx={x} cy={ITEM_ROW.y} r={8.5} className="mk record" />
                <path
                  d={`M ${x - 4} ${ITEM_ROW.y + 0.3} l 2.8 2.9 l 5.2 -5.6`}
                  className="tick"
                />
              </>
            ) : (
              <circle cx={x} cy={ITEM_ROW.y} r={4} className="mk miss" />
            )}
            {num}
          </g>
        );
      })}

      {/* The rule, in three short lines (on wide boards the result card takes this space once the round is over). */}
      <g className={phase === "over" && !narrow ? "under-card" : undefined}>
        <text x={ROW.x0} y={ruleY[0]} className="rule">
          Item t lands in one of t slots.
        </text>
        <text x={ROW.x0} y={ruleY[1]} className="rule">
          Only the <tspan className="g">green slot</tspan> is a new record.
        </text>
        <text x={ROW.x0} y={ruleY[2]} className="rule">
          Get <tspan className="strong">{k}+ records</tspan> in {n} items to
          win.
        </text>
      </g>
      {phase === "checkpoint" && outOfReach(k, j + 1, r) && (
        <text x={ROW.x1} y={ruleY[2]} className="rule warn end">
          next miss loses
        </text>
      )}
    </svg>
  );
}
