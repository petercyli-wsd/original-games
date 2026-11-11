import { defineEval } from '@originals/game-sdk';
import { BOARDS, BOARD_NAME, CASES, playRound, type BoardId } from './math';

// The only in-round decision is when to take Deal. Each simulated round samples
// a stopping style: play to the last other case, stop after a random opening,
// take the first Deal that beats the bet, or take the first Deal under/over a
// random threshold. All return RTP exactly (the offer is a martingale).
export default defineEval<{ board: BoardId }>({
  configs: BOARDS.map((board, i) => ({ label: `${i === 0 ? 'low' : 'high'} (${BOARD_NAME[board]} board)`, params: { board } })),
  playRound({ board }, rng) {
    const style = rng.int(4);
    const stopAt = 1 + rng.int(CASES - 2);
    const threshold = 0.5 + rng.next() * 1.5;
    return playRound(board, (n) => rng.int(n), (k, offer) => {
      if (style === 0) return false;
      if (style === 1) return k >= stopAt;
      if (style === 2) return offer > 1;
      return offer >= threshold;
    });
  },
});
