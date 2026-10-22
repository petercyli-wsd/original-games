import { useMemo } from 'react';
import { CHART_UPS, strategyChart, type ChartCell } from './math';

const CELL_TITLE: Record<ChartCell, string> = { H: 'Hit', S: 'Stand', D: 'Double (else hit)', Ds: 'Double (else stand)', P: 'Split' };

/** The exact basic-strategy chart, computed from the same DP the hints use. */
export default function Chart() {
  const chart = useMemo(strategyChart, []);
  const block = (title: string, rows: { label: string; cells: ChartCell[] }[]) => (
    <table className="bj-chart">
      <thead>
        <tr>
          <th>{title}</th>
          {CHART_UPS.map((u) => (
            <th key={u}>{u === 1 ? 'A' : u}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th>{r.label}</th>
            {r.cells.map((c, i) => (
              <td key={i} className={`c-${c}`} title={CELL_TITLE[c]}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="bj-charts">
      {block('Hard', chart.hard)}
      {block('Soft', chart.soft)}
      {block('Pair', chart.pairs)}
      <p className="bj-chart-key">
        <span className="c-H">H</span> hit <span className="c-S">S</span> stand <span className="c-D">D</span> double, else hit <span className="c-Ds">Ds</span> double,
        else stand <span className="c-P">P</span> split. Columns are the dealer's up card.
      </p>
    </div>
  );
}
