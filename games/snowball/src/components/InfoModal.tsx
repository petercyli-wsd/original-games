import { useEffect } from 'react';
import { formatPercent } from '@originals/game-sdk';
import { DRAWS, MAJORITY } from '../math';

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
          <button className="ghost icon" onClick={onClose}>
            Close
          </button>
        </div>

        <h3>Goal</h3>
        <p>
          You are blue. Out of {DRAWS} draws from the urn, blue wins if at least {MAJORITY} are blue: the first colour to {MAJORITY}{' '}
          draws wins.
        </p>

        <h3>How to play</h3>
        <ol className="rules">
          <li>Pick a starting urn and press Bet. Nothing is drawn yet.</li>
          <li>
            Press <b>Draw ball</b>. A ball comes out at random, then goes back in <b>with a twin of the same colour</b>. The urn grows by
            one ball per draw, so whichever colour is drawn more gets likelier still: it snowballs.
          </li>
          <li>
            After any draw you can <b>cash out</b>, or keep drawing. The round ends as soon as one colour has {MAJORITY} draws.
          </li>
        </ol>

        <h3>Reading the odds</h3>
        <p>
          Blue balls are filled and red balls are outlined. The <b>draw tally</b> is the whole bet: blue fills from the left, red from
          the right, and whoever reaches the centre slot first wins. The gaps to the centre are the draws each side still needs.{' '}
          <b>Blue wins</b> is the exact chance blue gets there first. The next ball is blue with the chance of the share of blue
          balls in the urn. The ringed pair is the ball just drawn and its twin.
        </p>

        <h3>The maths</h3>
        <p>
          This is Pólya's urn. From an urn with b blue and r red, the number of blue balls among the next n draws follows the
          beta-binomial law: P(k blue) = C(n, k) · B(b + k, r + n − k) / B(b, r). Blue's win chance is the sum of that over every k at
          least the number blue still needs.
        </p>

        <h3>Payouts and fairness</h3>
        <p>
          A win pays prize = {formatPercent(rtp, 0)} ÷ starting win chance. Cash out pays prize × the current win chance. That value
          moves with every draw but its expected next value is always where it is now (a martingale), so every way of playing returns{' '}
          {formatPercent(rtp, 0)} on average. Keys: <kbd>Space</kbd> bet / draw, <kbd>C</kbd> cash out.
        </p>
      </div>
    </div>
  );
}
