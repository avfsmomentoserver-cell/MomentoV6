"""P8 unit tests: evidence report — walk-forward backtests and gate verdicts."""

from __future__ import annotations

import math

import pytest

from momento.evidence import (
    generate_iid_tape,
    generate_drift_tape,
    walk_forward_backtest,
    run_evidence_report,
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
    assert abs(bt["meanGain"]) < 0.1  # baseline vs baseline ~ 0


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


def test_evidence_report_structure():
    """The full evidence report has the expected structure."""
    report = run_evidence_report()
    assert report["version"] == "evidence-v1"
    assert "iid" in report["results"]
    assert "drift" in report["results"]
    assert "iid" in report["tapes"]
    assert "drift" in report["tapes"]

    for tape_name in ("iid", "drift"):
        entries = report["results"][tape_name]
        assert len(entries) >= 1
        # Baseline is always first
        assert entries[0]["key"] == "baseline"
        # Each entry has required fields
        for e in entries:
            assert "key" in e
            assert "label" in e
            assert "sample" in e
            assert "meanGain" in e
            assert "se" in e
            assert "admitted" in e
            assert "status" in e


def test_evidence_report_honesty():
    """On IID data, no candidate should be admitted (no real signal)."""
    report = run_evidence_report()
    iid_entries = report["results"]["iid"]
    for e in iid_entries:
        if e["key"] == "baseline":
            continue
        assert not e["admitted"], f"{e['key']} admitted on IID data — likely overfitting"


def test_format_report_text():
    """The formatted report is non-empty Markdown."""
    report = run_evidence_report()
    text = format_report_text(report)
    assert len(text) > 100
    assert "IID" in text
    assert "DRIFT" in text
    assert "Interpretation" in text
