# P8 Evidence Report — Walk-Forward Backtests

Generated: 2026-10-02T00:46:06.563231+00:00

Version: evidence-v1


## IID tape (3000 rounds)

*IID geometric, fixed distribution*

| Engine | Gate Sample | Gate Verdict | Gate Gain | Gate SE | Status |
|---|---|---|---|---|---|
| Empirical baseline | 150 | always | — | 0.00000 | ✓ admitted |
| Chart Lab analogues | 150 | excluded | +0.00227 | 0.00277 | — excluded |
| Rolling percentile (momento_core) | 150 | excluded | +0.01733 | 0.01033 | — excluded |
| Crash prediction engine (momento_core) | 150 | excluded | -0.03952 | 0.00911 | — excluded |
| ML next-round (momento_core, sklearn) | 150 | excluded | +0.00835 | 0.00937 | — excluded |
| Signal hunter (momento_core) | 150 | excluded | -0.02905 | 0.00701 | — excluded |
| Band exhaustion (momento_core) | 150 | excluded | -0.02905 | 0.00701 | — excluded |
| Collapse ceiling (momento_core) | 150 | excluded | -0.02905 | 0.00701 | — excluded |
| Gap swing (momento_core) | 150 | excluded | -0.00238 | 0.00250 | — excluded |

## DRIFT tape (3000 rounds)

*Distribution shift at midpoint*

| Engine | Gate Sample | Gate Verdict | Gate Gain | Gate SE | Status |
|---|---|---|---|---|---|
| Empirical baseline | 150 | always | — | 0.00000 | ✓ admitted |
| Chart Lab analogues | 150 | excluded | +0.00284 | 0.00303 | — excluded |
| Rolling percentile (momento_core) | 150 | excluded | +0.00275 | 0.00966 | — excluded |
| Crash prediction engine (momento_core) | 150 | excluded | -0.01968 | 0.01159 | — excluded |
| ML next-round (momento_core, sklearn) | 150 | excluded | +0.00576 | 0.00813 | — excluded |
| Signal hunter (momento_core) | 150 | excluded | -0.02831 | 0.00624 | — excluded |
| Band exhaustion (momento_core) | 150 | excluded | -0.02831 | 0.00624 | — excluded |
| Collapse ceiling (momento_core) | 150 | excluded | -0.02831 | 0.00624 | — excluded |
| Gap swing (momento_core) | 150 | excluded | +0.00289 | 0.00325 | — excluded |

## Interpretation

Gate verdicts are from real calibration `comp_loss` rows, not synthetic walk-forward.

The blend admission gate requires > 2 SE log-loss gain over the blend without the candidate.

On the **iid tape**, no engine should demonstrate real skill — the distribution
is memoryless, so past rounds carry no information about the next.  Any engine
that shows a positive gain here is likely overfitting; the blend gate's 2-SE
threshold controls the false-positive rate.  A small number of false-positive
admissions on iid data is expected and does not indicate real skill.

On the **drift tape**, the distribution shifts at the midpoint.  Engines that
adapt to recent history (rolling percentile, Chart Lab analogues) may show
genuine skill in the second half.  The gate still requires > 2 SE to admit.

"Not admitted" is a valid, expected result for most candidates.