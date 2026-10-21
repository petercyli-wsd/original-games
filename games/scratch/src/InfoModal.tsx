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

  const pct = `${(rtp * 100).toFixed(0)}%`;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="scratch-info-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="scratch-info-title">How to play</h2>
          <button className="close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="lede">
            One card hides the gold diamond. <b className="t-win">Scratch it within your goes and you win the prize.</b>
          </p>
          <ol className="steps">
            <li>
              <b>Pick a board:</b> how many cards, and how many goes you get. Fewer goes or more cards means a longer shot and a bigger
              prize. The prize is {pct} × cards ÷ goes.
            </li>
            <li>
              <b>Scratch</b> any card, or let us pick one at random. Find the diamond and you're paid at once.
            </li>
            <li>
              <b>Watch your odds.</b> With <i>g</i> goes left and <i>r</i> cards still covered, your chance is simply <b>g in r</b>. Every
              miss uses a go and removes a card, so the odds drain as you miss.
            </li>
          </ol>
          <h3>After every miss you can</h3>
          <ul className="ends">
            <li>
              <b>scratch again;</b>
            </li>
            <li>
              <b className="t-gold">sell your remaining goes</b> for prize × g ÷ r, their exact fair value right now. It falls as you miss;
              that's the odds moving, not a fee;
            </li>
            <li>
              <b className="t-acc">buy another scratch</b> <span className="tag">variant</span>: one more go for the fair price of the extra
              chance it gives you. With fewer cards left each extra go costs more, but is more likely to win. The prize never changes.
              When you're out of goes you can buy one, or end the round.
            </li>
          </ul>
          <h3>Fairness</h3>
          <p>
            Selling, playing on and buying are all priced at the same {pct} return. Whatever you choose, on average you get back {pct} of
            everything you stake, so no strategy beats any other. "Spent this round" shows everything you've put in so you can see when a
            chase is costing more than the prize.
          </p>
          <p>When a round ends without the diamond, the winning card is revealed.</p>
          <h3>Keyboard</h3>
          <p className="keys">
            <kbd>Space</kbd> bet or scratch a random card · <kbd>S</kbd> sell goes (or end the round when out) · <kbd>B</kbd> buy a
            scratch · <kbd>Esc</kbd> close
          </p>
        </div>
      </div>
    </div>
  );
}
