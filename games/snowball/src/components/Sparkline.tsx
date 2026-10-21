interface Props {
  /** Win chance after each draw; probs[0] is the start. */
  probs: number[];
  draws: number;
}

const W = 300;
const H = 100;

// Win chance over the round. P_t is a fair martingale: it drifts with every
// draw but its expected next value is always where it is now.
export default function Sparkline({ probs, draws }: Props) {
  const x = (t: number) => (t / draws) * W;
  const y = (p: number) => H - p * H;
  const line = probs.map((p, t) => `${x(t).toFixed(2)},${y(p).toFixed(2)}`).join(' ');
  const last = probs.length - 1;
  const p = probs[last];
  return (
    <div className="spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="sb-spark-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--sb-win)', stopOpacity: 0.32 }} />
            <stop offset="1" style={{ stopColor: 'var(--sb-win)', stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="spark-mid" />
        {last > 0 && <polygon points={`0,${H} ${line} ${x(last)},${H}`} fill="url(#sb-spark-fill)" />}
        <polyline points={line} className="spark-line" />
      </svg>
      <i className="spark-dot" style={{ left: `${(last / draws) * 100}%`, top: `${(1 - p) * 100}%` }} />
      <span className="spark-axis top">100%</span>
      <span className="spark-axis mid">50%</span>
      <span className="spark-axis bottom">0%</span>
    </div>
  );
}
