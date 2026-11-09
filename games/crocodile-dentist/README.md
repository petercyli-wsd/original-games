# Croc Dentist (vs House)

An "Originals"-style casino game prototype based on Crocodile Dentist. You and the House take turns pressing teeth, and whoever gets bitten loses. For the classic one-player version, see [Croc Dentist (Solo)](../croc-dentist-solo/README.md).

## Rules

Take turns pressing teeth with the House. Press the bad tooth and you lose; if the House presses it, you win. Cash out between rounds.

- The croc has a fixed **20 teeth**, and **k** of them are hidden bad teeth. k is the one setting (1, 2, 4, 7, 12 or 19).
- Each round, you press a tooth, then the House presses one.
  - **You get bitten:** you lose your bet.
  - **The House gets bitten:** you win 1.5× the round's card value (shown as "House bitten pays" next to the House).
  - **Both safe:** your cash-out moves to the next round card. This is a checkpoint, so you can **cash out** or press on.
- If every good tooth is used up, the game cashes out for you automatically.

## Why this design (and not just "whoever gets bitten")

With one bad tooth and alternating presses, the plain toy is a coin flip decided by where the bad tooth falls, and a fixed prize would make the cash-out meaningless. So each checkpoint is worth more than the last, and every round has two beats:

1. **Your press:** fear. There's a k/n chance you get bitten.
2. **The House's press:** hope. There's a k/(n−1) chance it gets bitten and you win 1.5× the card.

The cash-out value is set so that cashing out at any checkpoint is worth exactly the RTP. No strategy beats any other:

```
cash = P(House bitten)·1.5·next + P(both safe)·next
```

The odds are drawn twice under the jaw: the **bite bar** (one block per tooth left, bad ones red) and the **win bar** (your exact chance of not being bitten if you play to the end, updated after every press).

| Bad teeth | Chance to win | Top prize |
|---|---|---|
| 1 | 50% | 3.27× |
| 4 | 44.6% | 15.91× |
| 12 | 29.0% | 85.61× |
| 19 | 5% | 19.80× |

The eval's std-dev runs from about 0.8 (1 bad tooth) to 4.3 (19 bad teeth). The chance to win spans 10:1; with you pressing first, it can't drop below 1/20 on a 20-tooth jaw.

The game also works with no theme: it's a ring of N cells with k hidden mines, and two players take turns removing cells.

## Customising the mock-up

- **Customise** (bottom of the bet panel) shows the settings and **Copy config JSON** copies them out. The colours and pace follow the shared style (`docs/STYLE.md`) and are no longer settings. The maths (RTP, jaw size, bad-teeth options) is fixed in `src/config.ts` and can't be changed from the drawer: an editable RTP let a player set their own return to 100%.
- The croc is a single SVG in `src/components/Croc.tsx`.
- The payout maths is in `src/math.ts`, and the game flow is a reducer in `src/game.ts`.

## Develop

This game is a workspace in the Originals platform (see the root README).

```bash
npm run dev                                    # from the repo root: platform at /play/crocodile-dentist
npm run dev -w @originals/crocodile-dentist    # this game on its own, with a demo wallet
npm test                                       # exact RTP and martingale checks + Monte Carlo through the reducer
npm run eval -- --game crocodile-dentist       # platform eval across four volatility levels
```

Balance, RNG and the global Turbo setting come from the platform host (`useHost()`), and colours are scoped to the game's shadow root.
