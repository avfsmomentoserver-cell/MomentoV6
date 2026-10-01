import pytest

from momento import fx as F
from tests.parity.harness import diff, rounds_of, tape, ts_call

FNS = ["correlationEngine", "volatilityProfile", "orderFlow", "supportDensity", "breakout", "meanReversion",
       "trendQuality", "eventRisk", "divergence", "fxSignals"]


@pytest.mark.parametrize("n,seed", [(2500, 4), (90, 5), (0, 6)])
def test_fx_matches_archive(n, seed):
    t = tape(n, seed) + [dict(r, id=10_000 + i, source="spribe") for i, r in enumerate(tape(min(n, 300), seed + 1))]
    t.sort(key=lambda r: r["tsMs"])
    want = ts_call("fx", [{"fn": f, "args": [{"$tape": "t"}]} for f in FNS], {"t": t})
    rs = rounds_of(t)
    bad = []
    for f, w in zip(FNS, want):
        d = diff(getattr(F, f)(rs), w, 1e-9)
        if d:
            bad.append(f"{f}: {d[:4]}")
    assert not bad, "\n".join(bad)
