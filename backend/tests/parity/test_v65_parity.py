import math

import pytest

from momento import v65 as V
from tests.parity.harness import _iso, diff, rounds_of, tape, ts_call


def _strip(o):
    if isinstance(o, dict):
        return {k: _strip(v) for k, v in o.items() if k not in ("generatedAt", "elapsedMs")}
    if isinstance(o, list):
        return [_strip(v) for v in o]
    if isinstance(o, (bytes, bytearray)):
        return list(o)
    return o


def _mk(n, seed):
    t = tape(n, seed, step_ms=9000)
    for i in range(len(t)):
        t[i]["tsMs"] += 900_000 * (i // 500) + (37_000 if i % 97 == 0 else 0) * (i // 97)
        t[i]["ts"] = _iso(t[i]["tsMs"])
        if i % 311 == 5:
            t[i]["origin"] = "reconstructed"
        if i >= n - 300:
            t[i]["sessionId"] = None
    return t


@pytest.mark.parametrize("n,seed", [(4000, 51), (240, 52)])
def test_v65_matches_archive(n, seed):
    t = _mk(n, seed)
    rs = rounds_of(t)
    ms = [r.multiplier for r in rs]
    t2 = _mk(max(120, n // 2), seed + 7)
    rs2 = rounds_of(t2)
    import random
    rr = random.Random(seed)
    dists = []
    for _ in range(150):
        w = [rr.random() + 0.05 for _ in range(6)]
        s = sum(w)
        dists.append([x / s for x in w])
    items = [{"dist": d, "actual": ms[i], "lo": 1.3, "hi": 2.6} for i, d in enumerate(dists)]
    prob_rows = [{"p": d[2] + d[3] + d[4] + d[5], "y": 1 if ms[i] >= 2 else 0} for i, d in enumerate(dists)]
    keys = ["a", "b", "c"]
    ledger = []
    for i in range(140):
        cl = {k: 0.5 + rr.random() for k in keys}
        if i % 9 == 0:
            del cl["c"]
        ledger.append({"weights": {k: 0.2 + rr.random() for k in keys}, "compLoss": cl, "mixLoss": 1.1, "baseLoss": 1.2,
                       **({"state": ["Shelf", "Climb", "Drift"][i % 3]} if i % 7 else {})})
    fa = {"id": 1, "created_ms": 1780000000000, "state": "Shelf", "expected": 1.9, "range_lo": 1.2, "range_hi": 3.1, "reach": 0.4, "dist": dists[0],
          "comp": [{"key": "a", "weight": 0.5, "dist": dists[1]}, {"key": "b", "weight": 0.5, "dist": dists[2]}]}
    fb = {"id": 2, "created_ms": 1780000100000, "state": "Climb", "expected": 2.3, "range_lo": 1.3, "range_hi": 3.9, "reach": 0.5, "dist": dists[3],
          "comp": [{"key": "b", "weight": 0.7, "dist": dists[4]}, {"key": "c", "weight": 0.3, "dist": dists[5]}]}
    exp = {"name": "x", "hypothesis": "x", "condition": {"kind": "streak_below", "x": 2, "k": 3}, "target": {"x": 2, "h": 1}}
    exp2 = {"name": "y", "hypothesis": "y", "condition": {"kind": "sequence", "pattern": "lm"}, "target": {"x": 5, "h": 3}, "split": 0.5}
    strat = {"cashout": 2, "stakeMode": "flat", "stake": 1, "roundsPerSession": 30, "takeProfit": 5}
    strat2 = {"cashout": 1.5, "stakeMode": "fraction", "stake": 0.05, "roundsPerSession": 20, "stopLoss": 10}
    hyps = ["after 3 rounds below 2x, does the next round reach 2x?", "Is a 10x overdue after a long gap within 5", "pattern LLM then 5x next 3",
            "after a big 10x round above", "2 in a row above 3x hot streak", "random words"]
    specs = [{"family": f, "params": p} for f, p in [("window", {"window": 300}), ("ewma", {"halfLife": 50}), ("markov1", {"alpha": 2, "window": 800}),
                                                      ("streak", {"x": 2, "window": 900}), ("conditional", {"x": 2, "k": 2, "window": 900}), ("bogus", {})]]
    vin = {"server": "abc123", "client": "seedc", "nonce": 7, "observed": 1.23}
    cases = [
        ("integrityReport", [{"$tape": "t"}], lambda: V.integrity_report(rs)),
        ("integrityReport", [{"$tape": "t"}, {"low": 1.1, "fairMatch": {"aviator#1": 0.9}, "agreement": {"aviator#2": 0.8}}],
         lambda: V.integrity_report(rs, {"low": 1.1, "fairMatch": {"aviator#1": 0.9}, "agreement": {"aviator#2": 0.8}})),
        ("isVoidWindow", [{"$tape": "t"}, 0, 200, 9000], lambda: V.is_void_window(rs, 0, 200, 9000)),
        ("signalSignificance", [{"$tape": "t"}], lambda: V.signal_significance(rs)),
        ("signalSignificance", [{"$tape": "t"}, {"T": 5, "window": 1000}], lambda: V.signal_significance(rs, {"T": 5, "window": 1000})),
        ("shuffledSignificance", [{"$tape": "t"}], lambda: V.shuffled_significance(rs)),
        ("kmCurve", [[1, 2, 2, 5, 9, 0, 3], 12], lambda: V.km_curve([1, 2, 2, 5, 9, 0, 3], 12)),
        ("etaBoard", [{"$tape": "t"}], lambda: V.eta_board(rs)),
        ("etaBoard", [{"$tape": "t"}, {"cadenceMs": 8000, "thresholds": [1.5, 3, 7]}], lambda: V.eta_board(rs, {"cadenceMs": 8000, "thresholds": [1.5, 3, 7]})),
        ("hazardTimeline", [{"$tape": "t"}], lambda: V.hazard_timeline(rs)),
        ("hazardTimeline", [{"$tape": "t"}, 2, 40], lambda: V.hazard_timeline(rs, 2, 40)),
        ("inRoundEta", [{"$tape": "t"}, 1.7], lambda: V.in_round_eta(rs, 1.7)),
        ("reliability", [prob_rows], lambda: V.reliability(prob_rows)),
        ("pitHistogram", [items], lambda: V.pit_histogram(items)),
        ("coverageACI", [items], lambda: V.coverage_aci(items)),
        ("counterfactual", [ledger, "b"], lambda: V.counterfactual(ledger, "b")),
        ("earnGeneric", [keys, {"a": 0.9, "b": 1.1}, 40, {"c": 2}], lambda: V.earn_generic(keys, {"a": 0.9, "b": 1.1}, 40, {"c": 2})),
        ("regimeWeights", [ledger], lambda: V.regime_weights(ledger)),
        ("forecastDiff", [fa, fb], lambda: V.forecast_diff(fa, fb)),
        ("tokenString", [ms[:50]], lambda: V.token_string(ms[:50])),
        ("sequenceSearch", [{"$tape": "t"}, "lm"], lambda: V.sequence_search(rs, "lm")),
        ("sequenceSearch", [{"$tape": "t"}, "LLH", 3, 5], lambda: V.sequence_search(rs, "LLH", 3, 5)),
        ("sequenceSearch", [{"$tape": "t"}, "??"], lambda: V.sequence_search(rs, "??")),
        ("conditionMask", [ms[:300], {"kind": "gap_since", "x": 3, "k": 4}], lambda: V.condition_mask(ms[:300], {"kind": "gap_since", "x": 3, "k": 4})),
        ("runExperiment", [exp, {"$tape": "t"}, {"shuffles": 8, "plants": 6}], lambda: V.run_experiment(exp, rs, {"shuffles": 8, "plants": 6})),
        ("runExperiment", [exp2, {"$tape": "t"}, {"shuffles": 5, "plants": 4}], lambda: V.run_experiment(exp2, rs, {"shuffles": 5, "plants": 4})),
        *[("parseHypothesis", [h], (lambda h=h: V.parse_hypothesis(h))) for h in hyps],
        ("kellyTells", [{"$tape": "t"}], lambda: V.kelly_tells(rs)),
        ("kellyTells", [{"$tape": "t"}, {"kappa": 0.5, "minN": 10000, "targets": [1.01, 1.1]}], lambda: V.kelly_tells(rs, {"kappa": 0.5, "minN": 10000, "targets": [1.01, 1.1]})),
        ("simulateBankroll", [{"$tape": "t"}, strat, {"paths": 60, "sessions": 5}], lambda: V.simulate_bankroll(rs, strat, {"paths": 60, "sessions": 5})),
        ("simulateBankroll", [{"$tape": "t"}, strat2, {"paths": 40}], lambda: V.simulate_bankroll(rs, strat2, {"paths": 40})),
        ("verifyAll", [vin], lambda: V.verify_all(vin)),
        ("solveConvention", [[vin, {"server": "zz", "clients": ["a", "b"]}]], lambda: V.solve_convention([vin, {"server": "zz", "clients": ["a", "b"]}])),
        ("verifySeedChain", ["s", V.sha256_hex(V.sha256_hex("s")), 5], lambda: V.verify_seed_chain("s", V.sha256_hex(V.sha256_hex("s")), 5)),
        ("fairnessBattery", [{"$tape": "t"}], lambda: V.fairness_battery(rs)),
        ("cusumFingerprint", [{"$tape": "t"}], lambda: V.cusum_fingerprint(rs)),
        ("compareSources", [{"$tape": "t"}, {"$tape": "u"}, "all"], lambda: V.compare_sources(rs, rs2, "all")),
        ("compareSources", [{"$tape": "t"}, {"$tape": "u"}, "5"], lambda: V.compare_sources(rs, rs2, "5")),
        ("canonicalJson", [{"b": [1, 2.5, None, "x\n\u00e9"], "a": {"z": True, "y": 1e21, "x": 0.1}}], lambda: V.canonical_json({"b": [1, 2.5, None, "x\n\u00e9"], "a": {"z": True, "y": 1e21, "x": 0.1}})),
        ("chainHashSync", [V.GENESIS, {"m": 1.23, "ts": "x"}], lambda: V.chain_hash(V.GENESIS, {"m": 1.23, "ts": "x"})),
        ("narrate", [12.345, {"below2": 4, "since10": 33}, {"expected": 1.9, "lo": 1.2, "hi": 3.1}], lambda: V.narrate(12.345, {"below2": 4, "since10": 33}, {"expected": 1.9, "lo": 1.2, "hi": 3.1})),
        ("narrate", [1.1, {"below2": 2, "since10": 3}, None], lambda: V.narrate(1.1, {"below2": 2, "since10": 3}, None)),
        ("numbersCheck", ["expected 1.95x at 40% with 3 rounds and 7.5", [1.95, 0.4, 3]], lambda: V.numbers_check("expected 1.95x at 40% with 3 rounds and 7.5", [1.95, 0.4, 3])),
        ("crashBustabit", ["0" * 63 + "f"], lambda: V.crash_bustabit("0" * 63 + "f")),
        ("blockBootstrapCI", [ms[:200], {"B": 50}], lambda: V.block_bootstrap_ci(ms[:200], {"B": 50})),
        ("quantileFromDist", [dists[0], 0.73], lambda: V.quantile_from_dist(dists[0], 0.73)),
        ("survivalFromDist", [dists[0], 7.3], lambda: V.survival_from_dist(dists[0], 7.3)),
        ("bhQ", [[0.01, 0.2, 0.03, 0.5]], lambda: V.bh_q([0.01, 0.2, 0.03, 0.5])),
    ]
    for s in specs:
        cases.append(("customPredict", [s, ms[:1500]], (lambda s=s: V.custom_predict(s, ms[:1500]))))
    cases.append(("scoreCustom", [specs[2], ms[:1500], 120, 2], lambda: V.score_custom(specs[2], ms[:1500], 120, 2)))
    cases.append(("admissionTests", [specs[3], ms[:1500]], lambda: V.admission_tests(specs[3], ms[:1500])))
    want = ts_call("v65", [{"fn": f, "args": a} for f, a, _ in cases], {"t": t, "u": t2})
    bad = []
    for i, ((f, _, g), w) in enumerate(zip(cases, want)):
        got = _strip(g())
        if isinstance(w, dict) and w.get("$error"):
            bad.append(f"{f}#{i}: ts error {w}")
            continue
        d = diff(got, _strip(w), 1e-9)
        if d:
            bad.append(f"{f}#{i}: {d[:4]}")
    assert not bad, "\n".join(bad)
