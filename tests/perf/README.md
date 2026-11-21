# Performance tests (k6)

On-demand load/regression gate. It builds and starts the real app (`NODE_ENV=production`) on an
isolated port against a **throwaway database you supply**, drives it with k6, and fails when
thresholds are breached **or** results regress against a stored baseline.

## Non-negotiable rules (enforced in code)
1. **Never the real database.** `TEST_DATABASE_URL` is required on *every* run, passed inline, never stored in a file. `lib/dbguard.js` compares normalised host+port+database against `DATABASE_URL` in `.env` / `server/.env` / the shell, so the pooled vs direct Neon host and different query strings are all refused.
2. **Four parameters on every run, no defaults:** TPS, concurrent users, total users, latency (p95).

## Run
```bash
# local throwaway Postgres (npm run dev:db); the database is created automatically for localhost URLs
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/upskill_perf_test \
  npm run perf -- --tps=20 --vus=50 --total-users=600 --p95-ms=500

npm run perf:baseline -- <same params>     # record the baseline (only from a PASSING run)
```
PowerShell: `$env:TEST_DATABASE_URL="..."; npm run perf -- ...`

| Param | Flag / env | Meaning |
|---|---|---|
| TPS | `--tps` / `PERF_TPS` | user journeys started per second |
| Concurrent users | `--vus` / `PERF_VUS` | max users in flight (k6 VU cap) |
| Total users | `--total-users` / `PERF_TOTAL_USERS` | total journeys; run length = total ÷ TPS |
| Latency | `--p95-ms` / `PERF_P95_MS` | max p95 (optional `--p99-ms`, `--avg-ms`) |

Optional: `--max-error-pct` (default 1), `--regression-pct` (default 25), `--seed-users` (default 2000), `--skip-build`, `--no-baseline-check`.
Exit codes: `0` pass, `1` thresholds failed or regression vs baseline, `2` usage/setup error.

A run **fails** if p95 > target, errors > max, any iteration is **dropped** (TPS not sustainable at the allowed concurrency), or achieved TPS < 90% of target. Baselines live in `baselines/<tpsX-vusY-usersZ>.json` (committed); a different parameter set has its own baseline.

## What one "user" does (`k6/journeys.js`)
50% browse (list → search → detail → plans) · 20% learner reads (my courses → course player → subscription) · 20% progress write (complete lesson, sometimes undo) · 10% purchase (advisory lock + payment insert + enrollment upsert).
Data: 40 pool users (session cookies minted by the runner; login is bcrypt-bound and not measured) + 2,000 bulk users with enrollments, progress and payments, reseeded deterministically each run.

## Test-server-only overrides
The per-IP rate limiters (`AUTH_RATE_LIMIT_MAX`, `API_RATE_LIMIT_MAX`) are raised on the perf server because a single-IP load generator would otherwise just measure the limiter (that is covered by the API security tests).

## Known limits of the numbers
- k6, the app and Postgres share one machine, and the DB is local - results are a **relative regression signal**, not absolute capacity. A remote DB (Neon) adds network latency to every query.
- `compare-baseline.js` ignores drift while both values are under its noise floor (20 ms overall, 50 ms per endpoint). Because this app answers in single-digit ms locally, only larger regressions or TPS/error changes will trip the baseline gate.
- Password hashing (bcryptjs, cost 12) takes ~0.4 s per login/register on the main thread and is excluded from these journeys; at scale it, not the SQL, will limit sign-ups per instance.
