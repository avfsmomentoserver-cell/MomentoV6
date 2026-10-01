import random

import pytest

from momento import calibration as C
from momento import robust_evaluation as R
from tests.parity.harness import diff, tape, ts_call


def samples(n, seed, skew=0.0):
    r = random.Random(seed)
    t = tape(n, seed)
    out = []
    for row in t:
        base = [0.33, 0.30, 0.17, 0.10, 0.06, 0.04]
        d = [max(1e-4, b * (1 + skew * (r.random() - 0.5))) for b in base]
        out.append({"dist": d, "actual": row["multiplier"]})
    return out


@pytest.mark.parametrize("n,seed,skew", [(400, 1, 0.6), (900, 2, 1.4), (40, 3, 0.2)])
def test_calibration_and_evidence(n, seed, skew):
    s = samples(n, seed, skew)
    calls = [
        {"fn": "fitRecalibrator", "args": [s]},
        {"fn": "reliabilityTable", "args": [s, {"active": True, "gamma": 0.5, "tau": 0.8, "ratios": [1.1, 0.9, 1, 1, 1.2, 0.8]}]},
        {"fn": "quantileAt", "args": [s[0]["dist"], 0.73]},
        {"fn": "cdfAt", "args": [s[0]["dist"], 3.3]},
    ]
    want = ts_call("calibration", calls)
    rc_ = {"active": True, "gamma": 0.5, "tau": 0.8, "ratios": [1.1, 0.9, 1, 1, 1.2, 0.8]}
    got = [C.fit_recalibrator(s), C.reliability_table(s, rc_), C.quantile_at(s[0]["dist"], 0.73), C.cdf_at(s[0]["dist"], 3.3)]
    assert not diff(got, want, 1e-9)
    opts = {"rangeProfile": "wide", "minSeMultiple": 2}
    w2 = ts_call("robust-evaluation", [{"fn": "evaluateLockedHoldout", "args": [s, opts]}])[0]
    assert not diff(R.evaluate_locked_holdout(s, opts), w2, 1e-9)
