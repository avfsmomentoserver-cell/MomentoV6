# 14 · Momento Knowledge Core (MKI / MKC)

MKI (package name `mkc`) is Momento's **memory of what is known and why**. This book is effectively a manual MKI extraction. This chapter:
- documents what the code does today: the lifecycle state machine, provenance, extraction, contradiction detection and search;
- corrects one expectation (semantic search is a backlog item, not shipped code);
- specifies how MKI connects to the running platform, so experiments, engines and vocabulary move through the lifecycle automatically.

## 14.1 What exists (`MKI@main`, `MKI@v2`)
### 14.1.1 Stack and history
- **Backend:** FastAPI (`backend/src/mkc/api/app.py`, routers `ai, books, context, decisions, documentation, experiments, ingest, knowledge, library, reports, research, research_tasks, search`), SQLAlchemy, Alembic migrations, Postgres, and a web UI.
- **Migrations:** `initial_schema`, `add_documentation_tables`, `add_research_tables`, `add_book_tables`.
- **`MKI@v2`** holds the phase history:
  - Phase 3, AI-orchestrated documentation (`80d4270`);
  - Phase 4, scheduled research workflows (`91c5fc1`);
  - Phase 5, book production with multi-format export (`92bd9ca`);
  - Phase 6, library management with analytics and graph visualisation (`4b96431`);
  - a fix for extractor UUID and source_id handling in markdown ingestion (`09e5d0d`).
- **Docs:** `ARCHITECTURE`, `KNOWLEDGE_MODEL`, `API_REFERENCE`, `SECURITY_MODEL`, `THREAT_MODEL` (STRIDE), `OPS_RUNBOOK`, `DATABASE_AUDIT` and `PRODUCT_BACKLOG`. Reports: E2E demonstration, fix verification, implementation plan, project knowledge and research gaps (all dated 2026-09-21).

### 14.1.2 Knowledge model: 31 object types (`KNOWLEDGE_MODEL.md §1`)
- **Ingested:** document, source, dataset, glossary_term.
- **Claims:** fact, claim, hypothesis, question, theory, observation, insight, research, paper, experiment.
- **Engineering:** decision, requirement, module, dependency, implementation, benchmark, bug, risk, tech_debt, plan, task, roadmap_item.
- **Measurement:** metric.
- **People and projects:** person, project, subsystem.

### 14.1.3 Lifecycle (`backend/src/mkc/core/lifecycle.py`)
```
HAPPY_PATH = idea → question → hypothesis → researching → experiment → observed
             → validating → validated → implemented → production
TERMINAL_FROM_STATES = {hypothesis, researching, experiment, observed, validating, validated}
TERMINAL_STATES      = {contradicted, rejected, deprecated, superseded}      # sinks, no outgoing edges
HUMAN_REQUIRED_STATES = {validated, implemented, production}
AUTOMATED_ACTORS     = {auto, bot, system, pipeline, ingest}
unknown → any happy-path state (classification is not a maturity claim)
```
`validate_transition` enforces four rules:
1. Both states must be known.
2. The edge must exist in `LIFECYCLE_TRANSITIONS`.
3. Self-transitions are rejected.
4. Entering validated, implemented or production requires a **human** actor.

Rejected transitions raise `InvalidTransition`, which the API answers with 409 and the allowed next states. Accepted transitions must be written to `audit_log`. Terminal states are never re-promoted: new evidence creates a new object that references the old one.

Two properties matter for Momento:
- **Automation can bring an idea to `validating` but never to `validated`.** That is the right split: the Experiment Registry (Ch 12) can move a hypothesis to `observed`/`validating` automatically, and a human signs off promotion.
- **Happy-path edges only go forward one step.** A hypothesis that passes an experiment must go through researching → experiment → observed → validating. The integration below does that as a scripted sequence of audited transitions, not a jump.

### 14.1.4 Provenance and extraction
Every object carries provenance: source_type, source_id, file_path, **commit_hash**, author, date, extraction_method and original_text (the audit anchor). Confidence is kept separate from lifecycle.
- `ingest/git_collector.py` (`GitRepoCollector`) runs git with a 120 s timeout. It enforces `_is_safe_path` against path traversal, bounds file reads, hashes each file (`_sha256_file`), parses the commit log and persists source plus artifacts.
- `ingest/markdown_collector.py` and `chatgpt_importer.py` handle other inputs.
- `parsing/extractor.py` (`KnowledgeExtractor`):
  - chunks text;
  - classifies each chunk by marker counts per doc type;
  - pulls code definitions and text entities;
  - assigns a `stable_id` per extracted object, which makes re-ingest idempotent;
  - **masks secrets** before storing (`_mask_secrets`). That matters here: `gilabtoke.md` exists in two public repos (Ch 17).
- Extraction never creates objects past `hypothesis` unless an ingested result backs them.

### 14.1.5 Contradictions and insights
`analysis/contradictions.py` (`ContradictionDetector`) builds candidate pairs of claims:
- pairs must share ≥ 3 tokens (`MIN_SHARED_TOKENS`) or mentions;
- at most 50 candidates per object and 12 mentions per object;
- a global budget of 20,000 pairs.

It scores each pair by Jaccard similarity (high ≥ 0.60, medium ≥ 0.35) plus **negation or opposite-term** presence, and gives each pair a deterministic `contradiction_id`. `analysis/insights.py` produces pattern, trend, gap, contradiction and recommendation insights. The backlog's risk R2 names the main risk (false positives erode trust). Its mitigation is severity tiers and human review.

### 14.1.6 Search, as coded
`intelligence/search.py` performs a **token AND-match with `ILIKE '%token%'`** on title and body, plus filters (types, lifecycle states, source types, dates). Results are ordered by `created_at desc, id`, with offset pagination. There is no relevance ranking, and there are no embedding columns in the models or migrations. `ai/providers.py` can generate embeddings (`text-embedding-3-small`, plus a local provider "always used for embeddings"), but nothing stores or queries them.

Vector search is **backlog item 2.2** (`PRODUCT_BACKLOG.md`): "Vector embeddings for knowledge objects using pgvector (if available… otherwise a documented fallback to ranked full-text with a capability flag in `GET /api/v1/status`)", followed by hybrid search in 2.2.2. The acceptance test is ≥ 10 scripted queries where hybrid finds objects that keyword search misses. Risk R9 treats pgvector as optional.

## 14.2 Role in the platform
MKI should be connected to the running platform, not just fed documents:
1. **Experiments (Ch 12) are MKI `experiment` objects.** Verdicts move the linked `hypothesis` through its lifecycle, automatically up to `validating`, with human sign-off after that.
2. **Engines are MKI `implementation` objects** linked to commit hashes. Ledger skill is recorded weekly as `metric` objects (with CI), and each promotion or demotion (F-20) as a `decision`.
3. **Vocabulary tokens (Ch 05) are `glossary_term` objects.** The candidate → validated → formalised lifecycle maps onto MKI states. Formalisation requires the outcome evidence of Ch 05's evidence-gated lifecycle.
4. **Findings in this book** (for example V1 in Ch 08, M1 in Ch 09, F1 in Ch 13) are `bug` objects with file paths and commit hashes. Fixing them links a commit, and the ledger `metric` shows the effect.

### 14.2.1 Mapping table
| Platform event | MKI object | Transition (actor) |
|---|---|---|
| New experiment spec | `experiment` + `hypothesis` (if new) | unknown → hypothesis → researching (auto) |
| Experiment run finished | `observation` with result_json | researching → experiment → observed (auto) |
| Verdict promote | `decision` | observed → validating (auto); validating → validated (human) |
| Engine shadow start | `implementation` | → implemented (human) |
| Engine live | `implementation` | implemented → production (human) |
| Verdict reject | `decision` | → rejected (auto, from observed) |
| Auto-demotion (F-20) | `decision` + `metric` | production object unchanged; a new `observation` records the demotion. Terminal only if retired (→ deprecated, human) |

## 14.3 Reference design
### 14.3.1 Search: ranked full-text first, then hybrid
Step 1, ranked full-text in Postgres. It is cheap, has no new dependency and fixes the unranked ILIKE.
```sql
ALTER TABLE knowledge_objects ADD COLUMN tsv tsvector
  GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
                       setweight(to_tsvector('english', coalesce(body,'')),  'B')) STORED;
CREATE INDEX ko_tsv ON knowledge_objects USING GIN (tsv);
-- query
SELECT id, title, ts_rank_cd(tsv, q) AS r FROM knowledge_objects, websearch_to_tsquery('english', :q) q
WHERE tsv @@ q AND lifecycle_state = ANY(:states) ORDER BY r DESC LIMIT 20;
```
Step 2, vectors with pgvector (backlog 2.2). pgvector supports exact and approximate nearest-neighbour search (HNSW/IVFFlat) inside Postgres ([pgvector](https://github.com/pgvector/pgvector/)).
```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE knowledge_objects ADD COLUMN emb vector(384);          -- local model dimension
CREATE INDEX ko_emb ON knowledge_objects USING hnsw (emb vector_cosine_ops) WITH (m = 16, ef_construction = 64);
```
Step 3, hybrid via **reciprocal rank fusion**: score = Σ 1/(k + rank_i), with k = 60, over the full-text and vector result lists. It needs no score normalisation and is easy to test against the backlog's ≥ 10-query acceptance set ([RRF, Cormack et al. 2009](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)).

### 14.3.2 Continuous ingestion
- Re-ingest **all repos on every push** using a GitHub webhook. `stable_id` plus commit hash make it idempotent. Only files changed in the push are re-extracted.
- Store the `file-master-index.json` state per ingest, as backlog R3 asks, so broken commit links show up as health warnings.
- Run the secret mask on ingest **and** raise a `risk` object whenever a mask fires. MKI then becomes the secret scanner of record for the Momento repos.

### 14.3.3 Ask Momento (F-37)
Add `GET /knowledge/ask?q=`, RAG over MKI, to the operator console. For example: "why was DNA demoted?". Retrieval uses the hybrid search. The answer must cite MKI object ids, and each object cites a commit and a file path. Backlog risk R5's rule, "every report claim must cite a knowledge object id", applies unchanged. Answers that cite nothing are refused.

## 14.4 Tests
| Test | Assertion |
|---|---|
| `auto_cannot_validate` | An automated actor moving any object to `validated` gets 409 |
| `experiment_flow` | A promote verdict produces the audited sequence up to `validating`, and nothing beyond |
| `reingest_idempotent` | Ingesting the same commit twice creates 0 new objects |
| `secret_masked` | A file containing a token-shaped string stores the masked text and raises a `risk` object |
| `ranked_search` | For the backlog's scripted queries, the expected object is in the top 5 (full-text), then in the top 3 (hybrid) |
| `ask_cites` | Every Ask Momento answer contains ≥ 1 valid object id, and every id resolves to a commit |

## 14.5 Measurement
- Provenance coverage: the share of objects with a commit hash;
- time from push to searchable;
- contradiction precision (human-reviewed sample);
- search MRR on the scripted set;
- the share of Ask answers with valid citations.

## 14.6 Features
Covered by F-34 (Experiment Registry) and F-06 (Living Dictionary). New feature: **F-37 Ask Momento**, a console assistant grounded in MKI.
