import { useEffect } from 'react';

interface Props {
  onClose: () => void;
  rtp: number;
}

export default function InfoModal({ onClose, rtp }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="info-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="info-title">How to play</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="lede">
            You and the House take turns pressing the croc's teeth. Some teeth are bad. <b className="t-lose">Get bitten and you lose.</b>{' '}
            <b className="t-win">If the House gets bitten, you win.</b>
          </p>

          <h3>A round</h3>
          <ol className="steps">
            <li>
              <span className="dot you" />
              <div>
                <b>You press a tooth.</b> Pick any tooth, or use <i>Pick Random Tooth</i>. A bad tooth ends the game and you lose your bet.
              </div>
            </li>
            <li>
              <span className="dot house" />
              <div>
                <b>The House presses a tooth.</b> If it hits a bad tooth, you win that round's <span className="t-house">bite</span> payout.
              </div>
            </li>
            <li>
              <span className="dot win" />
              <div>
                <b>Both safe? Checkpoint.</b> Your cash-out value goes up. <b>Cash Out</b> to bank it, or press another tooth to keep going.
              </div>
            </li>
          </ol>
          <p className="small">If all the good teeth get used up, you're cashed out automatically.</p>

          <h3>Settings</h3>
          <dl className="defs">
            <dt>Teeth</dt>
            <dd>How many teeth the croc has. More teeth make for longer games with smaller steps and a higher top multiplier.</dd>
            <dt>Bad Teeth</dt>
            <dd>How many teeth bite. More bad teeth make each press riskier, games shorter, and wins bigger.</dd>
            <dt>Bite Bonus</dt>
            <dd>
              Controls where the value goes. Toward <b>Ladder</b>, the cash-out value climbs faster each round. Toward <b>Duel</b>, the House getting
              bitten pays more. At 2× with one bad tooth, it's a straight 50/50 for 1.98×.
            </dd>
            <dt>Turbo</dt>
            <dd>Makes the House take its turn almost instantly, so games play faster. It doesn't change the odds.</dd>
          </dl>

          <h3>Reading the screen</h3>
          <dl className="defs">
            <dt>Bite odds bar</dt>
            <dd>
              One block per tooth still in play. <span className="t-lose">Red</span> blocks are the bad teeth, so you can see the chance of a bite on the
              next press.
            </dd>
            <dt>Round strip</dt>
            <dd>
              Each card shows what surviving that round raises your cash-out to, plus the <span className="t-house">bite</span> payout if the House gets
              bitten in that round.
            </dd>
            <dt>Tooth colours</dt>
            <dd>
              <span className="swatch you" /> you pressed it · <span className="swatch house" /> the House pressed it · <span className="swatch bite" /> a
              bad tooth, shown when the game ends.
            </dd>
          </dl>

          <h3>Fairness</h3>
          <p>
            The payouts are set so that cashing out at any checkpoint, or playing to the end, returns {(rtp * 100).toFixed(1)}% on average. The House
            presses at random and never knows where the bad teeth are.
          </p>

          <h3>Keyboard</h3>
          <div className="keys">
            <span>
              <kbd>Space</kbd> bet, or press a random tooth
            </span>
            <span>
              <kbd>C</kbd> cash out
            </span>
            <span>
              <kbd>Esc</kbd> close this window
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
