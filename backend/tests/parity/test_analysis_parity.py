import pytest

from momento import analysis as A
from tests.parity.harness import diff, rounds_of, tape, ts_call

CASES = [
    ("overview", []), ("exceedance", []), ("streaks", [2]), ("streaks", [5]), ("bands", []), ("ladders", []),
    ("ceilings", []), ("pressure", []), ("shape", []), ("shape", [80]), ("moonshot", []), ("linguistics", []),
    ("gaps", []), ("walkForward", []), ("candles", [60]), ("sessionPhases", []), ("houseEdge", []),
]
PY = {"overview": A.overview, "exceedance": A.exceedance, "streaks": A.streaks, "bands": A.bands, "ladders": A.ladders,
      "ceilings": A.ceilings, "pressure": A.pressure, "shape": A.shape, "moonshot": A.moonshot, "linguistics": A.linguistics,
      "gaps": A.gaps, "walkForward": A.walk_forward, "candles": A.candles, "sessionPhases": A.session_phases, "houseEdge": A.house_edge}


@pytest.mark.parametrize("n,seed", [(1500, 7), (120, 3), (0, 1)])
def test_analysis_matches_archive(n, seed):
    t = tape(n, seed)
    want = ts_call("analysis", [{"fn": fn, "args": [{"$tape": "t"}, *args]} for fn, args in CASES], {"t": t})
    rounds = rounds_of(t)
    problems = []
    for (fn, args), w in zip(CASES, want):
        got = PY[fn](rounds, *args)
        d = diff(got, w, 1e-9)
        if d:
            problems.append(f"{fn}{args}: " + "; ".join(d[:5]))
    assert not problems, "\n".join(problems)
