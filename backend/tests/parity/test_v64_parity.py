import pytest

from momento import v64 as V
from tests.parity.harness import diff, rounds_of, tape, ts_call

TOP = """<app-top-tab-switcher><div class="top-tab-switcher__tab top-tab-switcher__tab--active" >Rounds</div>
<div class="top-tab-switcher__tab top-tab-switcher__tab--active">Day</div>
<!---->26.09.26 07:04</div><div class="x">714.95x 25.09.26 23:59 1 204.10x 01.10.26 00:01 3.5x"""


@pytest.mark.parametrize("n,seed", [(2600, 41), (300, 42)])
def test_v64_matches_archive(n, seed):
    t = tape(n, seed, step_ms=9000)
    # inject a few session gaps
    for i in range(400, len(t)):
        t[i]["tsMs"] += 600_000 * (i // 400)
    for r in t:
        from tests.parity.harness import _iso
        r["ts"] = _iso(r["tsMs"])
    rs = rounds_of(t)
    cad = V.fit_cadence(rs)
    tgt = {"lo": 2, "hi": 1e9, "label": "2x+"}
    dna_opts = {"alphabet": "band", "kMin": 2, "kMax": 4, "target": tgt, "minSupport": 20}
    dna = V.dna_scan(rs, dna_opts)
    anchors = [{"tsMs": t[min(400, n - 1)]["tsMs"] - 200_000, "multiplier": 55.5}]
    recon = {"minGapSec": 120, "maxGapHours": 6, "maxFillPerGap": 40, "seed": 9}
    calib = {"state": "Shelf", "expected": 1.9, "range_lo": 1.2, "range_hi": 3.1, "confidence": 0.4, "verdict": "hit", "reason": "x", "comp_loss": '{"a":0.5}', "weights": '{"a":1}'}
    cases = [
        ("parseTopRounds", [TOP], V.parse_top_rounds(TOP)),
        ("parseTopRounds", ["26.09.26 07:04 714.95x\n27.09.26 08:00 2.00x", 60], V.parse_top_rounds("26.09.26 07:04 714.95x\n27.09.26 08:00 2.00x", 60)),
        ("rangeFromQuery", [{"$params": "from=2026-01-01T00:00:00Z&to=1780000000&minX=2&lastN=abc"}],
         V.range_from_query({"from": "2026-01-01T00:00:00Z", "to": "1780000000", "minX": "2", "lastN": "abc"})),
        ("applyRange", [{"$tape": "t"}, {"minX": 2, "lastN": 50}], V.apply_range(rs, {"minX": 2, "lastN": 50})),
        ("fitCadence", [{"$tape": "t"}], cad),
        ("planReconstruction", [{"$tape": "t"}, anchors, {"$const": None}, recon], V.plan_reconstruction(rs, anchors, lambda _t: None, recon)),
        ("planReconstruction", [{"$tape": "t"}, anchors, {"$const": 20}, recon], V.plan_reconstruction(rs, anchors, lambda _t: 20, recon)),
        ("spreadSpan", [[1.5, 2.2, 10, 1.01], 1000, 61000, cad], V.spread_span([1.5, 2.2, 10, 1.01], 1000, 61000, cad)),
        ("encode", [{"$tape": "t"}, "tempo", 2, cad], V.encode(rs, "tempo", 2, cad)),
        ("dnaScan", [{"$tape": "t"}, dna_opts], dna),
        ("dnaScan", [{"$tape": "t"}, {**dna_opts, "alphabet": "binary", "kMin": 1, "kMax": 6, "pivot": 3, "limit": 10}],
         V.dna_scan(rs, {**dna_opts, "alphabet": "binary", "kMin": 1, "kMax": 6, "pivot": 3, "limit": 10})),
        ("dnaOverlay", [{"$tape": "t"}, {"alphabet": "band", "kRange": [2, 4], "baseRate": dna["baseRate"], "table": dna["table"]}],
         V.dna_overlay(rs, {"alphabet": "band", "kRange": [2, 4], "baseRate": dna["baseRate"], "table": dna["table"]})),
        ("linguisticsV2", [{"$tape": "t"}], V.linguistics_v2(rs)),
        ("linguisticsV2", [{"$tape": "t"}, 50, cad], V.linguistics_v2(rs, 50, cad)),
        ("discoverPhrases", [{"$tape": "t"}], V.discover_phrases(rs)),
        ("investigateRound", [{"$tape": "t"}, 150, calib, cad], V.investigate_round(rs, 150, calib, cad)),
        ("investigateRound", [{"$tape": "t"}, 3, None, cad], V.investigate_round(rs, 3, None, cad)),
        ("investigateRange", [{"$tape": "t"}, {"$tape": "s"}], V.investigate_range(rs, rs[100:180])),
        ("projectShape", [{"$tape": "t"}, {"window": 30, "horizon": 20, "k": 40, "cadence": cad}], V.project_shape(rs, {"window": 30, "horizon": 20, "k": 40, "cadence": cad})),
        ("nameShape", [[0, 1, 0.5, 2, 1.5, 3]], V.name_shape([0, 1, 0.5, 2, 1.5, 3])),
    ]
    want = ts_call("v64", [{"fn": f, "args": a} for f, a, _ in cases], {"t": t, "s": t[100:180]})
    bad = [f"{f}#{i}: {d[:4]}" for i, ((f, _, g), w) in enumerate(zip(cases, want)) if (d := diff(g, w, 1e-9))]
    assert not bad, "\n".join(bad)
