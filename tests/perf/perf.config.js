// App-specific wiring for the generic runner (upSkill).
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.join(import.meta.dirname, '..', '..');
const POOL_USERS = 40; // keep in sync with prepare-test-db.js / k6/journeys.js
const secretOf = (fileEnv) => fileEnv.JWT_SECRET || 'perf-only-secret-perf-only-secret-perf-only-123';

export default {
  appRoot: path.join(import.meta.dirname, '..', '..'),
  // Env var names under which the app's REAL database URL may live (guarded against, and
  // stripped from the app's environment during the run).
  realDbEnvVars: ['DATABASE_URL'],
  build: 'npm run build',
  start: 'node --import ./server/telemetry.js server/index.js',
  readyPath: '/api/health',
  defaultPort: 3902, // isolated from the dev server (4000) and the UI-test server (3100)
  // Env handed to the app process. DATABASE_URL here is ALWAYS the test database.
  appEnv: ({ testUrl, port, fileEnv }) => ({
    DATABASE_URL: testUrl,
    PORT: String(port),
    NODE_ENV: 'production', // measure the production build/config
    OTEL_SDK_DISABLED: 'true', // never ship load-test traffic to Grafana (set false to measure telemetry overhead)
    JWT_SECRET: secretOf(fileEnv),
    // Test-server only: the per-IP limiters would otherwise throttle a single-IP load generator.
    // (Rate limiting itself is covered by the API security tests, not measured here.)
    AUTH_RATE_LIMIT_MAX: '1000000',
    API_RATE_LIMIT_MAX: '1000000',
  }),
  // Extra -e variables for k6 journeys.
  // Session cookies for the seeded pool users (ids 1..POOL_USERS, see prepare-test-db.js), signed with the
  // perf server's own secret. Login is bcrypt-bound and is not what this suite measures; minting the
  // sessions keeps setup() fast so the achieved-TPS figure reflects only the load phase.
  k6Env: ({ fileEnv }) => {
    const jwt = createRequire(path.join(ROOT, 'server', 'package.json'))('jsonwebtoken');
    const tokens = Array.from({ length: POOL_USERS }, (_, i) => jwt.sign({ id: i + 1 }, secretOf(fileEnv), { expiresIn: '1d', algorithm: 'HS256' }));
    return { PERF_SESSIONS: tokens.join(',') };
  },
};
