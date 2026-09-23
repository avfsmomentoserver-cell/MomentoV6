# Calibration & Data Provenance

## Provenance (inherited from DATA_PROVENANCE.md)

The merged dataset was assembled in the archives from three sources, vendored and normalized there:

1. `avfs.db` — 150,410 rounds (150,416 before dedupe), 2024-01-01 → 2026-07-24 UTC
2. previous sessions (`momento.db`) — 18,805 rounds, 2026-07-29 → 2026-07-30 UTC
3. original project capture — 8,690 rounds, 2026-08-01 16:37 → 2026-08-02 02:24 UTC

Merge procedure: colors normalized (rgb() variants → canonical blue/purple/pink by hue), timestamps normalized to ISO-8601 Z, deduped on (timestamp, multiplier), sessionized at 30-minute gaps. Result: **177,905 unique rounds, 33 sessions**.

This rebuild ingested the same merged SQLite dataset row-for-row (bulk import in timestamp order), preserving per-source provenance — the Sources page shows the same three counts, and the Calibration Lab verifies them.

## Reference constants (from DATA_CALIBRATION.md)

- Mean 10.604× · median 2.01× · max 58,938.65×
- Measured exceedance: P(≥2×) = 50.4651% · P(≥3×) = 33.1536% · P(≥5×) = 18.6779% · P(≥10×) = 9.2167% · P(≥25×) = 3.6834% · P(≥50×) = 1.8763% · P(≥100×) = 0.9410% · P(≥250×) = 0.3654% · P(≥500×) = 0.1748% · P(≥1000×) = 0.0922% · P(≥1.5×) = 66.4281%
- Power-law tail: p(m ≥ t) = 0.9497 · t^-1.006 (log-log OLS on ≥25×)
- Band transition matrix: χ² 837.6, 25 dof → NOT independent (p < 0.001)
- Post-high effect: after ≥10× rounds, P(next ≥2×) = 49.4% (n = 16,397)

## Live verification

`GET /api/v1/calibration` recomputes every constant from the database and returns them next to the reference values with per-constant match flags (1% tolerance). The Calibration Lab (`/dashboard/calibration`) renders the check table — at delivery, **all constants match** (delta 0.000–0.001% on the exceedance set, tail exponent b and post-high rate included).

Model application (inherited): `calibratedForecast` blends baseline + streak + transition + hot-hand rates in logit space with sample-size shrinkage; `walkForwardEval` verifies every prediction against strictly earlier data only. The Range Lab embeds the full 12-threshold reference verdicts (RANGE_LAB_REPORT.md) beside the live recomputation.
