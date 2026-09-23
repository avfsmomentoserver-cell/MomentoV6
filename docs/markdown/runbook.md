# Operations Runbook

## Local development

```bash
# backend (deployed automatically by the platform; for local work)
cd functions && bun install

# web console
cd web-momento
bun install
bun run dev        # http://localhost:8080
```

The web app reads `EXPO_PUBLIC_RORK_FUNCTIONS_URL` from `.env` (points at the deployed Worker). Deploy the backend by running the platform's build on the `functions` app.

## First boot

The DO self-initializes: schema, default plugins (11 analyzers), build steps, default settings, and the operator account **operator@momento.local / momento**. Change the password immediately: create a new operator in Users → verify → disable the bootstrap account (tokens die instantly on disable).

## Seeding data

```bash
# push rounds (deduped — safe to re-run)
curl -X POST $BASE/api/v1/ingest -H 'Content-Type: application/json' \
  -d '{"source":"aviator","rounds":[{"multiplier":2.41},{"multiplier":1.08}]}'

# bulk import (operator token required)
curl -X POST $BASE/api/v1/import -H "Authorization: Bearer $TOKEN" \
  -d '{"entity":"rounds","rows":[{"timestamp":"2026-08-01T16:37:00Z","multiplier":1.42,"color":"blue","source":"momento_project"}]}'

# rebuild sessions after a large historical import
curl -X POST $BASE/api/v1/sessions/rebuild -H "Authorization: Bearer $TOKEN"
```

## Backup & restore

- **Export:** `GET /api/v1/export?entity=all&limit=250000` (or the Master Settings → Export all data button). Store the JSON.
- **Restore:** `POST /api/v1/import` with `{entity:"rounds", rows:[...]}` — round-trip safe (dedupe index makes re-imports idempotent).
- **Verify:** re-run `GET /api/v1/calibration` — all constants must match the reference within 1%.

## Live engine

- Start/stop from Ingest Console or Command Center (`feed/start`, `feed/stop`).
- Verify: `GET /api/v1/feed/verify` returns the seed fingerprint, cursor and a recomputed sample. Any generated round is reproducible from `SHA-256(seed:cursor)`.

## Troubleshooting

| symptom | action |
| --- | --- |
| "api offline" pill | check the Worker deploy; `GET /ping` for liveness |
| slow first analysis | cold cache over 177k rounds (~3 s); subsequent requests are cached until new data lands |
| sessions look wrong after bulk import | `POST /api/v1/sessions/rebuild` |
| 401 on operator pages | token expired (30 days) — sign in again |
| analysis numbers differ from reference | check source filter; calibration compares the unfiltered dataset |

## Release flow

1. Update the platform (code + docs).
2. Bump `VERSION` in `functions/core.ts` and the docs manifest.
3. Run the bundle script (produces the versioned zip + `bundle-stats.json`).
4. Register: `POST /api/v1/releases {version, filename, sha256, notes}`.
5. The Download button and Downloads page now serve the new bundle; `/releases/latest` lets scripts verify.
