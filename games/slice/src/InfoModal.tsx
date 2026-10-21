import { useEffect } from 'react';

interface Props {
  rtp: number;
  onClose(): void;
}

export default function InfoModal({ rtp, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="slice-info-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="slice-info-title">How to play</h2>
          <button className="close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="lede">
            A dot is hidden somewhere in the square. <b className="t-win">If it's inside your circle, you win.</b>
          </p>
          <ol className="steps">
            <li>
              <b>Place your circle</b> and pick its size. A smaller circle is less likely to hold the dot, so it pays more. Where you put it
              doesn't change the odds.
            </li>
            <li>
              <b>Bet.</b> A random line slices the square, and the half without the dot falls away. The lines are random and never aim at
              the dot or your circle.
            </li>
            <li>
              <b>Watch the odds.</b> Your win chance is simply how much of the bright area your circle covers.
            </li>
            <li>
              <b>Cash out or cut again</b> after every cut. Cashing out pays the prize × your win chance right now.
            </li>
          </ol>
          <h3>The round ends when</h3>
          <ul className="ends">
            <li>
              <span className="t-win">everything left is inside your circle</span>: you win the full prize;
            </li>
            <li>
              <span className="t-lose">your circle is sliced away completely</span>: you lose;
            </li>
            <li>after the last cut, the dot is revealed: full prize if it's inside your circle.</li>
          </ul>
          <h3>Fairness</h3>
          <p>
            Cashing out at any point, or playing to the reveal, returns {(rtp * 100).toFixed(0)}% on average. No strategy beats any other, so
            stop whenever you like.
          </p>
          <h3>Keyboard</h3>
          <p className="keys">
            <kbd>Space</kbd> bet or cut again · <kbd>C</kbd> cash out · <kbd>Esc</kbd> close
          </p>
        </div>
      </div>
    </div>
  );
}
