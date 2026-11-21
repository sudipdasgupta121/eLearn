# Security

## Controls implemented
| Area | Control |
|---|---|
| Passwords | bcrypt (cost 12); policy: 8–72 bytes, at least one letter and one number; constant-time-ish login (dummy hash compare for unknown emails, identical error message) |
| Sessions | JWT (HS256, algorithm pinned, 24 h) in an **httpOnly, SameSite=Lax, Secure (prod)** cookie. Never exposed to JavaScript or the response body, so XSS cannot steal it |
| CSRF | SameSite cookie **plus** required `X-Requested-With: upskill` header on every POST/PUT/DELETE; CORS is closed by default so the header cannot be sent cross-site |
| Brute force / abuse | `express-rate-limit`: 10 login/register attempts per 15 min per IP, 300 API requests/min per IP |
| Injection | All SQL is parameterized; sort columns are whitelisted; LIKE wildcards escaped; ids validated as int32 before reaching SQL; only string inputs accepted (no type confusion) |
| Authorization | Every private route requires a session; all data is scoped to the session user; course content/progress gated server-side on purchase or an active plan tier; prices are computed server-side only |
| Money | Per-user Postgres advisory lock serializes purchases/subscription changes, so a double-click or replay cannot double-charge (covered by concurrency tests) |
| Transport | HSTS, TLS to the database is **verified** for remote hosts (`PG_SSL=no-verify` is an explicit opt-out) |
| Headers | `helmet`: strict CSP (`default-src 'self'`, `frame-ancestors 'none'`, no inline scripts), nosniff, no `X-Powered-By`, `Referrer-Policy: no-referrer`; API responses `Cache-Control: no-store` |
| Input limits | JSON body ≤ 10 KB, field length limits, malformed JSON → 400, no stack traces in responses |
| Secrets | Only in env vars / Render dashboard; `.env*` is gitignored; production refuses to start without a ≥ 32 char `JWT_SECRET` |
| Card data | Payments are **simulated**. Only the last 4 digits are stored. For real payments use a hosted provider (Stripe Checkout/Elements) so card data never touches this server |
| Demo tooling | The "fast-forward billing period" endpoint does not exist unless `ENABLE_DEMO_TOOLS=true` (off by default and in `render.yaml`) |
| Supply chain | Lockfiles committed, `npm audit` in CI (fails on high+), minimal dependency set |

## Verified by automated tests
`npm test` (unit + API integration, 55 tests) includes security cases: CSRF header, cookie flags, tampered/forged/`alg:none` JWTs, rate limiting, SQL-injection and wildcard payloads, invalid ids, cross-user access (IDOR), price tampering, oversized/malformed bodies, security headers, and concurrent double-charge attempts.

## Known limitations (accepted for this MVP)
- No email verification or password reset flow; sessions are stateless (logout clears the cookie but a stolen token stays valid until it expires, ≤ 24 h).
- Rate limits are in-memory per instance; for multiple instances use a shared store (e.g. Redis).
- Registration reveals whether an email is taken (409). Fixing this needs email verification.
- Payments are simulated; there is no PCI scope only because no real card is processed.
- No audit log / alerting; add centralized logging and monitoring before real customers.

## Reporting a vulnerability
Open a private security advisory on the GitHub repository (Security → Advisories) rather than a public issue.
