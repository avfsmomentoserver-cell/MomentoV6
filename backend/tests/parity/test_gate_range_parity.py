import math
import random

from momento import analogue as AN
from momento import engine_gate as G
from momento import point_range as P
from tests.parity.harness import diff, tape, ts_call
from tests.parity.test_calibration_parity import samples


def gate_rows(n, seed):
    r = random.Random(seed)
    out = []
    for _ in range(n):
        w = {"baseline": 0.4, "a": 0.3 if r.random() < 0.7 else 0.02, "b": 0.3, "c": 0}
        cl = {k: -math.log(max(1e-4, 0.3 + 0.2 * (r.random() - 0.5) + (0.05 if k == "a" else 0))) for k in w}
        out.append({"weights": w, "compLoss": cl})
    return out


def test_point_range_parity():
    s = samples(700, 5, 1.0)
    rc = {"active": True, "gamma": 0.5, "tau": 0.9, "ratios": [1.05, 0.95, 1, 1, 1.1, 0.9]}
    optsets = [{"nominal": 0.7}, {"nominal": 0.5, "pointMethod": "geomean", "intervalMethod": "shortest", "minSeMultiple": 0},
               {"nominal": 0.8, "adaptive": False, "window": 300}, {"nominal": 0.7, "minSample": 1000}]
    want = ts_call("point-range", [{"fn": "selectPointRange", "args": [s, rc, o]} for o in optsets])
    for o, w in zip(optsets, want):
        d = diff(P.select_point_range(s, rc, o), w, 1e-9)
        assert not d, (o, d)


def test_engine_gate_parity():
    rows = gate_rows(500, 9)
    keys = ["baseline", "a", "b", "c", "d"]
    optsets = [{}, {"seMultiple": 1, "window": 200}, {"minSample": 1000, "trialShare": 0.1}]
    want = ts_call("engine-gate", [{"fn": "blendAdmission", "args": [rows, keys, o]} for o in optsets])
    got = [G.blend_admission(rows, keys, o) for o in optsets]
    assert not diff(got, want, 1e-9)
    w2 = ts_call("engine-gate", [{"fn": "gatedStates", "args": [{"b": "demoted"}, want[0], ["baseline", "a", "b"], ["c", "d", "e"]]}])[0]
    assert not diff(G.gated_states({"b": "demoted"}, got[0], ["baseline", "a", "b"], ["c", "d", "e"]), w2)


def test_analogue_parity():
    m = [r["multiplier"] for r in tape(2600, 11)]
    calls = [{"fn": "analogueNextDist", "args": [m, {}]}, {"fn": "analogueNextDist", "args": [m[:80], {}]},
             {"fn": "chartLabPrecision", "args": [m, {"anchors": 40, "scanLimit": 800, "minHistory": 1200}]}]
    want = ts_call("analogue", calls)
    got = [AN.analogue_next_dist(m, {}), AN.analogue_next_dist(m[:80], {}), AN.chart_lab_precision(m, {"anchors": 40, "scanLimit": 800, "minHistory": 1200})]
    assert not diff(got, want, 1e-9)
