# Analysis Engines

All engines are pure TypeScript ports of the original core (`analysis.py`, `features/*`), computed server-side from the stored series.

## Ladders (Ladder Telemetry)
Descending sequences of rounds that each land lower than the last, inside the 2–5× band, minimum length 3. The run-length histogram shows what "normal" looks like; the current ladder is highlighted. Surface: `/dashboard/ladder`.

## Resistance (Ceilings)
Local maxima ≥2× from the recent 400-round window, clustered at 5% tolerance, minimum 3 touches. Each level gets an archetype (ascending/descending/flat), touch count and last-touch position; the dominant ceiling is the most-touched level. Surface: `/dashboard/resistance`.

## Streaks & Markov
Current dry/above streak, historical maxima, conditional P(next ≥2× | streak k) with Wilson CIs, the 2×2 Markov transition matrix, expected duration, and the post-high effect (P(next ≥2× | previous ≥10×)). Surface: Command Center + DNA Hunter.

## Bands & transitions
Six bands (<1.5 / 1.5–2 / 2–5 / 5–10 / 10–100 / 100+), the full transition matrix, and the chi-square independence test — on the merged dataset the matrix is emphatically *not* independent (χ² ≈ 837.6, 25 dof). Pattern DNA Tracker renders the matrix; DNA Hunter collapses the band sequence into 3-grams with forward statistics.

## Distribution & quantiles
Mean, median, max, q10–q99, bucket counts. Feeds the Command Center strip, statistics endpoint and consumer Charts.

## Exceedance & gaps
For every threshold in the grid 1.2× → 1000×: measured rate, Wilson 95% CI, current dry run, ETA median and p90 (geometric wait). Eagle Eye adds inline custom gates.

## House edge
Observed mean vs implied fair (1.0), estimated edge, and the cashout EV table `EV(T) = P(≥T)·T − 1`. This is the honest frame for every strategy screen.

## Mega Pressure (v2.0)
Power-law tail fit `p(t) = a·t^-b` (log-log OLS on ≥25×), blended with measured rates where ≥5 hits exist, across targets 100× → 100,000×. Pressure = dry run vs expected median wait (50% = "on schedule"). It *describes* the drought; the hazard of a memoryless tail is constant, so it does not *predict* release. Surface: `/dashboard/mega-pressure`.

## Moonshot Scanner
Factor blend over tail pressure, distance since 10×/100×, band compression, dry-zone state. Confidence is capped at 0.95 and labeled honestly: conditions building vs no edge. Surface: `/dashboard/moonshot`.

## ShapeShifters
Curve anatomy on the recent window: log-slope, acceleration, skewness, kurtosis, classification (exponential / power_law / bimodal / uniform / clustered), Pareto MLE with KS goodness-of-fit, dry-zone predictor (rolling 50-round mean < 2.0×), Bayesian ETA bands, trajectory groups. Full port notes in the ShapeShifters & Darkboard doc.
