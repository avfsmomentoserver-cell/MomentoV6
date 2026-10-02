"""P6 unit tests: momento_core experts registered as gated candidate engines.

Verifies that:
1. Candidate providers register on Core.extra_candidates
2. Candidates appear in gated_registry().extras
3. Candidate distributions are valid (6 elements, sum to 1, all finite)
4. Candidate keys flow through to intel_calibrations.comp_loss
5. The blend gate produces verdicts for each candidate
6. MOMENTO_CANDIDATES=0 disables registration
"""

from __future__ import annotations

import json
import os
import tempfile

import pytest

from momento.storage import Database


@pytest.fixture
def core():
    import random
    os.environ["MOMENTO_CANDIDATES"] = "1"  # ensure candidates are enabled
    os.environ["MOMENTO_SCHEDULER"] = "0"
    db = Database(tempfile.mktemp(suffix=".db"))
    from app.core import Core
    c = Core(db)
    rows = []
    rnd = random.Random(42)
    for i in range(250):
        m = max(1.0, round(0.97 / (1 - rnd.random()), 2))
        rows.append({"ts_ms": 1000 + i * 500, "multiplier": m})
    c.ingest_rounds("test", "api", rows, "observed")
    return c


def test_candidates_registered(core):
    """All momento_core candidate providers are registered."""
    # 7 providers registered (ml may or may not be present depending on sklearn)
    assert len(core.extra_candidates) >= 6


def test_candidates_in_registry(core):
    """Candidate engines appear in gated_registry().extras."""
    reg = core.gated_registry()
    keys = [e["key"] for e in reg["extras"]]
    # chartlab is always present; momento_core candidates should also appear
    assert "chartlab" in keys
    assert any(k.startswith("mc_") for k in keys), f"no mc_ candidates in {keys}"


def test_candidate_distributions_valid(core):
    """Every candidate predict() returns a valid 6-element distribution."""
    reg = core.gated_registry()
    rounds = core.rounds_for(None)
    for extra in reg["extras"]:
        if not extra["key"].startswith("mc_"):
            continue
        dist = extra["predict"](rounds)
        assert len(dist) == 6, f"{extra['key']}: dist has {len(dist)} elements, expected 6"
        assert all(isinstance(x, (int, float)) for x in dist), f"{extra['key']}: non-numeric in dist"
        assert all(abs(x) < float("inf") for x in dist), f"{extra['key']}: infinite value in dist"
        total = sum(dist)
        assert abs(total - 1.0) < 0.01, f"{extra['key']}: dist sums to {total}, expected ~1.0"


def test_candidate_keys_in_comp_loss(core):
    """Candidate keys appear in intel_calibrations.comp_loss after calibration."""
    core.calibrate_new_rounds(max_intel=50)
    rows = core.sql.rows(
        "SELECT comp_loss FROM intel_calibrations WHERE resolved_ms IS NOT NULL AND comp_loss IS NOT NULL ORDER BY created_ms DESC LIMIT 1"
    )
    assert len(rows) > 0, "no calibration rows with comp_loss"
    comp = json.loads(rows[0]["comp_loss"]) if rows[0]["comp_loss"] else {}
    mc_keys = [k for k in comp if k.startswith("mc_")]
    assert len(mc_keys) > 0, f"no mc_ keys in comp_loss: {list(comp.keys())}"


def test_gate_verdicts_for_candidates(core):
    """The blend gate produces verdicts for each candidate."""
    core.calibrate_new_rounds(max_intel=50)
    reg = core.gated_registry()
    gate = reg["gate"]
    assert gate is not None, "gate is None"
    assert gate.get("sample", 0) > 0, f"gate sample is {gate.get('sample')}"
    verdicts = {v["key"]: v for v in gate.get("verdicts", [])}
    mc_verdicts = {k: v for k, v in verdicts.items() if k.startswith("mc_")}
    assert len(mc_verdicts) > 0, f"no mc_ verdicts in gate: {list(verdicts.keys())}"
    for key, v in mc_verdicts.items():
        assert "admitted" in v, f"{key}: missing 'admitted' in verdict"
        assert "status" in v, f"{key}: missing 'status' in verdict"
        assert "gain" in v, f"{key}: missing 'gain' in verdict"


def test_disable_candidates():
    """MOMENTO_CANDIDATES=0 disables candidate registration."""
    old = os.environ.get("MOMENTO_CANDIDATES")
    os.environ["MOMENTO_CANDIDATES"] = "0"
    try:
        db = Database(tempfile.mktemp(suffix=".db"))
        from app.core import Core
        c = Core(db)
        assert len(c.extra_candidates) == 0, f"expected 0 candidates, got {len(c.extra_candidates)}"
    finally:
        if old is not None:
            os.environ["MOMENTO_CANDIDATES"] = old
        else:
            os.environ.pop("MOMENTO_CANDIDATES", None)
