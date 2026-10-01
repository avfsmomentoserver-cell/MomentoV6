# P8 Evidence Report — Walk-Forward Backtests

Generated: 2026-10-01T23:14:26.822050+00:00

Version: evidence-v1


## IID tape (3000 rounds)

*IID geometric, fixed distribution*

| Engine | Sample | Baseline LL | Candidate LL | Mean Gain | SE | 95% CI | Verdict |
|---|---|---|---|---|---|---|---|
| Empirical baseline | 150 | 0.0000 | 0.0000 | +0.0000 | 0.0000 | [0.0000, 0.0000] | ✓ admitted |
| Chart Lab analogues | 140 | 1.5949 | 1.6385 | -0.0436 | 0.0208 | [-0.0843, -0.0028] | — excluded |
| Rolling percentile (momento_core) | 140 | 1.5949 | 2.3846 | -0.7897 | 0.0771 | [-0.9409, -0.6385] | — excluded |
| Crash prediction engine (momento_core) | 140 | 1.5949 | 2.1391 | -0.5442 | 0.0822 | [-0.7053, -0.3831] | — excluded |
| ML next-round (momento_core, sklearn) | 140 | 1.5949 | 2.6723 | -1.0774 | 0.0552 | [-1.1856, -0.9693] | — excluded |
| Signal hunter (momento_core) | 140 | 1.5949 | 1.5949 | +0.0000 | 0.0000 | [-0.0000, 0.0000] | — excluded |
| Band exhaustion (momento_core) | 140 | 1.5949 | 1.5949 | +0.0000 | 0.0000 | [-0.0000, 0.0000] | — excluded |
| Collapse ceiling (momento_core) | 140 | 1.5949 | 1.5949 | +0.0000 | 0.0000 | [-0.0000, 0.0000] | — excluded |
| Gap swing (momento_core) | 140 | 1.5949 | 1.6584 | -0.0635 | 0.0609 | [-0.1828, 0.0558] | — excluded |

## DRIFT tape (3000 rounds)

*Distribution shift at midpoint*

| Engine | Sample | Baseline LL | Candidate LL | Mean Gain | SE | 95% CI | Verdict |
|---|---|---|---|---|---|---|---|
| Empirical baseline | 150 | 0.0000 | 0.0000 | +0.0000 | 0.0000 | [0.0000, 0.0000] | ✓ admitted |
| Chart Lab analogues | 140 | 1.5697 | 1.6276 | -0.0579 | 0.0208 | [-0.0987, -0.0171] | — excluded |
| Rolling percentile (momento_core) | 140 | 1.5697 | 2.3543 | -0.7846 | 0.0799 | [-0.9412, -0.6281] | — excluded |
| Crash prediction engine (momento_core) | 140 | 1.5697 | 2.1079 | -0.5381 | 0.0832 | [-0.7012, -0.3751] | — excluded |
| ML next-round (momento_core, sklearn) | 140 | 1.5697 | 2.6321 | -1.0624 | 0.0594 | [-1.1789, -0.9459] | — excluded |
| Signal hunter (momento_core) | 140 | 1.5697 | 1.5697 | +0.0000 | 0.0000 | [0.0000, 0.0000] | — excluded |
| Band exhaustion (momento_core) | 140 | 1.5697 | 1.5697 | +0.0000 | 0.0000 | [0.0000, 0.0000] | — excluded |
| Collapse ceiling (momento_core) | 140 | 1.5697 | 1.5697 | +0.0000 | 0.0000 | [0.0000, 0.0000] | — excluded |
| Gap swing (momento_core) | 140 | 1.5697 | 1.6321 | -0.0624 | 0.0609 | [-0.1817, 0.0570] | — excluded |

## Interpretation

On the **iid tape**, no engine should demonstrate real skill — the distribution
is memoryless, so past rounds carry no information about the next.  Any engine
that shows a positive gain here is likely overfitting; the blend gate's 2-SE
threshold controls the false-positive rate.

On the **drift tape**, the distribution shifts at the midpoint.  Engines that
adapt to recent history (rolling percentile, Chart Lab analogues) may show
genuine skill in the second half.  The gate still requires > 2 SE to admit.

"Not admitted" is a valid, expected result for most candidates.