import { useEffect } from 'react';
import { formatPercent } from '@originals/game-sdk';

interface Props {
  rtp: number;
  onClose: () => void;
}

export default function InfoModal({ rtp, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="sb-info-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="sb-info-title">How Snowball works</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <ol className="rules">
          <li>
            <i className="ball blue" />
            <span>
              <b>You are blue.</b> The urn starts with some blue and some red balls, set by the preset.
            </span>
          </li>
          <li>
            <i className="ball red" />
            <span>
              <b>Each draw picks a ball at random</b> and puts it back with a twin of the same colour. The more of a colour there is,
              the likelier it is to grow: leads snowball.
            </span>
          </li>
          <li>
            <i className="ball win" />
            <span>
              <b>After the last draw, blue must hold a strict majority</b> to win the prize. The final urn always has an odd number of
              balls, so there are no ties.
            </span>
          </li>
        </ol>
        <p>
          After every draw you can <b>cash out</b> for prize × current win chance, or keep drawing. The round ends early as soon as the
          result can no longer change. Every choice returns {formatPercent(rtp, 0)} on average: no strategy beats another.
        </p>
        <p className="muted">
          Keys: <kbd>Space</kbd> bet / draw one, <kbd>C</kbd> cash out.
        </p>
      </div>
    </div>
  );
}
