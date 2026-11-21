# UI end-to-end tests (Playwright)

Real-browser regression suite for the full learner journey. It builds and starts the actual app
(`NODE_ENV=production`, so secure cookies, CSP and strict config are exercised) on its own port
against a **dedicated test database**.

## Rules (enforced in code)
1. **Headed always** — `headless: false` is hardcoded in `playwright.config.js`; there is no toggle. A display is required (on Linux CI use `xvfb-run`).
2. **Never the real database.** `prepare-test-db.js` refuses to run if `TEST_DATABASE_URL` is empty, points at the same host/db as `DATABASE_URL` in `.env` / `server/.env`, or its database name does not contain `test`. Ask for / confirm a fresh test DB each time you set this up.

## Setup (once)
```bash
npm install                      # repo root (installs @playwright/test)
npx playwright install chromium
cp tests/e2e/.env.e2e.example tests/e2e/.env.e2e   # then edit TEST_DATABASE_URL
```
Local option: `postgres://postgres:postgres@localhost:5433/upskill_ui_test` (start Postgres with `npm run dev:db`; the database is created automatically for localhost URLs).
Hosted option: a separate Neon branch/database whose name contains `test`.

## Run
```bash
npm run test:e2e          # run everything, headed, then produce + open the HTML report
npm run test:e2e -- specs/04-subscriptions.spec.js     # one file
npm run test:e2e -- -g "upgrade"                        # by title
npm run test:e2e:debug    # Playwright inspector
npm run test:e2e:report   # re-open the latest report
npm run test:all          # API tests (unit + integration) then UI tests
```
Env switches: `E2E_NO_OPEN=1` don't open the report, `E2E_SLOWMO=300` slow the browser down for demos, `E2E_KEEP_REPORTS=20` archived reports kept.

## Reports (every run)
| Path | What |
|---|---|
| `tests/e2e/playwright-report/index.html` | Latest HTML report (screenshots + trace for every test, video on failures) |
| `tests/e2e/reports/<timestamp>/` | Archive of every run (last 20 kept) |
| `tests/e2e/playwright-report/results.json` | Machine-readable results |

All are gitignored. View one with `npx playwright show-report tests/e2e/reports/<timestamp>`.

## What is covered (34 tests)
| Spec | Journeys |
|---|---|
| `01-browse` | landing page, hero search, category chips, level filter + sort + empty state, course detail/syllabus, buy-while-logged-out → login, plans + yearly toggle, 404 |
| `02-auth` | protected-route redirect and return after sign-up, server password policy, duplicate email, wrong/right login, refresh keeps session, logout, httpOnly cookie not readable by JS, cleared session |
| `03-purchase-and-learning` | declined/invalid card, purchase → learn → progress → undo → complete, dashboard progress, no double purchase, payment history, direct access without enrollment |
| `04-subscriptions` | subscribe, tier access, declined card, yearly billing, prorated upgrade, scheduled downgrade + undo, downgrade applied at period end + locked courses, cancel/resume, expire → renew, early renew, re-subscribe after expiry |
| `05-access-control` | anonymous redirects + API 401/403, cross-user course access, tier enforcement via API |

## How it works
`playwright.config.js` → `webServer.command` = `prepare-test-db.js && npm run build && npm start`.
DB prep runs *before* the app starts (Playwright starts `webServer` and `globalSetup` concurrently). It creates the DB if local, applies schema + seed, and truncates transactional tables (`users`, `enrollments`, `subscriptions`, `payments`, `progress`); catalog data is kept. Every spec signs in a fresh unique user (auto fixture) so tests are independent; `workers: 1` because the DB is shared. The app runs with `ENABLE_DEMO_TOOLS=true` (billing-period fast-forward) and a raised auth rate limit, **only in this test server**.
