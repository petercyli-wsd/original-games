// The bead road: the classic baccarat scoreboard. Each round is one bead,
// filled top to bottom, column by column: P (blue), B (red), T (green), with
// small corner dots for a Player pair (top left) and a Banker pair (bottom
// right). The tallies beside it count the beads on the road.

export interface Bead {
  id: number;
  win: 'P' | 'B' | 'T';
  total: number;
  pp: boolean;
  bp: boolean;
}

export const ROAD_ROWS = 6;
export const ROAD_COLS = 14;

export function Road({ beads }: { beads: Bead[] }) {
  // beads: oldest first. Keep whole columns so the newest column is the last one shown.
  const cap = ROAD_ROWS * ROAD_COLS;
  const drop = beads.length > cap ? Math.ceil((beads.length - cap) / ROAD_ROWS) * ROAD_ROWS : 0;
  const shown = beads.slice(drop);
  const n = { P: 0, B: 0, T: 0, pp: 0, bp: 0 };
  for (const b of beads) {
    n[b.win]++;
    if (b.pp) n.pp++;
    if (b.bp) n.bp++;
  }
  const latest = beads.length ? beads[beads.length - 1].id : -1;
  return (
    <div className="bc-road">
      <div className="bc-road-grid" aria-label="Bead road: recent results">
        {Array.from({ length: cap }, (_, i) => {
          const b = shown[i];
          if (!b) return <span key={'e' + i} className="bc-bead empty" />;
          return (
            <span
              key={b.id}
              className={`bc-bead ${b.win}` + (b.id === latest ? ' latest' : '')}
              title={`${b.win === 'P' ? 'Player' : b.win === 'B' ? 'Banker' : 'Tie'} ${b.total}${b.pp ? ' · Player pair' : ''}${b.bp ? ' · Banker pair' : ''}`}
            >
              {b.win}
              {b.pp && <i className="pp" />}
              {b.bp && <i className="bp" />}
            </span>
          );
        })}
      </div>
      <dl className="bc-road-tally">
        <div className="P">
          <dt>Player</dt>
          <dd>{n.P}</dd>
        </div>
        <div className="B">
          <dt>Banker</dt>
          <dd>{n.B}</dd>
        </div>
        <div className="T">
          <dt>Tie</dt>
          <dd>{n.T}</dd>
        </div>
        <div className="pairs">
          <dt>Pairs</dt>
          <dd>
            {n.pp} / {n.bp}
          </dd>
        </div>
      </dl>
    </div>
  );
}
