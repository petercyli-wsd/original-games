"""Record the engine pack's analytics and seeded spins for the TypeScript analytics tests.

Run from the pack (never edits it):

    cd /Users/petercyli-wsd/Dev/slot-math-engine-pack && PYTHONPATH=src .venv/bin/python \
        /Users/petercyli-wsd/Dev/original-games-review/packages/slots/src/engine/analytics/fixtures/gen_pack_fixture.py

Writes ``pack-analytics.json`` next to this file:

* ``exact``: every admitted example game whose context is payline / ways / scatter_pays on
  ``global_mixture`` with no mechanics -- its spec, ``enginepack.base.analytics`` (rtp, tier,
  trigger_p, main / scatter EV) and 300 seeded spins (stops, board, total coins, scatter count);
* ``mc``: the no-mechanic or tumble-only examples the pack labels ``mc`` in those evaluators and
  cluster -- spec, rtp, rtp_se, n_mc -- for the Monte-Carlo cross-check once ``canonicalSpin``
  exists.
"""
from __future__ import annotations

import json
from pathlib import Path

from enginepack import base

OUT = Path(__file__).with_name("pack-analytics.json")
EXACT_KINDS = {"payline", "ways", "scatter_pays"}
N_SPINS = 300


def main_ev(ana: dict) -> float:
    for k in ("line_ev_coins", "ways_ev_coins", "count_pay_ev_coins"):
        if k in ana:
            return ana[k]
    return 0.0


def spins(eng, n: int) -> list:
    out = []
    for seed in range(1, n + 1):
        js = json.loads(base.spin_json(eng, seed))
        board = js["steps"][0]["board"]
        out.append({"seed": seed, "set": js["set"], "stops": js["stops"], "board": board,
                    "totalCoins": js["totalCoins"]})
    return out


def main() -> None:
    exact, mc = [], []
    for e in base.examples():
        kind, axis = e["context"].split("|")
        if axis != "global_mixture":
            continue
        spec = base.example(e["panel"])
        eng = base.build(spec)
        ana = base.analytics(eng)
        if not e["families"] and kind in EXACT_KINDS and ana["tier"] in ("exact", "exact_mixture"):
            exact.append({
                "panel": e["panel"], "context": e["context"], "variant": e["variant"],
                "tier": ana["tier"], "rtp": ana["rtp"], "trigger_p": ana.get("trigger_p", 0.0),
                "main_ev_coins": main_ev(ana), "scatter_ev_coins": ana.get("scatter_ev_coins", 0.0),
                "spec": spec, "spins": spins(eng, N_SPINS),
            })
        elif ana["tier"] == "mc" and set(e["families"]) <= {"tape_continuation_refill"} \
                and kind in EXACT_KINDS | {"cluster"}:
            mc.append({
                "panel": e["panel"], "context": e["context"], "families": e["families"],
                "tier": "mc", "rtp": ana["rtp"], "rtp_se": ana["rtp_se"], "n_mc": ana["n_mc"],
                "trigger_p": ana.get("trigger_p"), "spec": spec,
            })
    doc = {"generator": "gen_pack_fixture.py", "pack": "slot-math-engine-pack v1.0.0",
           "exact": exact, "mc": mc}
    OUT.write_text(json.dumps(doc, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {OUT}: {len(exact)} exact examples, {len(mc)} mc examples")


if __name__ == "__main__":
    main()
