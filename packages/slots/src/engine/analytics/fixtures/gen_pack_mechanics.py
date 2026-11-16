"""Record the engine pack's exact analytics of the mechanic families the TypeScript closed forms
cover (analytics/mechanics.ts), for mechanics.test.ts.

Run from the pack (never edits it):

    cd /Users/petercyli-wsd/Dev/slot-math-engine-pack && PYTHONPATH=src .venv/bin/python \
        /Users/petercyli-wsd/Dev/original-games-review/packages/slots/src/engine/analytics/fixtures/gen_pack_mechanics.py

Writes ``pack-mechanics.json`` next to this file, one case per spec:

* every admitted pack example on ``global_mixture`` whose evaluator is payline / ways /
  scatter_pays and whose mechanic families are a non-empty subset of FAMILIES;
* the batch games' base and feature specs (copied in, so the test does not depend on games/).

Each case: the spec and ``enginepack.base.analytics`` (rtp, tier, tier_reasons, trigger_p, the
main evaluator EV and the scatter EV, in coins).
"""
from __future__ import annotations

import json
from pathlib import Path

from enginepack import base

OUT = Path(__file__).with_name("pack-mechanics.json")
FAMILIES = {"global_iid", "walking_wild", "expanding_wild", "mystery_reveal", "global_additive"}
KINDS = {"payline", "ways", "scatter_pays"}
GAMES = Path(__file__).resolve().parents[6] / "games"
BATCH = ["hi-score", "noodle-cart", "unfold", "grand-finale"]


def main_ev(ana: dict) -> float:
    for k in ("line_ev_coins", "ways_ev_coins", "count_pay_ev_coins"):
        if k in ana:
            return ana[k]
    return 0.0


def record(name: str, context: str, families: list, spec: dict, source: str) -> dict:
    ana = base.analytics(base.build(spec))
    return {"name": name, "source": source, "context": context, "families": families,
            "tier": ana["tier"], "tier_reasons": ana.get("tier_reasons", []),
            "rtp": ana["rtp"], "trigger_p": ana.get("trigger_p", 0.0),
            "main_ev_coins": main_ev(ana), "scatter_ev_coins": ana.get("scatter_ev_coins", 0.0),
            "spec": spec}


def main() -> None:
    cases = []
    for e in base.examples():
        kind, axis = e["context"].split("|")
        fams = list(e["families"])
        if axis != "global_mixture" or kind not in KINDS or not fams or not set(fams) <= FAMILIES:
            continue
        cases.append(record(e["panel"], e["context"], fams, base.example(e["panel"]),
                            "enginepack.base.example"))
    for game in BATCH:
        for f in ("slot.spec.json", "feature.spec.json"):
            path = GAMES / game / "src" / f
            if not path.exists():
                continue
            spec = json.loads(path.read_text(encoding="utf-8"))
            fams = [m["id"] for m in spec.get("mechanics", [])]
            ctx = f"{spec['evaluation']['kind']}|global_mixture"
            cases.append(record(f"{game}/{f}", ctx, fams, spec, f"games/{game}/src/{f}"))
    doc = {"generator": "gen_pack_mechanics.py", "pack": "slot-math-engine-pack v1.0.0",
           "families": sorted(FAMILIES), "cases": cases}
    OUT.write_text(json.dumps(doc, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {OUT}: {len(cases)} cases")
    for c in cases:
        print(f"  {c['name']:55s} {c['tier']:14s} rtp={c['rtp']:.12f} trigger_p={c['trigger_p']:.12g}")


if __name__ == "__main__":
    main()
