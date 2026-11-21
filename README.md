# upSkill — eLearning platform

React (Vite) + Node/Express + PostgreSQL. One Node process serves the API (`/api/*`) and the built React app. Deployable to Render with a Neon (or any) Postgres.

## Features
- **Discover**: landing page, category chips, search, filters, sorting, course detail with syllabus
- **Auth**: register / login / logout (bcrypt, httpOnly cookie session), protected routes
- **Purchase**: buy a course once, or subscribe to Basic / Pro / Premium (monthly or yearly). Payments are simulated
- **Access rules**: purchased courses are permanent; plan courses unlock per tier (Basic < Pro < Premium) and lock again if the plan is downgraded or expires
- **Subscriptions**: upgrade (immediate, prorated), downgrade (scheduled for period end, undoable), cancel (at period end), resume, renew (early or after expiry), auto-renewal, payment history
- **Learning**: lesson player, mark complete/undo, per-course progress, dashboard stats

See [SECURITY.md](SECURITY.md) for the security model and known limitations.

## Run locally
```bash
npm run install:all
cp server/.env.example server/.env   # set DATABASE_URL (and JWT_SECRET)
npm run dev:db        # optional: throwaway local Postgres on :5433 (no install needed)
npm run dev:server    # API on :4000, creates tables + seeds on first start
npm run dev:client    # Vite on :5173 (proxies /api)
```
Production-style: `npm run build && npm start` → http://localhost:4000

Set `ENABLE_DEMO_TOOLS=true` to show **Account → Fast-forward to end of billing period**, which lets you demo auto-renewal, scheduled downgrades and expiry instantly. Keep it off in real production.

## Tests
| Command | What |
|---|---|
| `npm run test:unit` | Pure logic: proration, upgrade/downgrade rules, card/email/password validation |
| `npm run test:integration` | Full API against a **throwaway** Postgres (embedded; or `TEST_DATABASE_URL`, whose name must contain `test`): auth, access control, purchase, progress, subscription lifecycle, concurrency, and security checks (CSRF, rate limits, injection, IDOR, forged JWTs, headers) |
| `npm test` | Both of the above (55 tests). Never touches `DATABASE_URL` |
| `npm run test:e2e` | **Headed Playwright UI suite** (34 journeys) against a dedicated test DB; generates + opens an HTML report on every run and archives it under `tests/e2e/reports/`. See [tests/e2e/README.md](tests/e2e/README.md) |
| `npm run test:all` | API tests, then UI tests |
| `TEST_DATABASE_URL=… npm run perf -- --tps=20 --vus=50 --total-users=600 --p95-ms=500` | **k6 performance/regression gate** against a throwaway DB (you must pass the DB and all four parameters every run). See [tests/perf/README.md](tests/perf/README.md) |
| `npm audit --omit=dev` | Run inside `server/` and `client/` (CI does this on every push) |

CI (`.github/workflows/ci.yml`) runs unit + integration tests (the headed UI suite needs a display, so it is run on demand before merging), the client build and the dependency audit on every push/PR.

## Deploy to Render
1. Create a Postgres database (e.g. Neon) and copy its connection string.
2. Render → **New → Blueprint** → select this repo (`render.yaml`).
3. When prompted, set `DATABASE_URL` to the connection string. `JWT_SECRET` is generated automatically.
4. First boot creates the tables and seeds courses/plans. Health check: `/api/health`.

| Env var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string; TLS is verified for remote hosts |
| `JWT_SECRET` | yes in production | ≥ 32 random chars |
| `NODE_ENV` | — | `production` enables secure cookies, HSTS, strict checks |
| `ENABLE_DEMO_TOOLS` | no | default `false` |
| `TRUST_PROXY` | no | proxies in front of the app (default 1 in production) |
| `CORS_ORIGINS` | no | only if the frontend is on another origin |
| `PG_SSL` | no | `no-verify` / `disable` escape hatches |
