import { formatPercent, type GameManifest } from '@originals/game-sdk';
import { rtpWithTier } from '../lib/slotInfo';
import { slotFacts, slotReview } from '../registry';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const label = (key: string) => cap(key.replace(/[_-]+/g, ' '));

/** Slot facts (from slot-facts.json plus the manifest) and, when present, the slot AI review (slot-review.json). */
export function SlotFacts({ manifest }: { manifest: GameManifest }) {
  const f = slotFacts(manifest);
  const review = slotReview(manifest.id);
  const rows: [string, string][] = [['RTP', rtpWithTier(f)]];
  if (f.hitRate !== undefined) rows.push(['Hit rate', formatPercent(f.hitRate)]);
  rows.push(['Volatility', cap(f.volatility) + (f.volatilitySd !== undefined ? ` (SD ${f.volatilitySd.toFixed(1)}×)` : '')]);
  rows.push(['Max win', `${f.maxWin.toLocaleString('en-US')}×`]);
  if (f.featureFreq !== undefined) rows.push(['Feature', `1 in ${Math.round(f.featureFreq).toLocaleString('en-US')} spins`]);
  if (f.featureShare !== undefined) rows.push(['Feature share of RTP', formatPercent(f.featureShare, 0)]);

  return (
    <aside className="stats-panel slot-facts">
      <div className="panel-head">
        <h2>Slot facts</h2>
      </div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {review && (
        <>
          <div className="panel-head">
            <h2>Slot review</h2>
            {review.gate !== undefined && <span className={`slot-gate ${review.gate ? 'pass' : 'fail'}`}>Gate {review.gate ? 'pass' : 'fail'}</span>}
          </div>
          <dl>
            {review.overall !== undefined && (
              <div>
                <dt>Overall</dt>
                <dd>{Number.isInteger(review.overall) ? review.overall : review.overall.toFixed(1)}</dd>
              </div>
            )}
            {review.scores.map(([k, v]) => (
              <div key={k}>
                <dt>{label(k)}</dt>
                <dd>{Number.isInteger(v) ? v : v.toFixed(1)}</dd>
              </div>
            ))}
          </dl>
          {review.verdict && <p className="slot-verdict">{review.verdict}</p>}
        </>
      )}
    </aside>
  );
}
