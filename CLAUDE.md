# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

upSkill: an eLearning MVP (course catalog, course purchase, subscription plans, learning progress). React (Vite) + Node/Express + PostgreSQL. One Node process serves both `/api/*` and the built client (`client/dist`). Deployed on Render (auto-deploys from `main`) with a Neon database; see README.md for the live URL and feature list, SECURITY.md for the security model.

## Commands
Root `package.json` just delegates into `server/`, `client/`, `tests/`. Each of `server/`, `client/`, `tests/e2e/`, `tests/perf/` has its own `package.json` (the last two are `"type": "module"` stubs / own scope so Playwright and k6 tooling load as ESM).

```bash
npm run install:all                # server + client deps (root also holds @playwright/test)
npm run dev:db                     # throwaway local Postgres on :5433 (embedded-postgres, no install needed)
npm run dev:server                 # API on :4000 (node --watch); creates tables + seeds catalog on start
npm run dev:client                 # Vite on :5173, proxies /api -> :4000
npm run build && npm start         # production-style: Express serves client/dist on :4000
npm run lint --prefix client       # oxlint (warnings only today)

npm test                           # API tests: unit + integration (55 tests)
npm run test:unit | test:integration
cd server && node --test test/unit/billing.test.js                                   # single file
cd server && node --test --test-name-pattern="upgrade" test/integration/api.test.js  # single test by name
npm run test:e2e                   # headed Playwright UI suite (34 tests), then writes + opens HTML report
npm run test:e2e -- -g "upgrade"   # filter; also: -- specs/04-subscriptions.spec.js
npm run test:all                   # API tests then UI tests
TEST_DATABASE_URL=<throwaway db> npm run perf -- --tps=20 --vus=50 --total-users=600 --p95-ms=500   # k6 gate
```
Ports: dev API 4000, Vite 5173, UI-test server 3100, perf server 3902, local Postgres 5433 (keeps suites from colliding with a running dev server). On this Windows/git-bash setup, long heredocs containing apostrophes or markdown fail to parse; create files with the editor/Write tool instead.
`npm audit` must be run inside `server/` and `client/` directly (nested `npm audit` from a root `npm run` script fails with `EALLOWSCRIPTS` on npm 12).

## Database rules (important)
- `server/.env` holds the **real** `DATABASE_URL` (Neon, shared by local dev and production). `server/db.js` loads it by file path (works from any cwd); variables already in the environment win over `.env`.
- Automated tests must never touch it. Integration tests spin up their own embedded Postgres (or `TEST_DATABASE_URL`, whose DB name must contain `test`). The Playwright suite uses `tests/e2e/.env.e2e`; the perf suite requires `TEST_DATABASE_URL` inline on every run plus all four parameters (TPS, VUs, total users, p95) with no defaults. Both guards compare against `DATABASE_URL` in `.env` and `server/.env` and refuse a match (perf also normalises Neon pooler/direct hosts).
- There are no migrations. `setupSchema()` in `server/db.js` is `CREATE TABLE/INDEX IF NOT EXISTS`, run on every server start, so changing an existing column needs a manual `ALTER` against Neon before deploying.
- TLS to remote databases is verified by default (`PG_SSL=no-verify|disable` are escape hatches).

## Architecture
**Server (`server/`, ESM, `pg` with raw SQL, no ORM).** `app.js` exports `createApp(opts)` containing every route; `index.js` adds static serving + SPA fallback, runs `setupSchema()` and `seed()` (idempotent catalog/plans seed in `seed.js`). Pure logic is split into `lib/billing.js` (proration, upgrade/downgrade rule, period lengths), `lib/validation.js` (card/Luhn, email, password) and `lib/errors.js`. `createApp` options (`demoTools`, `authLimit`, `generalLimit`) exist so tests can build differently configured apps; env equivalents are `ENABLE_DEMO_TOOLS`, `AUTH_RATE_LIMIT_MAX`, `API_RATE_LIMIT_MAX`.

**Auth/security model.** JWT in an httpOnly `upskill_session` cookie (never in the body/localStorage). Every POST/PUT/DELETE must send `X-Requested-With: upskill` (CSRF defence; CORS is closed unless `CORS_ORIGINS` is set), so any new client call or test request that mutates needs that header. `/api/auth/me` returns `{user: null}` (not 401) for anonymous visitors. In `NODE_ENV=production` `JWT_SECRET` (>= 32 chars) is mandatory and cookies are `Secure`.

**Access + subscription model (the core domain; read `app.js` subscription section + `lib/billing.js` together).**
- Courses have a `tier` (1 Basic, 2 Pro, 3 Premium); plans have a matching `rank`. `enrollments.source` is `purchase` (permanent) or `subscription` (only valid while the user's active plan rank >= course tier). `courseAccess()` is the single access check used by learn/progress routes; "locked" courses are enrolled-by-subscription ones the plan no longer covers.
- One `subscriptions` row per user. State is advanced **lazily**: `syncSubscription()` runs when a subscription is read/mutated and applies period-end transitions (cancel -> `expired`, pending downgrade applied, auto-renew with a payment row). Upgrade = immediate + prorated; downgrade = stored as `pending_plan_id` until period end; cancel = `cancel_at_period_end`.
- All money/subscription mutations take a per-user Postgres advisory lock (`lockUser`) so double clicks cannot double charge; keep new mutating routes inside `tx()` with `lockUser`.
- Payments are simulated (`charge()` in `app.js`): `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` is declined; only the last 4 digits are stored. `POST /api/subscription/demo-expire` exists only when `ENABLE_DEMO_TOOLS=true` (UI shows a "Fast-forward" link via `/api/config`); keep it off in production.

**Client (`client/src/`, React 19 + react-router, plain CSS in `index.css`, no state library).** `api.js` is the only fetch wrapper (adds the CSRF header, emits `upskill:unauthorized` on 401); `AuthContext` loads the session via `/auth/me`. Pages under `pages/`; `PaymentModal` is shared by course purchase and subscribe. Vite proxies `/api` in dev; in production Express serves the build.

## Test suites
- `server/test/`: unit (`lib/*`) and a single integration file that boots the real app against a throwaway Postgres via `test/helpers/harness.js` (cookie-jar client, `newUser()`); it also holds the security cases (CSRF, forged JWTs, rate limits, IDOR, injection, concurrency).
- `tests/e2e/`: Playwright, **always headed** (needs a display; `headless: false` is hardcoded, no toggle). `webServer.command` prepares the test DB *before* build/start (Playwright runs webServer and globalSetup concurrently). The `user` fixture is `auto` so every spec starts as a fresh signed-in user; specs use role/label locators and share one DB (`workers: 1`). `run.js` archives each run's report under `tests/e2e/reports/<timestamp>/`.
- `tests/perf/`: k6 arrival-rate suite, orchestrated by Node (`run-perf.js`); app-specific files are `perf.config.js`, `prepare-test-db.js`, `k6/journeys.js`. The runner mints session cookies for seeded pool users instead of logging in (bcrypt cost 12 would dominate setup), and raises the per-IP rate limits on the perf server only. Baselines are committed in `tests/perf/baselines/` and keyed by parameter set.
- CI (`.github/workflows/ci.yml`) runs unit + integration, the client build and `npm audit`; the headed UI suite is run on demand.

## Observability (OpenTelemetry -> Grafana Cloud)
- `server/telemetry.js` must be loaded with `node --import ./telemetry.js` (already in the `start`/`dev` scripts, the root `start`, and the perf config); importing it from app code is too late for auto-instrumentation. It is a **no-op unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set** and reads `server/.env` itself.
- Test runners must set `OTEL_SDK_DISABLED=true` (Playwright and perf configs already do) so test traffic never reaches Grafana. API tests call `createApp()` directly and never load telemetry.
- `server/logger.js` loads pino via `createRequire` on purpose: a plain ESM `import pino` bypasses the OTel require hook, so logs get no `trace_id` and are not shipped to Loki. Log ids and outcomes only, never emails/names/card data.
- Business metrics live in `server/metrics.js` (`upskill.auth.events`, `upskill.course.purchases`, `upskill.revenue`, `upskill.payment.amount`, `upskill.subscription.events`, `upskill.lessons.events`, `upskill.access.denied`, `upskill.rate_limited`) and are recorded in `app.js`; keep attributes low-cardinality. Revenue is recorded where the payment row is written, inside the transaction.
- `@opentelemetry/sdk-logs` 3.x takes an options object: `new BatchLogRecordProcessor({ exporter })`. Don't add `@opentelemetry/api-logs` as a direct dependency (a version split with the SDK broke log export).
- `server/.env` now contains the real `OTEL_*` settings, so local `dev:server` / `npm start` runs also export (tagged `deployment.environment.name=development`); add `OTEL_SDK_DISABLED=true` to a run to keep local traffic out of Grafana. Production sets the same four `OTEL_*` vars on the Render service (stack region `prod-ap-south-1`, service name `upskill`).
- Not done: frontend (Faro), dashboards/alerts as code. Verified locally against a fake OTLP collector (traces, metrics and logs arrive); delivery to the real Grafana stack is verified only once credentials are configured.

## Deployment
Live at https://upskill-nzql.onrender.com. Render web service `upskill` (id `srv-dc0l753m8hqs73ese2ng`, Sudip's Workspace, free plan, Oregon, branch `main`) builds with `npm install --prefix server --omit=dev && npm install --prefix client --include=dev && npm run build`, starts with `npm start`, health check `/api/health`. Env vars on the service: `NODE_VERSION`, `NODE_ENV`, `DATABASE_URL` (Neon, same DB as local dev), `JWT_SECRET`, `ENABLE_DEMO_TOOLS=false`, and the four `OTEL_*` vars. `render.yaml` mirrors this for Blueprint use.
- **A push to `main` did not reliably trigger a deploy** here (the service was created through the API, not from the Blueprint). After pushing, trigger one with `POST https://api.render.com/v1/services/<id>/deploys` (needs a Render API key, which is not stored anywhere in the repo) or "Manual Deploy" in the dashboard, then poll `GET /v1/services/<id>/deploys?limit=1` until `live`. Changing an env var via `PUT /v1/services/<id>/env-vars/<KEY>` does not by itself change code.
- Free tier sleeps after ~15 min idle, so the first request can take 30-60 s.
- `DATABASE_URL` is shared by local dev and production: test accounts created locally exist in prod.
