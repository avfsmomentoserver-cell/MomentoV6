# P8 Evidence Report — Walk-Forward Backtests

Generated: 2026-10-02T00:18:01.995407+00:00

Version: evidence-v1


## IID tape (3000 rounds)

*IID geometric, fixed distribution*

| Engine | Sample | WF Gain | SE | 95% CI | Gate Verdict | Gate Gain | Gate Sample | Status |
|---|---|---|---|---|---|---|---|---|
| Empirical baseline | 150 | +0.0000 | 0.0000 | [0.0000, 0.0000] | always | — | 150 | ✓ admitted |
| Chart Lab analogues | 150 | +0.0000 | 0.0000 | — | excluded | +0.0021 | 150 | — excluded |
| Rolling percentile (momento_core) | 150 | +0.0000 | 0.0000 | — | excluded | +0.0190 | 150 | — excluded |
| Crash prediction engine (momento_core) | 150 | +0.0000 | 0.0000 | — | excluded | -0.0374 | 150 | — excluded |
| ML next-round (momento_core, sklearn) | 150 | +0.0000 | 0.0000 | — | excluded | +0.0118 | 150 | — excluded |
| Signal hunter (momento_core) | 150 | +0.0000 | 0.0000 | — | admitted | +0.0051 | 150 | ✓ admitted |
| Band exhaustion (momento_core) | 150 | +0.0000 | 0.0000 | — | admitted | +0.0051 | 150 | ✓ admitted |
| Collapse ceiling (momento_core) | 150 | +0.0000 | 0.0000 | — | admitted | +0.0051 | 150 | ✓ admitted |
| Gap swing (momento_core) | 150 | +0.0000 | 0.0000 | — | excluded | -0.0026 | 150 | — excluded |

## DRIFT tape (3000 rounds)

*Distribution shift at midpoint*

| Engine | Sample | WF Gain | SE | 95% CI | Gate Verdict | Gate Gain | Gate Sample | Status |
|---|---|---|---|---|---|---|---|---|
| Empirical baseline | 150 | +0.0000 | 0.0000 | [0.0000, 0.0000] | always | — | 150 | ✓ admitted |
| Chart Lab analogues | 150 | +0.0000 | 0.0000 | — | excluded | +0.0011 | 150 | — excluded |
| Rolling percentile (momento_core) | 150 | +0.0000 | 0.0000 | — | excluded | +0.0021 | 150 | — excluded |
| Crash prediction engine (momento_core) | 150 | +0.0000 | 0.0000 | — | excluded | -0.0201 | 150 | — excluded |
| ML next-round (momento_core, sklearn) | 150 | +0.0000 | 0.0000 | — | excluded | +0.0050 | 150 | — excluded |
| Signal hunter (momento_core) | 150 | +0.0000 | 0.0000 | — | admitted | +0.0083 | 150 | ✓ admitted |
| Band exhaustion (momento_core) | 150 | +0.0000 | 0.0000 | — | admitted | +0.0083 | 150 | ✓ admitted |
| Collapse ceiling (momento_core) | 150 | +0.0000 | 0.0000 | — | admitted | +0.0083 | 150 | ✓ admitted |
| Gap swing (momento_core) | 150 | +0.0000 | 0.0000 | — | excluded | +0.0012 | 150 | — excluded |

## Interpretation

On the **iid tape**, no engine should demonstrate real skill — the distribution
is memoryless, so past rounds carry no information about the next.  Any engine
that shows a positive gain here is likely overfitting; the blend gate's 2-SE
threshold controls the false-positive rate.

On the **drift tape**, the distribution shifts at the midpoint.  Engines that
adapt to recent history (rolling percentile, Chart Lab analogues) may show
genuine skill in the second half.  The gate still requires > 2 SE to admit.

"Not admitted" is a valid, expected result for most candidates.