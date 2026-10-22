import { COMMITTEES, coalitionSum, tipZone, voterName, zoneText, type Column, type CommitteeId, type Ending } from './math';

const X0 = 40;
const X1 = 384;
const BAR_Y = 52;
const BAR_H = 40;
const CH_TOP = 240;
const CH_H = 150;

export interface BoardProps {
  committee: CommitteeId;
  backed: number;
  /** Voters in the coalition, in join order. */
  order: number[];
  /** Who could join next, with your chance if they do. */
  cols: Column[];
  /** Your chance now (the average of the columns). */
  chance: number;
  /** The voter joining right now, or the last to join once the round is over. */
  pick: number | null;
  ending: Ending | null;
  live: boolean;
  /** Choose the backed voter by clicking a column (only between rounds). */
  onPick?: (voter: number) => void;
}

export default function Board({ committee, backed, order, cols, chance, pick, ending, live, onPick }: BoardProps) {
  const { weights, quota } = COMMITTEES[committee];
  const total = weights.reduce((a, b) => a + b, 0);
  const u = (X1 - X0) / total;
  const x = (v: number) => X0 + v * u;
  const s = coalitionSum(committee, order);
  const zone = tipZone(committee, backed);
  const joined = order.includes(backed);
  const inZone = s >= zone.from && s <= zone.to;
  const you = `${voterName(backed)}·${weights[backed]}`;

  // Coalition blocks, in join order.
  let at = 0;
  const blocks = order.map((j, k) => {
    const b = { j, from: at, w: weights[j], last: k === order.length - 1 };
    at += weights[j];
    return b;
  });

  const m = cols.length;
  const cw = m ? Math.min(62, (X1 - X0) / m) : 0;
  const cx0 = X0 + (X1 - X0 - cw * m) / 2;
  const chanceY = CH_TOP + CH_H * (1 - chance);
  const tokenR = Math.min(15, cw / 2 - 3);

  return (
    <svg viewBox="0 0 400 426" className="pivot" role="img" aria-label={`Coalition ${s} of quota ${quota}; your voter ${you}`}>
      {/* ---- The coalition bar ---- */}
      <text x={X0} y={22} className="sec">
        COALITION
      </text>
      <text x={X1} y={22} className="sec end">
        total {s} · quota {quota} of {total}
      </text>

      <rect x={x(zone.from)} y={BAR_Y - 10} width={(zone.to + 1 - zone.from) * u} height={BAR_H + 20} rx={4} className={'zone' + (inZone && !joined && live ? ' hot' : '')} />
      <rect x={X0} y={BAR_Y} width={X1 - X0} height={BAR_H} rx={6} className="track" />
      {Array.from({ length: total - 1 }, (_, k) => (
        <line key={k} x1={x(k + 1)} x2={x(k + 1)} y1={BAR_Y + BAR_H - 6} y2={BAR_Y + BAR_H} className="tick" />
      ))}

      {blocks.map((b) => {
        const crossed = b.from + b.w >= quota;
        const cls = b.j === backed ? (crossed ? 'blk you won' : 'blk you lost') : crossed ? 'blk beat' : 'blk';
        return (
          <g key={b.j} className={b.last ? 'fresh' : undefined}>
            <rect x={x(b.from) + 1} y={BAR_Y + 1} width={b.w * u - 2} height={BAR_H - 2} rx={5} className={cls} />
            <text x={x(b.from + b.w / 2)} y={BAR_Y + BAR_H / 2 + 5} className="blk-t">
              {b.w * u > 22 ? `${voterName(b.j)}${b.w > 1 && b.w * u > 40 ? '·' + b.w : ''}` : voterName(b.j)}
            </text>
          </g>
        );
      })}

      {/* Your voter, drawn where it would land if it joined now. */}
      {!joined && ending !== 'beaten' && (
        <g className={'ghost' + (inZone ? ' tips' : '')}>
          <rect x={x(s) + 1} y={BAR_Y + 1} width={Math.min(weights[backed], total - s) * u - 2} height={BAR_H - 2} rx={5} />
          <text x={x(s + Math.min(weights[backed], total - s) / 2)} y={BAR_Y + BAR_H / 2 + 5}>
            {voterName(backed)}
          </text>
        </g>
      )}

      <line x1={x(quota)} x2={x(quota)} y1={BAR_Y - 16} y2={BAR_Y + BAR_H + 16} className="quota" />
      <text x={x(quota)} y={BAR_Y - 20} className="quota-t">
        quota {quota}
      </text>

      <text x={(x(zone.from) + x(zone.to + 1)) / 2} y={BAR_Y + BAR_H + 30} className="zone-t">
        tip zone: total {zoneText(zone)}
      </text>
      <text x={200} y={BAR_Y + BAR_H + 58} className="note">
        {ending === 'tipped'
          ? `${you} joined at ${s - weights[backed]} and tipped the quota`
          : ending === 'early'
            ? `${you} joined at ${s - weights[backed]}: short of the tip zone`
            : ending === 'beaten'
              ? `${voterName(order[order.length - 1])} took the total to ${s} first`
              : ending === 'reach'
                ? `Too little weight left to reach the tip zone`
                : joined
                  ? ''
                  : inZone
                    ? `If ${you} joins now, it tips the quota`
                    : `${you} tips it if it joins at a total of ${zoneText(zone)}`}
      </text>

      {/* ---- Who joins next: equal columns filled to your chance after each ---- */}
      {m > 0 && (
        <>
          <text x={X0} y={CH_TOP - 64} className="sec">
            {ending && ending !== 'cashed' ? 'THE LAST JOIN' : 'WHO JOINS NEXT'}
          </text>
          <text x={X1} y={CH_TOP - 64} className="sec end">
            each equally likely · fill = your chance after
          </text>
          <rect x={cx0} y={CH_TOP} width={cw * m} height={CH_H} className="chart-bg" />
          {cols.map((c, k) => {
            const cx = cx0 + k * cw;
            const isYou = c.voter === backed;
            const fillH = CH_H * c.p;
            const cls = 'col' + (isYou ? ' you' : '') + (c.ends === 'lost' ? ' dead' : '') + (pick === c.voter ? ' pick' : '') + (onPick ? ' clickable' : '');
            return (
              <g key={c.voter} className={cls} onClick={onPick ? () => onPick(c.voter) : undefined}>
                <rect x={cx + 2} y={CH_TOP} width={cw - 4} height={CH_H} className="col-box" />
                <rect x={cx + 2} y={CH_TOP + CH_H - fillH} width={cw - 4} height={fillH} className="col-fill" />
                {c.ends === 'lost' && (
                  <text x={cx + cw / 2} y={CH_TOP + CH_H - 10} className="col-x">
                    ✕
                  </text>
                )}
                <circle cx={cx + cw / 2} cy={CH_TOP - 32} r={tokenR} className="tok" />
                <text x={cx + cw / 2} y={CH_TOP - 27} className="tok-t">
                  {voterName(c.voter)}
                </text>
                <text x={cx + cw / 2} y={CH_TOP - 4} className="tok-w">
                  {isYou ? 'you' : `w${weights[c.voter]}`}
                </text>
              </g>
            );
          })}
          <line x1={cx0 - 4} x2={cx0 + cw * m + 2} y1={chanceY} y2={chanceY} className="avg" />
          <text x={cx0 - 6} y={chanceY + 4} className="avg-t">
            {Math.round(chance * 100)}%
          </text>
          <text x={200} y={CH_TOP + CH_H + 22} className="note">
            Green share of the columns = your chance now
          </text>
        </>
      )}
    </svg>
  );
}
