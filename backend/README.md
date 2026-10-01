# Momento v6.5 backend (Python, branch `afresh`)

FastAPI + SQLite backend serving the unchanged v6.5 frontend (`web-momento/`). It is a
faithful port of the archived TypeScript worker (`archive/backend-ts-v6.5/`) with
`momento_core` vendored alongside. Plan and progress: `../AFRESH_PLAN.md`.

```bash
cd backend
pip install -e '.[dev]'
MOMENTO_DB=./data/momento.db uvicorn app.main:app --port 8787
# frontend: EXPO_PUBLIC_RORK_FUNCTIONS_URL=http://localhost:8787
```

First boot creates `operator@momento.local` with password `$SETUP_PASSWORD` (default `momento`; change it).

| Path | What |
|---|---|
| `app/main.py` | FastAPI app, CORS, threadpool dispatch under the core lock, background scheduler (alarm + calibration drain) |
| `app/routes.py` | Core routes (auth, ingest, rounds, analysis, forecasts, settings, accuracy, research …) |
| `app/v64routes.py`, `app/v65routes.py`, `app/v65router.py` | v6.4 deep tier / v6.5 Platform Book routes |
| `app/core.py` | Stateful core (caches, calibration ledgers, evidence gate, blend gate) |
| `momento/` | Pure domain modules ported from the archive (dict-based, camelCase JSON) |
| `momento/storage/` | SQLite schema + repository |
| `momento_core/` | Vendored momento_core package |
| `deploy/` | Dockerfile, systemd unit, env example |

Tests: `python -m pytest -q tests` (unit, golden parity vs the archive, frontend contract).

Honesty rules are enforced in code: confidence is capped at LOW without locked-holdout
skill, and candidate engines join the blend only after clearing the 2-SE gate.
