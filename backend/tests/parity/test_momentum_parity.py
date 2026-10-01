import pytest

from momento import momentum as M
from tests.parity.harness import diff, rounds_of, tape, ts_call


def strip(o):
    if isinstance(o, dict):
        return {k: strip(v) for k, v in o.items() if k != "generatedAt"}
    if isinstance(o, list):
        return [strip(v) for v in o]
    return o


@pytest.mark.parametrize("n,seed", [(3000, 31), (60, 32), (0, 33)])
def test_momentum_matches_archive(n, seed):
    t = tape(n, seed, step_ms=7000)
    opens = [{"id": 1, "window": "1h", "threshold": 5, "p": 0.4, "createdMs": t[0]["tsMs"] if t else 0, "dueMs": (t[0]["tsMs"] if t else 0) + 3_600_000}] if t else []
    W = {"markov": 0.01}
    calls = [
        {"fn": "hitPoints", "args": [{"$tape": "t"}]}, {"fn": "anchors", "args": [{"$tape": "t"}]},
        {"fn": "rangeMomentum", "args": [{"$tape": "t"}]}, {"fn": "moonshot", "args": [{"$tape": "t"}]},
        {"fn": "moonshot", "args": [{"$tape": "t"}, 5]}, {"fn": "rangeForecast", "args": [{"$tape": "t"}]},
        {"fn": "invertedForecast", "args": [{"$tape": "t"}, W]}, {"fn": "assessLive", "args": [{"$tape": "t"}, opens]},
    ]
    want = ts_call("momentum", calls, {"t": t})
    rs = rounds_of(t)
    got = [M.hit_points(rs), M.anchors(rs), M.range_momentum(rs), M.moonshot(rs), M.moonshot(rs, 5), M.range_forecast(rs),
           M.inverted_forecast(rs, W), M.assess_live(rs, opens)]
    bad = [f"{calls[i]['fn']}: {d[:4]}" for i, (g, w) in enumerate(zip(got, want)) if (d := diff(strip(g), strip(w), 1e-9))]
    assert not bad, "\n".join(bad)
