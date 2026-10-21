# Croc Dentist

An "Originals"-style casino game prototype based on Crocodile Dentist. You and the House take turns pressing teeth, and whoever gets bitten loses.

## Rules

- There are **N teeth**, and **k** of them are hidden bad teeth.
- Each round, you press a tooth, then the House presses one.
  - **You get bitten:** you lose your bet.
  - **The House gets bitten:** you win the round's *bite* multiplier.
  - **Both safe:** your cash-out value climbs. This is a checkpoint, so you can **cash out** or press on.
- If every good tooth is used up, the game cashes out for you automatically.

## Why this design (and not just "whoever gets bitten")

With one bad tooth and alternating presses, the plain toy is a coin flip decided by where the bad tooth falls. Worse, if you pay a fixed prize to the winner, your chance of winning stays the same every round. A cash-out button would then be meaningless, because nothing changes between checkpoints.

The fix is to make each checkpoint worth more than the last, so that every round has two beats:

1. **Your press:** fear. There's a k/n chance you get bitten.
2. **The House's press:** hope. There's a k/(n−1) chance it gets bitten and you win.

The cash-out value is set so that cashing out at any checkpoint is worth exactly the RTP. No strategy beats any other:

```
cash = P(House bitten)·bite + P(both safe)·next,   bite = J·next
```

Players can change volatility with three controls:

| Control | Effect |
|---|---|
| **Teeth** (8–20) | More teeth means longer games, smaller steps, and a higher top multiplier. |
| **Bad teeth** (1–5) | More bad teeth means shorter, swingier games with bigger multipliers. |
| **Bite Bonus J** (1–2×) | Moves value between the cash-out ladder (J=1) and the payout when the House is bitten. At J=2 with one bad tooth, the cash-out value stays flat and it's a pure 50/50 duel paying 1.98×, which is the original toy. |

The game also works with no theme: it's a ring of N cells with k hidden mines, and two players take turns removing cells.

## Customising the mock-up

- **⚙ Customise** (bottom of the bet panel) lets you edit the RTP, the teeth and bad-teeth options, the Bite Bonus range, the House's thinking time and every colour, live. Your settings save to your browser. **Copy config JSON** copies them out, and you can paste the result into `src/config.ts` to make it the default.
- The croc is a single SVG in `src/components/Croc.tsx`.
- The payout maths is in `src/math.ts`, and the game flow is a reducer in `src/game.ts`.

## Develop

This game is a workspace in the Originals platform (see the root README).

```bash
npm run dev                                    # from the repo root: platform at /play/crocodile-dentist
npm run dev -w @originals/crocodile-dentist    # this game on its own, with a demo wallet
npm test                                       # exact RTP check across 75 configs + Monte Carlo through the reducer
npm run eval -- --game crocodile-dentist       # platform eval across six boards
```

Balance, RNG and the global Turbo setting come from the platform host (`useHost()`), and colours are scoped to the game's shadow root.
