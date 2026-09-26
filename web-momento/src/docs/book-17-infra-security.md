# 17 · Infrastructure, Security & Ops

This chapter covers:
- the runtime layout of each generation;
- the v6.3 auth and route protection, read line by line in `functions/core.ts`;
- repository hygiene;
- the controls, CI pipeline, observability and scale path the platform needs.

Findings are ordered by severity. The first three are **act now** items.

## 17.1 What exists
| Area | Current state |
|---|---|
| Runtime v6.3 | Cloudflare Worker + Durable Object with SQLite storage (`functions/wrangler.toml`, `functions/index.ts` router, `functions/core.ts` DO, about 2,200 lines); `local-dev.mjs` / `.local-entry.mjs` for local runs; DO alarms drive the accuracy scheduler (Ch 08) |
| Runtime V5 / terminal | FastAPI + SQLite, `run_api.py`, file watcher; ShapeShifters backend |
| Research | Python packages (research suite, InvestigationSuite) run offline |
| CI | `momento-core@ci/free-tier-local-debian` (split API/GPU requirements, free-tier tuning), research-suite tests, MKI `.github/workflows/ci.yml` |
| IaC | `InvestigationSuite terraform/` + cloud-init, Docker compose |
| Scale-out design | `momentocore2` (Kafka, Weaviate, K8s); V6 spec service table (Collector, Analysis, Forecast, Orchestrator, Linguistics, Decision, Gateway, Console, Consumer, Admin) |
| Security docs | `MKI SECURITY_MODEL`, `THREAT_MODEL` (STRIDE); `MomentoFX` V5 security doc; V6 spec Part 6 |

### 17.1.1 v6.3 auth as coded (`functions/core.ts`)
- **`hashPassword`:** PBKDF2-SHA256 through WebCrypto, **100,000 iterations**, a 32-hex random salt (`crypto.randomUUID`) and a 256-bit output stored as hex.
- **Login:**
  - looks up the user by lower-cased email with `disabled = 0`;
  - recomputes the hash and compares with `!==`;
  - issues a 64-hex token (two UUIDs), stored **plaintext** in `tokens` with a 30-day expiry;
  - writes an `audit_log` entry.
- **`userFor`:** a bearer token joined to users, checking expiry and disabled.
- **`requireOperator`:** role must be operator or admin (401/403). **`audit`:** actor, action, target, and meta truncated to 2,000 chars.
- **`bootstrap`:** if no users exist, it creates **`operator@momento.local` / `momento`**. `BUILD_WALKTHROUGH.md` and `runbook.md` say to change it immediately.
- **CORS (`functions/index.ts`):** `Access-Control-Allow-Origin: *`, methods GET/POST/PUT/DELETE/OPTIONS, headers Content-Type and Authorization, max-age 86,400.

### 17.1.2 Route protection
| Route | Guard |
|---|---|
| `POST /api/v1/ingest` | **none** |
| `POST /api/v1/forecasts/record` | optional user (`userFor`, not required) |
| `POST /api/v1/forecasts/resolve` | **none** |
| `POST /api/v1/backtest/run` | optional user |
| `POST /api/v1/import`, `DELETE /rounds`, `DELETE /sources/{name}`, `/autopilot/start`, `/intelligence/recalibrate`, `/auth/register`, settings, users | `requireOperator` |
| `/feed/start`, `/feed/step`, `/feed/verify` | return 410 "feed engine disabled" in v6.3 |

## 17.2 Findings
### 17.2.1 Security (act now)
| # | Severity | Finding | Location | Action |
|---|---|---|---|---|
| H-1 | Critical | **A file named `gilabtoke.md` appears to contain a GitLab access token.** The V6 spec itself flags "GitLab tokens (security risk) — should be removed" | `MomentoFX`, `momento-core`, which are **public** repos | **Revoke the token in GitLab now.** Then delete the file and purge it from history (`git filter-repo --path gilabtoke.md --invert-paths`), and force-push. Forks and caches keep copies, so revocation is the real fix |
| S-1 | Critical | **Unauthenticated ingest with `CORS: *`.** Any website or script can POST rounds into the tape. This attacks the core asset: the tape, and through it every forecast and the ledger (Ch 03, Ch 08) | `core.ts` `/api/v1/ingest` | Require per-collector keys: HMAC-SHA256 over `ts ‖ nonce ‖ body` with a 60 s skew window and nonce replay protection, and rate-limit per key. Browsers must never be able to ingest |
| S-2 | High | **Default operator credentials** `operator@momento.local` / `momento` on every fresh DO | `core.ts` `bootstrap` | Replace with a one-time setup token from a Worker secret (`SETUP_TOKEN`). The first login must set a password. Refuse to start in production if the bootstrap user is still active |
| S-3 | High | `forecasts/resolve` and `backtest/run` unauthenticated, `forecasts/record` optionally authenticated | `core.ts` | Resolution runs only from the scheduler (Ch 08), so remove the public route. Backtests require a user and a quota. Record requires a user, stamped server-side |
| S-4 | Medium | `/auth/register` accepts `body.role` unchecked, so an operator can create **admin** accounts; minimum password length is 4 | `core.ts` 1233–1246 | Allow-list roles, only admins may grant admin, minimum 12 characters, check against a breached-password list |
| S-5 | Medium | Tokens stored plaintext. Anyone who reads the DB (for example through an export or backup) holds live sessions | `tokens` table | Store SHA-256(token) and compare hashes. Shorten lifetime to 7 days with rotation |
| S-6 | Medium | PBKDF2 at 100k iterations. OWASP recommends 600,000 for PBKDF2-HMAC-SHA256 ([OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)) | `hashPassword` | Raise the iteration count. Store `iter` per user and rehash on next login |
| S-7 | Low | Non-constant-time hash compare (`!==`) and no login rate limiting | login | Constant-time compare over the bytes, plus per-IP and per-email backoff |
| S-8 | Medium | Token in browser local storage combined with `CORS: *` | console (Ch 16, U2) | Cookie session or in-memory token. Restrict CORS to the console origins |
| S-9 | Medium | The production build zips the full source into `public/downloads` (script currently missing) | `vite.config.ts` (Ch 16, U3) | Operator-only, built in CI with a secret scan |

### 17.2.2 Repository hygiene
| # | Finding | Location | Action |
|---|---|---|---|
| H-2 | SQLite database committed as a file named `--port` (176 KB) | `MomentoV5@v6.3-full-intelligence:functions/--port` | Delete it and gitignore it. It was probably produced by a CLI flag mis-parse |
| H-3 | Databases and archives committed (`data/avfs.db`, `.7z`, `.bak`, `momento.db`, `rounds.db`, a Drive zip, `__pycache__`) | `InvestigationSuite@decomputation` | Move to release assets or R2. Gitignore |
| H-4 | Committed `.venv` | `MomentoV5@fixes` (InvestigationSuite already deleted its own) | Remove |
| H-5 | Blob files > 2 MB in several repos | various | Git LFS or external storage |
| H-6 | Stub code that looks real (STRIDE `torch.randn` wrappers, mocked teacher) | `MomentoFresh@feature/stride-integration` (Ch 15, A1–A3) | Mark as experimental. Registry refuses stub engines |

This book does not reproduce any secret.

## 17.3 Reference design
### 17.3.1 Threat model (STRIDE, the security one)
Apply Microsoft's STRIDE categories (Spoofing, Tampering, Repudiation, Information disclosure, DoS, Elevation of privilege) to each trust boundary ([Microsoft Threat Modeling Tool threats](https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats); [MDN threat modeling frameworks](https://developer.mozilla.org/en-US/docs/Web/Security/Threat_modeling/Frameworks)).

| Boundary | S | T | R | I | D | E |
|---|---|---|---|---|---|---|
| Collector → ingest | per-collector HMAC keys | quarantine and consensus (F-01, F-02) | `batch_id`, `collector` on rows | — | per-key rate limit | keys can only ingest |
| Browser → Worker | cookie session, CSRF | — | `audit_log` | CORS allow-list | per-IP limits | role checks |
| Worker → DO | internal only | ledger hash chain (Ch 08) | chained rows | — | DO per source (F-05) | — |
| Worker → sidecar (TSFM) | mTLS or shared secret | response signatures | cache keyed by model rev | no PII sent | timeout + abstain | sidecar has no DB write |
| Operator actions | 2FA for admin | — | audit every weight or config change | exports require operator | — | admin-only role grants |

### 17.3.2 Ingest authentication (reference)
```ts
// collector side: sign each batch
const ts = Date.now(), nonce = crypto.randomUUID();
const sig = hex(await hmacSha256(KEY, `${ts}.${nonce}.${body}`));
fetch(`${API}/api/v1/ingest`, { method: "POST", body,
  headers: { "X-Collector": id, "X-Ts": String(ts), "X-Nonce": nonce, "X-Sig": sig } });

// Worker side
async function verifyCollector(req: Request, body: string, env: Env) {
  const id = req.headers.get("X-Collector"), ts = Number(req.headers.get("X-Ts")), nonce = req.headers.get("X-Nonce");
  if (!id || !nonce || Math.abs(Date.now() - ts) > 60_000) throw new HttpError("stale", 401);
  const key = await env.COLLECTOR_KEYS.get(id); if (!key) throw new HttpError("unknown collector", 401);
  const want = await hmacSha256(key, `${ts}.${nonce}.${body}`);
  if (!timingSafeEqual(want, fromHex(req.headers.get("X-Sig") ?? ""))) throw new HttpError("bad sig", 401);
  if (!(await nonceOnce(env, id, nonce))) throw new HttpError("replay", 401);   // KV/DO set with 120 s TTL
  return id;                                                                     // stamped as rounds.collector
}
```

### 17.3.3 Secrets
- Secrets live only in Worker secrets (`wrangler secret put`) and GitHub Actions secrets.
- Run `gitleaks` in CI and in a pre-commit hook.
- MKI's `_mask_secrets` raises a `risk` object when it fires (Ch 14).
- Rotate collector keys every quarter, keeping two active keys per collector for zero-downtime rotation.

### 17.3.4 CI pipeline
```
lint + typecheck → unit (TS + Python) → engines-parity (TS vs Python golden) →
causality tests (Δt firewall, Ch 07) → null-tape tests (no engine shows skill on i.i.d. tape) →
gitleaks → build → deploy preview (wrangler) → smoke: /health, /intelligence/forecast, /accuracy/overview →
security smoke: unauth ingest = 401, default creds rejected, CORS origin ≠ *
```

### 17.3.5 Backups and recovery
- DO SQLite has point-in-time recovery for the last 30 days ([DO PITR API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api)). Use it for accidents.
- Also export nightly to R2: tape, ledger chain head and config. This covers disasters and gives the research suite reproducible snapshots with a content hash.
- Restores are rehearsed monthly. The ledger chain verification (Ch 08 §8.4.6) must pass after a restore.

### 17.3.6 Observability
- **Per-request metrics:** route, ms, DO id and status.
- **Per-engine metrics:** timing and abstain rate.
- **Domain SLOs:**

| SLO | Target | Alert |
|---|---|---|
| Ingest lag (round ts → stored) | p95 < 2 s | > 10 s for 5 min |
| Ingest → forecast on screen | p95 ≤ 250 ms (Ch 16) | > 500 ms for 10 min |
| Open predictions overdue | 0 | > 0 for 15 min |
| Ledger resolution lag | < 1 round | > 5 rounds |
| Void rate (outages, fairness fails) | < 1% per day | > 5% |
| Fairness verified share | > 99.9% where seeds are revealed | < 99% |
| Auth failures | baseline | 10× baseline (credential stuffing) |

### 17.3.7 Scale path
- Stay serverless (Worker + per-source DOs + R2 + a Python sidecar) until sources number more than about 50, or a single source exceeds DO throughput.
- Only then consider the momentocore2 Kafka/K8s design.
- The V6 microservice table is a good **logical** decomposition. Implement it as modules first and split services later.

## 17.4 Tests
| Test | Assertion |
|---|---|
| `ingest_requires_sig` | Unsigned, stale, replayed or wrong-key batches get 401 (S-1) |
| `no_default_operator` | Production boot fails if `operator@momento.local` is active (S-2) |
| `resolve_not_public` | `POST /forecasts/resolve` returns 404 or 401 (S-3) |
| `role_allowlist` | An operator cannot create admin (S-4) |
| `token_hashed` | `tokens.token` never equals the issued token (S-5) |
| `pbkdf2_iter` | New hashes use ≥ 600,000 iterations and old ones are upgraded on login (S-6) |
| `cors_allowlist` | `Origin: https://evil.example` receives no ACAO header |
| `restore_chain` | A restored DO passes ledger chain verification |

## 17.5 Features
This chapter supports F-01, F-02, F-05 and F-18 directly, and gates every public feature: nothing ships to consumers before S-1 to S-3 are closed (Ch 19, Phase 0).
