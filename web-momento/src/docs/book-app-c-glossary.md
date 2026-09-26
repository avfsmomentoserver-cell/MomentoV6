# Appendix C · Glossary

For a no-math companion, see `InvestigationSuite@decomputation:docs/newbie-glossary.md`.

| Term | Meaning |
|---|---|
| **ACI** | Adaptive Conformal Inference: online adjustment of interval width so coverage holds over time (Ch 08) |
| **Anchor** | A local peak round (above its previous neighbour, ≥ its next) together with its surrounding troughs. It can be *forming* or *released* (Ch 09) |
| **Band (v6)** | One of 6 buckets: <1.5, 1.5–2, 2–5, 5–10, 10–100, 100+ |
| **Band (V5 Layer 1)** | One of 10 named bands: dust, floor, low, base, mid, high, ignition, moonshot, mega, cosmic |
| **Bait** | State: a single spike inside weakness |
| **Baseline** | The engine that forecasts measured long-run band shares; everything else is scored against it |
| **Brier score** | Mean squared error of probability forecasts; lower is better |
| **BSS** | Brier Skill Score = 1 − BS/BS_ref |
| **BH / FDR** | Benjamini–Hochberg control of the false discovery rate across many tests |
| **Ceiling** | A resistance level touched ≥3 times within 5% tolerance |
| **Collapse** | State: descending ceilings, energy draining |
| **Confidence (earned)** | 0.35·conviction + 0.25·agreement + 0.40·hitRate; capped at MEDIUM without ≥3% skill |
| **Decomputation** | Breaking a forecast into human-readable dimensions (Ch 12) |
| **DNA** | An 8-round band signature; analogue matching at ≥85% similarity |
| **Durable Object (DO)** | A Cloudflare single-instance stateful object with SQLite storage |
| **Earned mixture** | Engine weights w ∝ prior·exp(−n_eff·(L_c − L_best)) |
| **Energy** | Layer 3: snuffed, damp, steady, charged, surging, explosive, runaway |
| **ETA** | Expected rounds (or time) until a threshold is next hit |
| **Exhaustion** | State: upside spent |
| **Expected / Range / Reach** | Mixture median / p25–p75 / p90 |
| **Hedge** | The exponential-weights online expert aggregation family |
| **Hill estimator** | Tail-index estimator for heavy-tailed data |
| **Hit points** | Time-bucketed candles with mega splitting (Ch 09) |
| **Ignition** | State: compression released |
| **κ (kappa)** | Calibration multiplier clamp(0.6 + h, 0.6, 1.4) for displayed signal confidence |
| **KM** | Kaplan–Meier survival estimator |
| **Ladder** | A run of consecutive climbing rounds within a range |
| **Ledger** | Append-only store of predictions and their resolutions, with running sums |
| **Log-score / log-loss** | −log P(observed band); strictly proper |
| **Mega Pressure** | Index of time since a mega round relative to the expected wait (proposed redefinition: KM percentile) |
| **MKI / MKC** | Momento Knowledge Core |
| **Moonshot** | A round ≥10× (V5 threshold); also the state "high band cleared" |
| **Points** | 100 + 30·log₂(m) |
| **PIT** | Probability integral transform; uniform when calibrated |
| **Shelf** | State: flat variance, coiling |
| **Skill vs baseline** | 1 − L_model/L_baseline on out-of-sample rounds: the one number |
| **STRIDE (AI)** | Strategic Time-series Reasoning Injected via Distilled Embeddings |
| **STRIDE (security)** | Spoofing, Tampering, Repudiation, Info disclosure, DoS, Elevation of privilege |
| **Tape** | The recorded sequence of rounds for a source |
| **TSFM** | Time-series foundation model (e.g. Chronos-2) |
| **Wilson interval** | Confidence interval for a proportion that stays well-behaved at small n |
| **Block bootstrap** | Resampling contiguous blocks of rounds to get CIs that respect dependence (Ch 08) |
| **CUSUM** | Cumulative-sum change detector used for source fingerprinting (F-03) |
| **Discrete-law PIT** | Randomised PIT for values floored to 0.01: u ~ U(F(x), F(x + 0.01)) (Ch 13) |
| **Fractional Kelly** | Stake f = κ·(p·x − 1)/(x − 1) with κ ≤ 0.25; zero when p·x ≤ 1 (Ch 11) |
| **Hash chain** | Each ledger row stores sha256(previous hash ‖ row), so any edit breaks the chain (F-18) |
| **HMAC ingest** | Collector batches signed with a per-collector key, timestamp and nonce (Ch 17) |
| **Hibernation (DO WebSocket)** | Durable Objects keep sockets open while evicted from memory (Ch 16) |
| **IBS** | Integrated Brier score for survival curves (Ch 10) |
| **Pinball loss** | Quantile loss max(q·e, (q − 1)·e) (Ch 15) |
| **Planted power check** | Injecting a known effect into data to prove a test can detect it (Ch 12) |
| **RRF** | Reciprocal rank fusion: Σ 1/(k + rank) over result lists (Ch 14) |
| **Sleeping experts** | Mixture members that may abstain without penalty (Ch 07) |
| **Void window** | A ledger window excluded from scoring because of a gap or failed verification (Ch 08, F-01) |

