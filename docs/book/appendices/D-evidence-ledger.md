# Appendix D · Evidence Ledger

These are measured results recorded in the repositories, quoted as documented. Use them as priors and baselines when you invent or evaluate features. Every new feature should add a row here (or, better, an MKI `benchmark` object).

| # | Result | Dataset | Location |
|---|---|---|---|
| D-1 | 177,905 rounds, 33 sessions; mean 10.604×, median 2.01×, max 58,938.65× | avfs.db 150,410 + momento_prev 18,805 + project 8,690 | `MomentoV5@v6.3:docs/markdown/calibration-report.md` |
| D-2 | P(≥2) 50.47% · P(≥10) 9.22% · P(≥100) 0.941% | D-1 | same |
| D-3 | Tail fit P(≥t) ≈ 0.9497·t^−1.006 | D-1 | same |
| D-4 | Band-transition χ² = 837.6 on 25 dof | D-1 | same |
| D-5 | DNA similarity matching: 49.32% accuracy vs 84.12% base rate (−34.80 pp); similarity scores 0.95–0.99 show low discrimination | research set | `momento-core MOMENTO_V6_SPECIFICATION.md §1.2`, `MomentoFX DNA_IMPLEMENTATION_PLAN.md` |
| D-6 | Time-based patterns: skill −0.0044; precision/recall 0.0000 | research set | same |
| D-7 | Pressure ≥70%: +3.53% edge, not statistically significant | research set | same |
| D-8 | Band exhaustion / multiband sequences: no predictive power detected | research set | same |
| D-9 | Mega plan: 9 strategies × targets 5/10/20/50× × horizons 3/5/10; no strategy meaningfully outperforms the random baseline at 10×/5; top raw accuracies (e.g. streak 50×/3 at 90.38%) come with F1 ≈ 0.08 because the targets are rare | 60,215 rounds | `MomentoFX research/comprehensive_mega_plan_results.md` |
| D-10 | Dynamic Confidence strategy with profit capping: 17.6% ROI, 74.7% of cap used (single backtest; verify on held-out real sessions before relying on it, per Ch 11 §11.2.4) | backtest | `MomentoFX research/PROFIT_CAPPING_REPORT.md` |
| D-11 | The shipped exponential survival estimate claimed ~94% for 2×, while the measured rate was ~48.5%. Replaced by empirical + Hill tail | terminal tape | `ShapeShifters@momento-terminal-replace:backend/momento/survival.py` docstring |
| D-12 | Decomputation: 73 tests passing after the 8-dimension expansion | synthetic demo (50 users / 1,214 events) | `InvestigationSuite@decomputation` commit `d132acc` |


## D.2 Measurements made for this book (null simulations and code reading)
These rows come from simulations on synthetic fair tapes (i.i.d., multiplier law (1 − h)/m, floored to 0.01) or from reading the code. They describe how the **tools behave**, not the tape. Every one can be reproduced with the snippets in the cited chapter.

| ID | Measurement | Setting | Chapter |
|---|---|---|---|
| D-13 | 1/medianGap overstates the event rate by about +44% (median gap ≈ ln 2 / p); `rangeForecast`'s 50/50 blend by about 22% | null tape | 09 (M1) |
| D-14 | Median-of-3 momentum labels "accelerating" 36.6–50% of the time | null tape | 09 (M2) |
| D-15 | Anchors make up 33.3% of rounds; P(next-10 mean > global) = 10.5% | null tape | 09 (M3) |
| D-16 | Some band is "overdue" 70.9% of the time; the 10× band 26.1% | null tape | 10 (P1) |
| D-17 | pressurePct = run/median·50 reads 99 about 25% of the time | null tape | 10 (P2) |
| D-18 | KS vs continuous 1 − 1/m rejects fair floored tapes: p < 10⁻⁴ at n = 50,000 and 177,905 | 5k–178k rounds | 13 (F1) |
| D-19 | Discrete-law randomised PIT KS: 2.5% rejections at α = 0.05 over 40 fair tapes of 177,905 (median p = 0.48) | same | 13 |
| D-20 | Convention solver: one-round spurious match chance ≈ 19% (85 candidates, display near 2.00×); ≈ 10⁻⁶ with 3-round intersection | analytic | 13 |
| D-21 | STRIDE TSFM wrappers return `torch.randn`; the teacher is mocked at confidence 0.95; training has no gradient path | code | 15 (A1–A3) |
| D-22 | The moonshot learner takes negatives from the first N non-moonshot rounds of the tape | code | 15 (A6) |
| D-23 | Unauthenticated `/ingest` with `CORS: *`; default operator `operator@momento.local`; plaintext tokens; PBKDF2 100k | code | 17 (S-1 to S-6) |
| D-24 | 58 `refetchInterval` polling timers in the v6.3 console | code | 16 (U1) |
| D-25 | MKI search is `ILIKE` AND-match ordered by `created_at`; pgvector is backlog item 2.2 | code | 14 |
| D-26 | Canonical tape per-threshold t·P(≥t): 1.009 / 0.922 / 0.941 vs 0.97 expected at h = 3%; z = +16.6 / −6.8 / −1.3 | canonical summary | 01 (O1) |
| D-27 | Branch census (commits, files, dates per branch) and blob overlap across the 12 repos | git, 26 Sep 2026 | 02 (G1–G5) |
| D-28 | Timestamp-less batches (I1): 90.7% of rounds kept at n = 50 (P(≥2) +3.8 pp); 58.0% at n = 500 (+21.7 pp) | null tape | 03 |
| D-29 | v6.3 read path: 117 B/row, full-tape read 259 ms / 29.3 MB heap at 178k rows; per-source MAX(id) 7.5 ms → 0.009 ms with a (source, id) index | `/tmp/b.db` benchmark | 04 (T5, T6) |
| D-30 | Linguistic shape labels fire on noise (ramp/slide 72% of windows at W = 8); DNA confidence at its maximum in 94.3% of calls | null tape | 05 (L1–L4) |
| D-31 | χ² mechanisms on fair tapes: pooling 28.7, source blocks 34.4, batch collapse ≤ 35.3; 1% / 3% / 5% duplicates give 104 / 712 / 2,222 | null tape, n = 177,905 | 06 |
| D-32 | `clean_data.csv` (60,215): t·P 0.968 / 0.962 / 0.973; χ² 54.5 → 26.1 after removing 484 near-simultaneous duplicates | repo tape | 06 (N6) |
| D-33 | `avfs.db` (150,416): χ² 869; a single 7,696-row microsecond-timestamp burst (P(≥2) 91%) causes it; the clean 142,680 rows give t·P 0.973 / 0.965 / 0.988 and χ² 27.5 | repo tape | 06 (N6, N7) |
| D-34 | Walk-forward single-split false acceptance: 12.3% at N = 1,000; 0.5% at 5,000 | null tape | 06 (N4) |
| D-35 | Earned mixture log-score skill on fair data: v6.3 −0.214%, Hedge + fixed share 10⁻² −0.174%, 10⁻³ −0.031%, Bayes −0.002%; a no-skill engine wins 14% of 60-round windows | null tape | 07 (E7, E8) |

## Reading notes
- **D-2 vs the usual law.** P(≥2)·2 = 1.009 > 1 is the strongest single hint of capture bias (F-01). D-33 shows the same signature in a committed tape, caused by one contaminating batch; treat D-1 to D-4 as provisional until they are recomputed per batch.
- **D-5 / D-9.** Raw accuracy on rare targets is misleading, because always predicting "no" scores high. Use log-score or Brier skill vs base rate, as Accuracy Engine v2 already does.
- **D-11.** This is a good example of why distributional calibration (PIT, Ch 08) belongs in CI.
