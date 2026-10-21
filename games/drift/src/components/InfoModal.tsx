import { useEffect } from 'react';
import { fmtPct } from '../format';

export default function InfoModal({ onClose, rtp }: { onClose: () => void; rtp: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="drift-info-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="drift-info-title">How to play</h2>
          <button className="ghost close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="lede">
            A dot drifts one step left or right at a time, 50/50, between a <b className="t-red">red wall</b> and a{' '}
            <b className="t-green">green wall</b>. Reach green and you win the prize. Touch red and you lose your bet.
          </p>

          <h3>Position is probability</h3>
          <p>
            The dot's position along the track is <b>exactly</b> its chance of reaching green first. Halfway along is 50%; one step off the red wall
            on a 100-step track is 1%. The labels above the track read it out.
          </p>

          <h3>Start, prize and cash-out</h3>
          <ul className="bullets">
            <li>
              <b>Start position</b> sets the risk. Start near red for a big prize, near green for a likely small one. The prize is {fmtPct(rtp, 0)} ×
              track length ÷ start.
            </li>
            <li>
              <b>Cash out</b> whenever the dot is paused or running. You get the prize × the current win chance, shown under the needle. It goes up{' '}
              <i>and down</i> as the dot drifts.
            </li>
            <li>
              <b>Steps per burst</b> sets how often the round pauses at a checkpoint for you to decide. ∞ runs until you press Pause.
            </li>
            <li>
              <b>Track length</b> sets the pace. Longer tracks give longer, smoother rounds.
            </li>
            <li>
              <b>Auto cash-out</b> banks the value for you when the dot reaches your take-profit or stop-loss line.
            </li>
          </ul>

          <h3>Fairness</h3>
          <p>
            Every move is a fair coin flip, so no cash-out timing beats any other: holding to a wall, cashing early, take-profit and stop-loss all
            return {fmtPct(rtp, 0)} on average.
          </p>

          <h3>Keyboard</h3>
          <div className="keys">
            <span>
              <kbd>Space</kbd> bet, pause or continue
            </span>
            <span>
              <kbd>C</kbd> cash out
            </span>
            <span>
              <kbd>Esc</kbd> close
            </span>
          </div>
        </div>
        <div className="modal-foot">
          <button className="primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
