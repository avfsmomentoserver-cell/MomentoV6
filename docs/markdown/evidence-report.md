# P8 Evidence Report — Walk-Forward Backtests

Generated: 2026-10-02T00:29:16.623512+00:00

Version: evidence-v1


## IID tape (3000 rounds)

*IID geometric, fixed distribution*

| Engine | Gate Sample | Gate Verdict | Gate Gain | Gate SE | Status |
|---|---|---|---|---|---|
| Empirical baseline | 150 | always | — | 0.00000 | ✓ admitted |
| Chart Lab analogues | 150 | excluded | +0.00208 | 0.00216 | — excluded |
| Rolling percentile (momento_core) | 150 | excluded | +0.01901 | 0.01042 | — excluded |
| Crash prediction engine (momento_core) | 150 | excluded | -0.03742 | 0.00661 | — excluded |
| ML next-round (momento_core, sklearn) | 150 | excluded | +0.01182 | 0.00985 | — excluded |
| Signal hunter (momento_core) | 150 | admitted | +0.00509 | 0.00160 | ✓ admitted |
| Band exhaustion (momento_core) | 150 | admitted | +0.00509 | 0.00160 | ✓ admitted |
| Collapse ceiling (momento_core) | 150 | admitted | +0.00509 | 0.00160 | ✓ admitted |
| Gap swing (momento_core) | 150 | excluded | -0.00272 | 0.00170 | — excluded |

## DRIFT tape (3000 rounds)

*Distribution shift at midpoint*

| Engine | Gate Sample | Gate Verdict | Gate Gain | Gate SE | Status |
|---|---|---|---|---|---|
| Empirical baseline | 150 | always | — | 0.00000 | ✓ admitted |
| Chart Lab analogues | 150 | excluded | +0.00113 | 0.00294 | — excluded |
| Rolling percentile (momento_core) | 150 | excluded | +0.00205 | 0.00964 | — excluded |
| Crash prediction engine (momento_core) | 150 | excluded | -0.02014 | 0.01055 | — excluded |
| ML next-round (momento_core, sklearn) | 150 | excluded | +0.00499 | 0.00813 | — excluded |
| Signal hunter (momento_core) | 150 | admitted | +0.00829 | 0.00260 | ✓ admitted |
| Band exhaustion (momento_core) | 150 | admitted | +0.00829 | 0.00260 | ✓ admitted |
| Collapse ceiling (momento_core) | 150 | admitted | +0.00829 | 0.00260 | ✓ admitted |
| Gap swing (momento_core) | 150 | excluded | +0.00119 | 0.00317 | — excluded |

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