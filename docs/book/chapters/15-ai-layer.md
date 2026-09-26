# 15 · AI Layer: STRIDE, TSFMs & Agents

The AI layer covers three kinds of work:
- **learned forecasters:** foundation models, fine-tuning and STRIDE;
- **classic ML helpers:** pattern learners, optimisers and feature importance;
- **agents** that build and operate the platform.

This chapter reads each implementation closely. The main result is that STRIDE is **a scaffold, not a model**: its TSFM wrappers return random tensors. The chapter then gives a staged plan in which every learned model is just another engine on the ledger (Ch 07–08).

## 15.1 STRIDE as coded (`MomentoFresh@feature/stride-integration:backend/momento/stride/`)
STRIDE stands for "Strategic Time-series Reasoning Injected via Distilled Embeddings". The design:
1. Distil reasoning traces from a teacher LLM into a small student LLM.
2. Project the student's hidden states into the TSFM embedding space.
3. Fuse them with the time-series embeddings.
4. Train with cross-entropy (reasoning) plus quantile loss (forecast).

| File | Lines | Content |
|---|---|---|
| `forecasting/quantile_loss.py` | 36 | `QuantileLoss(quantiles=[0.1,0.5,0.9])`: mean of max(q·e, (q−1)·e) (pinball loss), plus `MultiQuantileLoss` with weights |
| `forecasting/tsfm_integration.py` | 69 | `TSFMWrapper` ABC; `Chronos2Wrapper`, `TimerS1Wrapper` (embedding_dim 512, horizon 96) |
| `projection/latent_projection.py` | 23 | `LatentProjection(4096 → 512)`: Linear plus dropout 0.1 |
| `projection/fusion.py` | 49 | `FusionOperator`: PREPEND, ADD, CONCAT, SUBSTITUTE |
| `reasoning/teacher_llm.py` | 29 | `TeacherLLM(model_name="gemini-3.1-pro")` |
| `reasoning/student_llm.py` | 61 | `StudentLLM("google/gemma-3-4b-it")` with LoRA r = 8, α = 32 on q_proj/v_proj |
| `reasoning/distillation.py` | 23 | Token cross-entropy, `distill_reasoning` |
| `train.py` | 124 | `train_stride`, `forecast_with_stride`, save/load |

### 15.1.1 Findings
- **A1 · The TSFM wrappers are stubs.**
  - `Chronos2Wrapper.get_embeddings` returns `torch.randn(batch, seq_len, 512)`.
  - `decode` returns `torch.randn(batch, horizon, variates)`.
  - `self.model = None`, and nothing loads Chronos-2 weights.
  - `TimerS1Wrapper` follows the same pattern.

  Every STRIDE forecast is therefore random noise.
- **A2 · The teacher is mocked.**
  - `generate_reasoning` returns a fixed dict: trend increasing or decreasing from `X[-1] > X[0]`, seasonality "none", and **confidence 0.95** on every call.
  - No API call is made.
- **A3 · Training cannot learn.** In `train_stride`, `Y_hat = tsfm.decode(E_fused)` is a fresh random tensor with no graph connection to `projection`. So `(beta * q_loss).backward()` either raises (no grad) or updates nothing. There are two further problems:
  - `ce_loss` and `alpha` are defined but never used, so there is no distillation term.
  - The optimiser only covers `projection.parameters()`, which leaves the LoRA student frozen.
- **A4 · Dimension mismatch risk.** `LatentProjection(4096, …)` hard-codes 4,096. The input dimension must be read from the student's `config.hidden_size`. Hard-coding it breaks when the student model changes.
- **A5 · Silent fallback.** `StudentLLM.__init__` wraps model loading in `except Exception:` and sets `model = None`, so a missing model fails silently.

None of this is a criticism of the idea. The module is a correct skeleton of the paper's structure, and the missing parts are exactly the real model calls. It needs to be labelled as such in the platform, and it must never be registered as an engine until A1–A3 are fixed.

## 15.2 Classic ML as coded
### 15.2.1 Inventory
- **`MomentoV5@v6:backend/features/ai/pattern_learner.py`** (479 lines): `MoonshotPatternLearner`, with RandomForest/GradientBoosting if sklearn is present.
- **`optimizer.py`** (247 lines): `BacktestOptimizer.suggest_session_gap / suggest_window_size / suggest_feature_toggles / suggest_backtest_config`, based on stored backtest results.
- **`feature_importance.py`** (197 lines): `FeatureImportanceAnalyzer` with SHAP if available.
- **Others:**
  - the V5 logistic `ml` engine (Ch 07);
  - the ShapeShifters v2 pipeline (HMM, GMM, Pareto Bayesian);
  - `math_models.py` regimes;
  - the InvestigationSuite XGBoost/LightGBM pipeline (Ch 12, finding R1).

### 15.2.2 Finding A6: the moonshot learner's negatives come from the start of the tape
`extract_features(rounds, window=20)` works like this:
- **Positives:** the 20 rounds before **every** round with m ≥ 10, spread across the whole tape.
- **Negatives:** `non_moonshot_indices[:len(moonshot_indices)]`, the **first** N non-moonshot rounds in the tape.

So the positives cover all sessions and times, while the negatives are concentrated at the beginning. Any drift in the tape looks like a pattern, and any feature that correlates with position (session, time of day, collector version) looks predictive. Three more problems compound this:
- The windows overlap.
- The classes are balanced to 50/50, while the true base rate is 9.22% (Appendix D), so raw accuracies are not comparable to the tape.
- Nothing splits train and test by time.

**Fix:**
1. Sample negatives uniformly at random across the same sessions as the positives, or better, use every round as a sample with label 1[m ≥ 10].
2. Split by session (grouped, time-ordered).
3. Report log-loss and Brier against the base-rate model.
4. If classes are balanced for training, correct the probabilities afterwards with the prior shift p' = p·π/(p·π + (1−p)(1−π)·r), where r is the sampling ratio.

This is the same rule as Ch 12: every learner goes through the Experiment Registry with a planted power check.

### 15.2.3 SHAP and optimiser outputs
SHAP values explain a model. They are not evidence that a model has skill. The Workbench (F-09) should show SHAP only for engines with positive ledger skill, next to the CI. `BacktestOptimizer` suggestions (window size, session gap) are parameter searches. Each suggestion counts as a family of tests for BH (Ch 12), and a suggested value is applied only through a registered experiment.

## 15.3 Agents as coded
- **`MomentoV5/.devin`:** 11 agent definitions and the workflows `/standard-task`, `/new-feature`, `/architecture-review`, `/deployment`.
- **MDOS:** the Momento Development Operating System and the Momento Constitution (rules for agents working on the repos).
- **`momento-core@momento-v6-devin-megaplan`:** the v6 plan for agents.
- **`momentocore2`:** an agent-swarm design (Kafka, Weaviate, K8s). It is a design document, not running code.
- **`InvestigationSuite src/agents`:** ingest, monitor and retrain agents around the ML pipeline.

These are **build-time** agents. Operating agents need stricter rules, because they touch live forecasts.

## 15.4 Reference design
### 15.4.1 TSFM as an engine (Stage A)
Chronos-2 is a 120M-parameter, encoder-only foundation model for zero-shot forecasting. It handles univariate, multivariate and covariate-informed tasks ([Hugging Face model card](https://huggingface.co/amazon/chronos-2); [Amazon Science](https://www.amazon.science/blog/introducing-chronos-2-from-univariate-to-universal-forecasting)). The official package exposes `Chronos2Pipeline.from_pretrained("amazon/chronos-2")` and `predict_df(context_df, future_df=…, prediction_length=…, quantile_levels=[…], id_column, timestamp_column, target)` ([chronos-forecasting](https://github.com/amazon-science/chronos-forecasting)).

```python
# sidecar/tsfm.py : FastAPI sidecar, batch per N rounds, cached per (source, round_id)
from chronos import Chronos2Pipeline
pipe = Chronos2Pipeline.from_pretrained("amazon/chronos-2", device_map="cpu")
QL = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95]

def forecast(source_id: str, rounds: list[dict], h: int = 10):
    df = pd.DataFrame({"id": source_id,
                       "timestamp": pd.to_datetime([r["ts_ms"] for r in rounds], unit="ms"),
                       "target": np.log([max(r["m"], 1.0) for r in rounds])})  # log multiplier
    q = pipe.predict_df(df, prediction_length=h, quantile_levels=QL,
                        id_column="id", timestamp_column="timestamp", target="target")
    return quantiles_to_bands(q, edges=[1.5, 2, 5, 10, 100])     # 6-band distribution per step
```
- **Target:** log multiplier. It is heavy-tailed, so work on the log scale and map back. Also try the points series (Ch 05).
- **Band conversion:** interpolate the quantile function to get P(M < edge) at each band edge. Beyond the 5% and 95% quantiles, use the Ch 06 tail (Pareto α ≈ 1). Quantile interpolation cannot see the tail.
- **Timestamps:** rounds are irregular in time. Use the round index as the time axis, or supply a regular synthetic timestamp, and keep real time as a covariate.
- **Registration:** `engine_id = tsfm_chronos2@<model revision>`. It enters the earned mixture at the prior weight, and ledger rules (Ch 08) apply unchanged.
- **Budget:** batch every N = 5 rounds, with results cached. The Worker never waits on the sidecar. If the cache is stale, the engine abstains (Ch 07 abstain semantics).

### 15.4.2 Fine-tune (Stage B), then STRIDE (Stage C)
1. **Stage B:** fine-tune Chronos-2 on the Momento tape with pinball loss.
   - Use a strict time split: train on sessions 1–k, validate on k+1…k+j, test on held-out later sessions.
   - Early-stop on validation only (finding R1 in Ch 12 describes the mistake to avoid).
2. **Stage C:** STRIDE with the fixes:
   - a real TSFM encoder and decoder, so the fusion output feeds the decoder in the graph;
   - the loss α·CE + β·pinball, with both terms active;
   - projection dimension from `config.hidden_size`;
   - a trainable LoRA student.

   The reasoning input should be Momento's own **Layer-8 sentences and signal readings** (Ch 05). They are on-domain, deterministic and cost nothing, unlike a general teacher LLM.
3. **Promotion rule:** each stage replaces the previous one only if the held-out log-score difference has a block-bootstrap CI above 0 (Ch 08 §8.4.4). The comparison is against the previous stage and against the base-rate model.

### 15.4.3 Regimes as covariates
Fit a Gaussian HMM (2–4 states) on (log m, rolling volatility) per source using `hmmlearn` ([hmmlearn](https://github.com/hmmlearn/hmmlearn); [LSEG regime guide](https://developers.lseg.com/en/article-catalog/article/market-regime-detection)). Use the **filtered** posterior only; smoothed posteriors look ahead. Use it as:
- a covariate for the hazard model (Ch 10);
- the gating variable for regime-aware weights (F-13): per-regime mixture weights learned on the ledger.

Regime labels count as "real" only if the per-regime weights beat the pooled weights out of sample.

### 15.4.4 Operating agents
| Agent | Reads | Writes | Cannot |
|---|---|---|---|
| Monitor | ledger, ingest health, fairness audit | alerts, MKI `observation` | change weights, engines or config |
| Researcher | MKI questions and bugs | experiment specs (draft) | run live, promote |
| Narrator | explanation JSON (F-35) | Layer-8 text | invent numbers: every figure must appear in the input |
| Reviewer | experiment results | draft decision for a human | move MKI objects past `validating` (Ch 14 rule) |

Rules:
- Agent output is text or a draft. Only the ledger changes weights, and only a human promotes.
- For the Narrator, a checker compares every number in the output with the input JSON and rejects any mismatch.

## 15.5 Tests
| Test | Assertion |
|---|---|
| `no_stub_engines` | Registry refuses an engine whose forecasts on a fixed input vary between calls with the same seed (catches randn stubs, A1) |
| `grad_flows` | After one STRIDE step, projection and LoRA parameters change (A3) |
| `hidden_dim` | Projection input dimension = student `config.hidden_size` (A4) |
| `negatives_sampled` | Positive and negative windows have matching session distributions (A6) |
| `tsfm_bands_sum` | Band probabilities sum to 1 and are monotone across horizons |
| `tsfm_null` | On a simulated i.i.d. tape, TSFM ledger skill vs base rate has a CI containing 0 (no leakage) |
| `narrator_numbers` | Every number in narrated text appears in the input |

## 15.6 Measurement
- Per-engine held-out log-score skill with CI;
- earned mixture weight over time;
- sidecar latency p95 and cache hit rate;
- the share of rounds where the TSFM abstained;
- Narrator rejection rate.

## 15.7 Features
- **F-12 Engine Marketplace** hosts the TSFM and STRIDE engines with their ledger cards.
- **F-13 Regime-aware weights** uses the HMM posterior.
- **F-35 Explain-this-forecast** uses the Narrator.
- **F-37 Ask Momento** (Ch 14).
- The **Researcher agent** feeds F-34.
