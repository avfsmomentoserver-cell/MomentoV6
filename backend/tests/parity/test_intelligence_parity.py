import pytest

from momento import calibration as C
from momento import intelligence as I
from momento import point_range as P
from tests.parity.harness import diff, rounds_of, tape, ts_call
from tests.parity.test_calibration_parity import samples


def _strip(o):
    if isinstance(o, dict):
        return {k: _strip(v) for k, v in o.items() if k != "generatedAt"}
    if isinstance(o, list):
        return [_strip(v) for v in o]
    return o


@pytest.mark.parametrize("n,seed,drift", [(6000, 61, 0.02), (1200, 62, 0.0), (150, 63, 0.0), (12, 64, 0.0)])
def test_full_intelligence_matches_archive(n, seed, drift):
    t = tape(n, seed, drift=drift)
    rs = rounds_of(t)
    s = samples(600, seed, 1.2)
    rc = C.fit_recalibrator(s)
    rc_q = {**rc, "quantileActive": True, "levels": [{"q": 0.15, "mapped": 0.2}, {"q": 0.5, "mapped": 0.47}, {"q": 0.85, "mapped": 0.8}, {"q": 0.95, "mapped": 0.93}]}
    prs = P.select_point_range(s, {"active": True, "gamma": 0.5, "tau": 0.9, "ratios": [1.05, 0.95, 1, 1, 1.1, 0.9]},
                               {"nominal": 0.5, "pointMethod": "geomean", "intervalMethod": "shortest", "minSeMultiple": 0})
    ledger = {"weights": {}, "logLoss": {"baseline": 1.31, "markov": 1.29, "dna": 1.4, "ml": 1.33, "x1": 1.2}, "sample": 80, "mixLogLoss": 1.25, "baseLogLoss": 1.31, "hitRate": 0.41}
    optsets = [
        {},
        {"ledger": ledger, "pipelineWeights": {"baseline": 0.5, "markov": 0.2, "streak": 0.2, "recent": 0.1}, "correction": 0.12, "correctionSample": 40},
        {"ledger": ledger, "engineStates": {"dna": "shadow", "ml": "demoted", "x1": "live"}, "rangeProfile": "wide", "correction": -0.2},
        {"ledger": {**ledger, "sample": 10}, "recalibrator": rc, "correction": 0.3, "pointRange": prs},
        {"recalibrator": rc_q, "rangeProfile": "tight", "maxHistory": 3000},
    ]
    want = ts_call("intelligence", [{"fn": "fullIntelligenceForecast", "args": [{"$tape": "t"}, "aviator", o]} for o in optsets], {"t": t})
    bad = []
    for o, w in zip(optsets, want):
        d = diff(_strip(I.full_intelligence_forecast(rs, "aviator", o)), _strip(w), 1e-9)
        if d:
            bad.append(f"{list(o)}: {d[:6]}")
    assert not bad, "\n".join(bad)
    f = I.full_intelligence_forecast(rs, "aviator")
    acts = [1.0, 1.3, 2.2, 4.9, 12, 150]
    w2 = ts_call("intelligence", [{"fn": "scoreIntelForecast", "args": [f, a]} for a in acts]
                 + [{"fn": "earnWeights", "args": [ledger]}, {"fn": "bandLogLoss", "args": [[0.3, 0.3, 0.2, 0.1, 0.05, 0.05], 7]}])
    g2 = [I.score_intel_forecast(f, a) for a in acts] + [I.earn_weights(ledger), I.band_log_loss([0.3, 0.3, 0.2, 0.1, 0.05, 0.05], 7)]
    assert not diff(g2, w2, 1e-9)
