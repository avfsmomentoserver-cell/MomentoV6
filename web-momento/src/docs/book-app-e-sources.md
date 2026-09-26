# Appendix E · Sources

These are the external technical references cited in this book, regenerated from every chapter link. Internal sources are cited inline as `repo@branch:path`.

| Reference | First cited | URL |
|---|---|---|
| binomial proportion CI | Ch 03 | https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval |
| Playwright network docs | Ch 03 | https://playwright.dev/docs/network |
| DO limits | Ch 04 | https://developers.cloudflare.com/durable-objects/platform/limits/ |
| Workers limits (128 MB isolate memory) | Ch 04 | https://developers.cloudflare.com/workers/platform/limits/ |
| AdaHedge (de Rooij et al., JMLR 2014) | Ch 07 | https://jmlr.org/papers/v15/rooij14a.html |
| Durable Objects alarms | Ch 04 | https://developers.cloudflare.com/durable-objects/api/alarms/ |
| Jain & Chlamtac | Ch 04 | https://www.cse.wustl.edu/~jain/papers/ftp/psqr.pdf |
| PITR | Ch 04 | https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api |
| Rules of Durable Objects | Ch 04 | https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/ |
| SQLite storage API | Ch 04 | https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/ |
| False discovery rate | Ch 05 | https://en.wikipedia.org/wiki/False_discovery_rate |
| heavy-tailed distributions | Ch 06 | https://en.wikipedia.org/wiki/Heavy-tailed_distribution |
| tail-index estimation, INRIA | Ch 06 | https://inria.hal.science/hal-03235031v1/file/slides_RESIM_2021.pdf |
| AdaHedge / specialized experts, arXiv:1808.00741 | Ch 07 | https://arxiv.org/pdf/1808.00741 |
| Gneiting-style lecture notes, Berkeley | Ch 07 | https://www.stat.berkeley.edu/~ryantibs/statlearn-s23/lectures/calibration.pdf |
| GrowingHedge, PMLR v76 | Ch 07 | https://proceedings.mlr.press/v76/mourtada17a/mourtada17a.pdf |
| online ensembles for time series | Ch 07 | https://magittan.github.io/static/Online_Ensembles/Implementing_Online_Ensemble_Learning.pdf |
| proper scoring rules survey | Ch 07 | https://arxiv.org/html/2504.01781v3 |
| 0..i)` *after* round i arrives, and stamps `created_ms = target.tsMs` | The computation is causal (no look-ahead), but the record is not a commitment: a code change or re-ingest changes history, and bulk imports score only the last 300 rounds | Commit the forecast for round i+1 **at ingest of round i** (the forecast the user actually saw), hash-chained (§8.4.5). Keep reconstruction as an explicitly labelled *backtest* |

V1 is the most important. Until it is fixed, window-level skill should not be shown as evidence of skill. The per-round mixture skill (`intel_calibrations`, mix vs base log-loss) is not affected, because there the baseline is a per-round band distribution compared with a per-round outcome.

Also note that `hits = (p ≥ 0.5) === actual` is accuracy at a 0.5 cut. For rare targets that cut makes "always predict no" look excellent. Show it only next to the base rate.

## 8.3 Target design: what the ledger must answer
| Question | Metric | Needs |
|---|---|---|
| Is the forecast better than the measured rate? | Log-score and Brier skill vs a **like-for-like** baseline, with CI | V1 fix, bootstrap |
| Are the probabilities honest? | Reliability diagram, reliability term, PIT uniformity | Binned sums |
| Does the model discriminate? | Resolution term, AUC for binary targets | Binned sums |
| Do the ranges cover? | Empirical coverage of p25–p75 and p10–p90 | Coverage counters, ACI |
| Is the record trustworthy? | Hash chain, void rate, commitment time before outcome | F-18 |

## 8.4 Reference design
### 8.4.1 Score decomposition
The Brier score decomposes into **reliability − resolution + uncertainty** ([NOAA SWPC verification primer | Ch 08 | https://www.spaceweather.gov/sites/default/files/images/u30/Ensemble%20Forecast%20Verification.pdf |
| ACI multi-step, arXiv:2409.14792 | Ch 08 | https://arxiv.org/html/2409.14792v1 |
| Adaptive conformal predictions for time series | Ch 08 | https://www.alphaxiv.org/abs/2202.07282 |
| conformal time-series survey | Ch 08 | https://www.alphaxiv.org/abs/2511.13608 |
| Dawid 1984 via Czado et al., Biometrics | Ch 08 | https://academic.oup.com/biometrics/article/65/4/1254/7333505 |
| ECMWF ensemble verification | Ch 08 | https://www.ecmwf.int/sites/default/files/elibrary/2005/15865-verification-ensembles.pdf |
| PIT miscalibration diagnosis, ESANN 2024 | Ch 08 | https://www.esann.org/sites/default/files/proceedings/2024/ES2024-15.pdf |
| docs | Ch 09 | https://tradingview.github.io/lightweight-charts/docs |
| GitHub | Ch 09 | https://github.com/tradingview/lightweight-charts |
| discrete hazard, UW STAT 425 notes | Ch 10 | https://faculty.washington.edu/yenchic/26W_stat425/Lec5_survival.pdf |
| IBS, Graf et al. via scikit-survival | Ch 10 | https://scikit-survival.readthedocs.io/en/stable/api/generated/sksurv.metrics.integrated_brier_score.html |
| Kaplan–Meier overview, MedCalc | Ch 10 | https://www.medcalc.org/en/book/kaplan-meier.php |
| survival analysis basics, PMC | Ch 10 | https://pmc.ncbi.nlm.nih.gov/articles/PMC2394262/ |
| Kelly explainer, Paul Butler | Ch 11 | https://explore.paulbutler.org/bet/ |
| Stanford notes | Ch 11 | https://crypto.stanford.edu/~blynn/pr/kelly.html |
| Genovese tutorial | Ch 12 | https://www.stat.cmu.edu/~genovese/talks/hannover1-04.pdf |
| pgvector | Ch 14 | https://github.com/pgvector/pgvector/ |
| RRF, Cormack et al. 2009 | Ch 14 | https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf |
| Amazon Science | Ch 15 | https://www.amazon.science/blog/introducing-chronos-2-from-univariate-to-universal-forecasting |
| chronos-forecasting | Ch 15 | https://github.com/amazon-science/chronos-forecasting |
| hmmlearn | Ch 15 | https://github.com/hmmlearn/hmmlearn |
| Hugging Face model card | Ch 15 | https://huggingface.co/amazon/chronos-2 |
| LSEG regime guide | Ch 15 | https://developers.lseg.com/en/article-catalog/article/market-regime-detection |
| DO WebSockets | Ch 16 | https://developers.cloudflare.com/durable-objects/best-practices/websockets/ |
| hibernation example | Ch 16 | https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/ |
| MDN SSE | Ch 16 | https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events |
| TradingView Lightweight Charts | Ch 16 | https://tradingview.github.io/lightweight-charts/ |
| MDN threat modeling frameworks | Ch 17 | https://developer.mozilla.org/en-US/docs/Web/Security/Threat_modeling/Frameworks |
| Microsoft Threat Modeling Tool threats | Ch 17 | https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats |
| OWASP Password Storage | Ch 17 | https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html |
| Access Durable Objects Storage | — | https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/ |
