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
            Press the croc's teeth one at a time. Some teeth are bad. <b className="t-win">Every safe tooth raises your multiplier.</b>{' '}
            <b className="t-lose">Press a bad one and the croc bites.</b>
          </p>

          <h3>A game</h3>
          <ol className="steps">
            <li>
              <span className="dot you" />
              <div>
                <b>Press a tooth.</b> Pick any tooth, or use <i>Pick Random Tooth</i>. A bad tooth ends the game and you lose your bet.
              </div>
            </li>
            <li>
              <span className="dot win" />
              <div>
                <b>Safe? Your multiplier goes up.</b> <b>Cash Out</b> to bank it, or press another tooth to push for more.
              </div>
            </li>
          </ol>
          <p className="small">Press every good tooth and you're paid the top multiplier automatically.</p>

          <h3>Settings</h3>
          <dl className="defs">
            <dt>Teeth</dt>
            <dd>How many teeth the croc has. More teeth make each press safer, so the multiplier climbs in smaller steps.</dd>
            <dt>Bad Teeth</dt>
            <dd>How many teeth bite. More bad teeth make each press riskier, and each safe press pays a lot more.</dd>
          </dl>

          <h3>Reading the screen</h3>
          <dl className="defs">
            <dt>Bite odds bar</dt>
            <dd>
              One block per tooth still in the mouth. <span className="t-lose">Red</span> blocks are the bad teeth, so you can see the chance of a bite on
              the next press. The jaw also sinks lower as the odds get worse.
            </dd>
            <dt>Tooth strip</dt>
            <dd>What you can cash out after each safe press, and how likely you are to get that far from the start.</dd>
          </dl>

          <h3>Fairness</h3>
          <p>
            The multipliers are set so that cashing out after any number of presses returns {(rtp * 100).toFixed(1)}% on average. Where the bad teeth
            are is fixed when you bet.
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
