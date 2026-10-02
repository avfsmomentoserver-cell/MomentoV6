"""P8 unit tests: evidence report — walk-forward backtests and gate verdicts."""

from __future__ import annotations

import math

import pytest

from momento.evidence import (
    generate_iid_tape,
    generate_drift_tape,
    walk_forward_backtest,
    format_report_text,
)


def test_iid_tape_shape():
    tape = generate_iid_tape(n=500, seed=7)
    assert len(tape) == 500
    assert all(m >= 1.0 for m in tape)
    assert all(isinstance(m, float) for m in tape)


def test_drift_tape_shape():
    tape = generate_drift_tape(n=500, seed=7)
    assert len(tape) == 500
    assert all(m >= 1.0 for m in tape)


def test_iid_reproducible():
    assert generate_iid_tape(100, 42) == generate_iid_tape(100, 42)


def test_walk_forward_baseline():
    """The empirical baseline should have ~0 gain against itself."""
    tape = generate_iid_tape(500, 42)

    def baseline_predict(rounds):
        ms = [r.multiplier for r in rounds]
        counts = [1] * 6
        for m in ms:
            idx = min(5, sum(1 for e in [1.5, 2, 5, 10, 100] if m >= e))
            counts[idx] += 1
        s = sum(counts)
        return [c / s for c in counts]

    bt = walk_forward_backtest(tape, baseline_predict, train_size=100, step=20)
    assert bt["sample"] > 0
    assert abs(bt["meanGain"]) < 0.1


def test_walk_forward_returns_valid_structure():
    tape = generate_iid_tape(500, 42)

    def dummy_predict(rounds):
        return [0.5, 0.2, 0.15, 0.1, 0.04, 0.01]

    bt = walk_forward_backtest(tape, dummy_predict, train_size=100, step=20)
    assert "sample" in bt
    assert "meanGain" in bt
    assert "se" in bt
    assert "ci95" in bt
    assert "admitted" in bt
    assert "status" in bt
    assert bt["sample"] > 0


def test_format_report_text():
    """The formatted report renders correctly with a mock report."""
    mock_report = {
        "version": "evidence-v1",
        "generated_at": "2026-01-01T00:00:00+00:00",
        "tapes": {
            "iid": {"rounds": 3000, "description": "IID geometric, fixed distribution"},
            "drift": {"rounds": 3000, "description": "Distribution shift at midpoint"},
        },
        "results": {
            "iid": [
                {"key": "baseline", "label": "Empirical baseline", "sample": 150, "meanGain": 0, "se": 0, "ci95": [0, 0], "admitted": True, "status": "always", "gateVerdict": "always", "gateAdmitted": True, "gateGain": 0, "gateSample": 0},
                {"key": "mc_crash", "label": "Crash prediction", "sample": 140, "meanGain": -0.04, "se": 0.02, "ci95": [-0.08, -0.001], "admitted": False, "status": "excluded", "gateVerdict": "excluded", "gateAdmitted": False, "gateGain": -0.001, "gateSample": 100},
            ],
            "drift": [
                {"key": "baseline", "label": "Empirical baseline", "sample": 150, "meanGain": 0, "se": 0, "ci95": [0, 0], "admitted": True, "status": "always", "gateVerdict": "always", "gateAdmitted": True, "gateGain": 0, "gateSample": 0},
                {"key": "mc_crash", "label": "Crash prediction", "sample": 140, "meanGain": -0.06, "se": 0.02, "ci95": [-0.1, -0.02], "admitted": False, "status": "excluded", "gateVerdict": "excluded", "gateAdmitted": False, "gateGain": -0.002, "gateSample": 100},
            ],
        },
        "summary": {},
    }
    text = format_report_text(mock_report)
    assert len(text) > 100
    assert "IID" in text
    assert "DRIFT" in text
    assert "Interpretation" in text
    assert "Gate Verdict" in text


def test_walk_forward_honesty_on_iid():
    """On IID data, a dummy non-informative engine should not be admitted."""
    tape = generate_iid_tape(500, 42)

    def flat_predict(rounds):
        return [0.4, 0.25, 0.15, 0.1, 0.07, 0.03]

    bt = walk_forward_backtest(tape, flat_predict, train_size=100, step=20)
    # A flat distribution on IID data should not beat the empirical baseline
    assert bt["status"] in ("excluded", "insufficient-data")
