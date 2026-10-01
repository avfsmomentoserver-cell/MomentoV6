import pytest

from momento import pipeline as P
from tests.parity.harness import diff, rounds_of, tape, ts_call


def strip(o):
    if isinstance(o, dict):
        return {k: strip(v) for k, v in o.items() if k != "generatedAt"}
    if isinstance(o, list):
        return [strip(v) for v in o]
    return o


W = {"markov": 0.01, "streak": 0.003, "recent": 0}


@pytest.mark.parametrize("n,seed", [(4000, 21), (350, 22), (1, 23), (0, 24)])
def test_pipeline_matches_archive(n, seed):
    t = tape(n, seed, step_ms=8000)
    calls = [
        {"fn": "medianIntervalMs", "args": [{"$tape": "t"}]},
        {"fn": "perRoundProbability", "args": [{"$tape": "t"}, 2, W]},
        {"fn": "perRoundProbability", "args": [{"$tape": "t"}, 10, {}]},
        {"fn": "pipelineForecast", "args": [{"$tape": "t"}, "aviator", W]},
        {"fn": "nextRoundForecast", "args": [{"$tape": "t"}, "aviator", W]},
        {"fn": "nextRoundForecast", "args": [{"$tape": "t"}, "aviator", W, 0.12, 300]},
        {"fn": "nextRoundForecast", "args": [{"$tape": "t"}, "aviator", {}, -0.3, 50]},
        {"fn": "verifyAgainstHistory", "args": [{"$tape": "t"}, {}]},
        {"fn": "verifyAgainstHistory", "args": [{"$tape": "t"}, {"thresholds": [2, 5], "warmup": 300, "blockWeights": {"baseline": 1, "markov": 2}}]},
    ]
    want = ts_call("pipeline", calls, {"t": t})
    rs = rounds_of(t)
    got = [
        P.median_interval_ms(rs), P.per_round_probability(rs, 2, W), P.per_round_probability(rs, 10, {}),
        P.pipeline_forecast(rs, "aviator", W), P.next_round_forecast(rs, "aviator", W) if n else None,
        P.next_round_forecast(rs, "aviator", W, 0.12, 300) if n else None, P.next_round_forecast(rs, "aviator", {}, -0.3, 50) if n else None,
        P.verify_against_history(rs, {}), P.verify_against_history(rs, {"thresholds": [2, 5], "warmup": 300, "blockWeights": {"baseline": 1, "markov": 2}}),
    ]
    if not n:
        want = [w if i not in (4, 5, 6) else None for i, w in enumerate(want)]
    if n < 500:  # v6.5 produced NaN rows here (negative block size); python reports insufficient
        for i in (7, 8):
            assert all(r["verdict"] == "insufficient" for r in got[i]["runs"])
            got[i] = want[i] = None
    bad = [f"{calls[i]['fn']}#{i}: {d[:4]}" for i, (g, w) in enumerate(zip(got, want)) if (d := diff(strip(g), strip(w), 1e-9))]
    assert not bad, "\n".join(bad)
    if want[7] is None:
        return
    rs_runs = want[7]["runs"]
    assert not diff(P.skills_from_runs(rs_runs), ts_call("pipeline", [{"fn": "skillsFromRuns", "args": [rs_runs]}])[0])
