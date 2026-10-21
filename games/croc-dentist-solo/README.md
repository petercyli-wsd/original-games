# Croc Dentist (Solo)

The classic one-player Crocodile Dentist. Press teeth one at a time, and each safe tooth raises your multiplier. Cash out after any press, or keep going until the croc bites.

For the two-player version, see [Croc Dentist (vs House)](../crocodile-dentist/README.md).

## Maths

With N teeth and k bad ones, the chance of surviving j presses is C(N−k, j) / C(N, j). The cash-out multiplier after j safe presses is RTP divided by that chance, so every cash-out point is worth exactly the RTP. This is the Mines mechanic, laid out around a mouth instead of on a grid.

| Board | First safe press | All good teeth pressed |
|---|---|---|
| 20 teeth, 1 bad | 1.04× | 19.8× |
| 12 teeth, 1 bad (default) | 1.08× | 11.88× |
| 10 teeth, 3 bad | 1.41× | 118.8× |
| 20 teeth, 5 bad | 1.32× | 15,349× |

## Develop

```bash
npm run dev                                    # from the repo root: platform at /play/croc-dentist-solo
npm run dev -w @originals/croc-dentist-solo    # this game on its own
npm test                                       # exact RTP per cash-out point + Monte Carlo through the reducer
npm run eval -- --game croc-dentist-solo
```

The croc SVG, the tooltips, the colours and the layout CSS come from the vs House game's package (`@originals/crocodile-dentist/croc`, `/tip`, `/config` and `/styles.css`). Changes to the croc there show up in both games.
