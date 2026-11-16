"""Slot oracle: build a slot spec through the engine pack and record what the pack says about it.

Run through ``scripts/slots/oracle.mjs`` (``npm run slots:oracle -- ...``), which uses the pack's own
venv python. The pack is never edited; every spec goes through ``enginepack.base.build``, and a
refusal exits non-zero with the pack's reason (docs/SLOTS.md §2.4).

Modes:
  --game <id>                     games/<id>/src/slot.spec.json (+ feature*.spec.json) -> games/<id>/src/oracle.json
  <id>                            same as --game <id>
  --example <name> --out <file>   one pack example game -> a parity fixture (spec embedded)
  --exemplar <name> --out <file>  one pack family exemplar (src/gamespec/exemplars/<name>.json) -> a fixture
  --spec <file> --out <file>      any game_spec_v2 file -> a fixture (built through the pack like a game)
  --all-examples --out-dir <dir>  every pack example game -> <dir>/<name>.json (refusals listed, not fatal)

Options:
  --seeds N          seeds 0..N-1 (default 2000)
  --no-analytics     skip base.analytics (faster; fixtures for parity only)
  --full-seeds N     keep full spins for seeds 0..N-1 only; spinHashes still pin every seed
  --only a,b,c       with --all-examples: only these example names

Every spec is normalised to sorted keys before it is built (a JSON round trip with sort_keys), so
the pack iterates every spec map (paytables, pmfs) in sorted-key order, which is the order the
TypeScript port uses (JS objects reorder integer-like keys, so file order cannot be relied on).

Output entry (one per spec): pack version, spec content hash (sha256 of the canonical spec JSON),
slug, context, families, scope level, analytics (rtp, tier, se, n, trigger_p and the rest, as the
pack returns them), the decor schema, and the canonical spins for each seed (parsed JSON).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from pathlib import Path

PACK = Path(os.environ.get("SLOT_ENGINE_PACK", "/Users/petercyli-wsd/Dev/slot-math-engine-pack"))
sys.path.insert(0, str(PACK / "src"))

REPO = Path(__file__).resolve().parents[2]
SCHEMA = "slot_oracle_v1"


def _pack():
    from enginepack import base, scope  # noqa: F401  (imported here so a bad pack path fails clearly)
    return base


def pack_version() -> str:
    try:
        return (PACK / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return "unknown"


def spec_hash(spec: dict) -> str:
    """sha256 of the canonical spec JSON (sorted keys, compact separators, ASCII)."""
    blob = json.dumps(spec, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(blob).hexdigest()


def _clean(obj):
    """JSON-safe: NaN / inf -> None, tuples -> lists, sets -> sorted lists, other objects -> str."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {str(k): _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, (set, frozenset)):
        return sorted((_clean(v) for v in obj), key=str)
    if obj is None or isinstance(obj, (bool, int, str)):
        return obj
    return str(obj)


class Refused(Exception):
    pass


def normalise(spec: dict) -> dict:
    """The spec with every map in sorted-key order (what the TypeScript port iterates)."""
    return json.loads(json.dumps(spec, sort_keys=True))


def oracle_entry(spec: dict, *, seeds: int, with_analytics: bool, slug: str,
                 full_seeds: int | None = None) -> dict:
    base = _pack()
    spec = normalise(spec)
    from enginepack.scope import ScopeError
    from reelengine.decor import decor_schema_for
    try:
        eng = base.build(spec, slug=slug)
    except (ScopeError, ValueError, KeyError, TypeError) as exc:
        raise Refused(f"{type(exc).__name__}: {exc}") from exc
    sc = getattr(eng, "enginepack_scope", None) or {}
    entry = {
        "packVersion": pack_version(),
        "specHash": spec_hash(spec),
        "slug": spec.get("slug"),
        "context": sc.get("context"),
        "families": sorted(sc.get("families") or []),
        "level": sc.get("level"),
        "decorSchema": decor_schema_for(eng),
    }
    if with_analytics:
        entry["analytics"] = _clean(base.analytics(eng))
    raw = [base.spin_json(eng, s) for s in range(seeds)]
    entry["seeds"] = seeds
    # sha256 of each seed's canonical spin bytes (first 16 hex): lets a trimmed fixture still pin
    # every seed (the TypeScript canonical serialiser reproduces the bytes)
    entry["spinHashes"] = [hashlib.sha256(b).hexdigest()[:16] for b in raw]
    keep = seeds if full_seeds is None else min(full_seeds, seeds)
    entry["fullSeeds"] = keep
    entry["spins"] = [json.loads(b) for b in raw[:keep]]
    return entry


def _write(path: Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=True, allow_nan=False) + "\n",
                    encoding="utf-8")


def run_game(game_id: str, seeds: int, with_analytics: bool) -> int:
    src = REPO / "games" / game_id / "src"
    spec_path = src / "slot.spec.json"
    if not spec_path.is_file():
        print(f"oracle: {spec_path} not found", file=sys.stderr)
        return 2
    doc = {"schema": SCHEMA, "packVersion": pack_version(), "game": game_id}
    try:
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
        doc["base"] = {"file": "slot.spec.json",
                       **oracle_entry(spec, seeds=seeds, with_analytics=with_analytics, slug=game_id)}
        feats = {}
        for fp in sorted(src.glob("feature*.spec.json")):
            name = fp.name[: -len(".spec.json")]
            fspec = json.loads(fp.read_text(encoding="utf-8"))
            feats[name] = {"file": fp.name,
                           **oracle_entry(fspec, seeds=seeds, with_analytics=with_analytics,
                                          slug=f"{game_id}-{name}")}
        doc["features"] = feats
    except Refused as exc:
        print(f"oracle: the engine pack refused {game_id}: {exc}", file=sys.stderr)
        return 1
    out = src / "oracle.json"
    _write(out, doc)
    b = doc["base"]
    ana = b.get("analytics") or {}
    print(f"oracle: wrote {out.relative_to(REPO)} (base {b['context']} {b['families']}, "
          f"rtp {ana.get('rtp')} {ana.get('tier')}; features: {sorted(doc['features']) or 'none'})")
    return 0


def run_example(name: str, out: Path, seeds: int, with_analytics: bool,
                full_seeds: int | None = None) -> int:
    base = _pack()
    try:
        spec = base.example(name)
    except KeyError as exc:
        print(f"oracle: {exc}", file=sys.stderr)
        return 2
    meta = next(e for e in base.examples() if e["panel"] in (name, f"panel-{name}"))
    try:
        entry = oracle_entry(spec, seeds=seeds, with_analytics=with_analytics,
                             slug=meta["panel"], full_seeds=full_seeds)
    except Refused as exc:
        print(f"oracle: the engine pack refused example {name}: {exc}", file=sys.stderr)
        return 1
    short = meta["panel"][len("panel-"):] if meta["panel"].startswith("panel-") else meta["panel"]
    doc = {"schema": SCHEMA, "example": short, "title": meta.get("title"),
           "exampleTier": meta.get("tier"), "variant": meta.get("variant"),
           "spec": normalise(spec), **entry}
    _write(out, doc)
    print(f"oracle: wrote {out} ({short}: {entry['context']} {entry['families']}, {seeds} seeds)")
    return 0


def run_exemplar(name: str, out: Path, seeds: int, with_analytics: bool,
                 full_seeds: int | None = None) -> int:
    path = PACK / "src" / "gamespec" / "exemplars" / f"{name}.json"
    if not path.is_file():
        print(f"oracle: no exemplar {path}", file=sys.stderr)
        return 2
    spec = normalise(json.loads(path.read_text(encoding="utf-8")))
    try:
        entry = oracle_entry(spec, seeds=seeds, with_analytics=with_analytics, slug=name,
                             full_seeds=full_seeds)
    except Refused as exc:
        print(f"oracle: the engine pack refused exemplar {name}: {exc}", file=sys.stderr)
        return 1
    doc = {"schema": SCHEMA, "exemplar": name, "spec": spec, **entry}
    _write(out, doc)
    print(f"oracle: wrote {out} (exemplar {name}: {entry['context']} {entry['families']}, {seeds} seeds)")
    return 0


def run_spec(path: Path, out: Path, seeds: int, with_analytics: bool,
             full_seeds: int | None = None) -> int:
    spec = normalise(json.loads(path.read_text(encoding="utf-8")))
    name = path.name[: -len(".json")] if path.name.endswith(".json") else path.name
    try:
        entry = oracle_entry(spec, seeds=seeds, with_analytics=with_analytics, slug=name,
                             full_seeds=full_seeds)
    except Refused as exc:
        print(f"oracle: the engine pack refused {path}: {exc}", file=sys.stderr)
        return 1
    doc = {"schema": SCHEMA, "specFile": path.name, "spec": spec, **entry}
    _write(out, doc)
    print(f"oracle: wrote {out} ({path.name}: {entry['context']} {entry['families']}, {seeds} seeds)")
    return 0


def run_all(out_dir: Path, seeds: int, with_analytics: bool, only: set[str] | None,
            full_seeds: int | None = None) -> int:
    base = _pack()
    bad = 0
    for e in base.examples():
        short = e["panel"][len("panel-"):]
        if only and short not in only:
            continue
        rc = run_example(short, out_dir / f"{short}.json", seeds, with_analytics, full_seeds)
        bad += rc != 0
    return 1 if bad else 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="slots:oracle", description=__doc__.split("\n\n")[0])
    ap.add_argument("game_pos", nargs="?", help="game id (same as --game)")
    ap.add_argument("--game")
    ap.add_argument("--example")
    ap.add_argument("--exemplar")
    ap.add_argument("--spec")
    ap.add_argument("--out")
    ap.add_argument("--all-examples", action="store_true")
    ap.add_argument("--out-dir")
    ap.add_argument("--only")
    ap.add_argument("--seeds", type=int, default=2000)
    ap.add_argument("--no-analytics", action="store_true")
    ap.add_argument("--full-seeds", type=int, default=None,
                    help="keep full spins for seeds 0..N-1 only (every seed keeps its hash)")
    a = ap.parse_args(argv)
    with_ana = not a.no_analytics
    if a.example:
        if not a.out:
            ap.error("--example needs --out <file>")
        return run_example(a.example, Path(a.out), a.seeds, with_ana, a.full_seeds)
    if a.spec:
        if not a.out:
            ap.error("--spec needs --out <file>")
        return run_spec(Path(a.spec), Path(a.out), a.seeds, with_ana, a.full_seeds)
    if a.exemplar:
        if not a.out:
            ap.error("--exemplar needs --out <file>")
        return run_exemplar(a.exemplar, Path(a.out), a.seeds, with_ana, a.full_seeds)
    if a.all_examples:
        if not a.out_dir:
            ap.error("--all-examples needs --out-dir <dir>")
        only = set(a.only.split(",")) if a.only else None
        return run_all(Path(a.out_dir), a.seeds, with_ana, only, a.full_seeds)
    gid = a.game or a.game_pos
    if not gid:
        ap.error("give --game <id>, --example <name> --out <file>, or --all-examples --out-dir <dir>")
    return run_game(gid, a.seeds, with_ana)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
