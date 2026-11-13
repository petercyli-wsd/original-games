import { InfoModal as KitInfoModal, InfoSection } from '@originals/game-sdk/ui';

export default function InfoModal({ rtp, onClose }: { rtp: number; onClose(): void }) {
  return (
    <KitInfoModal title="Slice" onClose={onClose}>
      <InfoSection title="Goal">
        <p>A dot is hidden somewhere in the square. If it is inside your circle, you win.</p>
      </InfoSection>
      <InfoSection title="How to play">
        <ol>
          <li>Place your circle and pick its size. A smaller circle is less likely to hold the dot, so it pays more. Where you put it does not change the odds.</li>
          <li>Press Bet. A random line slices the square, and the half without the dot falls away. The lines never aim at the dot or your circle.</li>
          <li>Your win chance is how much of the bright area your circle covers.</li>
          <li>After every cut, cash out or cut again. Cashing out pays the prize × your win chance right now. Auto-cut keeps cutting for you.</li>
          <li>Keys: Space bets or cuts again, C cashes out, Esc clears a finished board.</li>
        </ol>
      </InfoSection>
      <InfoSection title="The round ends when">
        <ul>
          <li>everything left is inside your circle: you win the full prize;</li>
          <li>your circle is sliced away completely: you lose;</li>
          <li>after the last cut, the dot is revealed: full prize if it is inside your circle.</li>
        </ul>
      </InfoSection>
      <InfoSection title="Payouts and fairness">
        <p>
          Cashing out at any point, or playing to the reveal, returns {(rtp * 100).toFixed(0)}% on average. No strategy beats any other, so stop whenever you
          like.
        </p>
      </InfoSection>
    </KitInfoModal>
  );
}
