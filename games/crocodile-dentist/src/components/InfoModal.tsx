import { useEffect } from 'react';
import { BITE } from '../math';

interface Props {
  onClose: () => void;
  rtp: number;
  teeth: number;
  rounds: string[]; // cash-out multiplier after each round that both survive
}

export default function InfoModal({ onClose, rtp, teeth, rounds }: Props) {
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
            Close
          </button>
        </div>

        <div className="modal-body">
          <p className="lede">
            Take turns pressing teeth with the House. <b className="t-lose">Press the bad tooth and you lose;</b>{' '}
            <b className="t-win">if the House presses it, you win.</b> Cash out between rounds.
          </p>

          <h3>Goal</h3>
          <p>
            Don't be the one who gets bitten. The jaw has {teeth} teeth and some of them are bad. Each round you press one tooth, then the House
            presses one.
          </p>

          <h3>How to play</h3>
          <ol className="steps">
            <li>
              <span className="dot you" />
              <div>
                <b>Pick how many bad teeth</b> (the one setting) and press <b>Bet</b>. More bad teeth: lower chance, bigger payouts.
              </div>
            </li>
            <li>
              <span className="dot you" />
              <div>
                <b>You press a tooth.</b> Click any tooth, or use <i>Press a random tooth</i>. A bad tooth ends the game and you lose your bet.
              </div>
            </li>
            <li>
              <span className="dot house" />
              <div>
                <b>The House presses a tooth.</b> If it's bad, you win the <b>House bitten</b> payout shown above the teeth.
              </div>
            </li>
            <li>
              <span className="dot win" />
              <div>
                <b>Both safe? Checkpoint.</b> Your cash-out moves to the next round's value. <b>Cash Out</b> to bank it, or press another tooth.
              </div>
            </li>
          </ol>
          <p className="small">If all the good teeth get used up, you're cashed out automatically.</p>

          <h3>Reading the odds</h3>
          <dl className="defs">
            <dt>Win chance</dt>
            <dd>Your chance of winning this game if you play to the end. It moves after every press, yours and the House's.</dd>
            <dt>Cash-out by round</dt>
            <dd>
              Your cash-out after each round that both of you survive: {rounds.join(', ')}.
            </dd>
            <dt>Teeth</dt>
            <dd>
              A <b>filled dot</b> marks a tooth you pressed, a <b>ring</b> one the House pressed, and <span className="t-lose">red</span> the bad
              teeth, shown when the game ends. The tooth outlined in the accent colour is the one you are about to press.
            </dd>
          </dl>

          <h3>The maths</h3>
          <p>
            Drawing without replacement. With n teeth left and k bad, your press bites with chance k/n; if it doesn't, the House's bites with chance
            k/(n−1). A House bite pays {BITE}× the round's value. Each value is set so that cash = P(House bitten)·{BITE}·value + P(both safe)·value, which
            makes the cash-out a fair martingale.
          </p>

          <h3>Payouts and fairness</h3>
          <p>
            By the optional stopping theorem, cashing out at any checkpoint or playing to the end returns {(rtp * 100).toFixed(1)}% on average. The House
            presses at random and never knows where the bad teeth are. Turbo only makes the House quicker.
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
              <kbd>Esc</kbd> close / clear the board
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
