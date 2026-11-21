// Prepares the dedicated TEST database: guardrails -> (create local DB) -> schema + seed -> reset
// transactional tables. Called as the first step of webServer.command AND from global-setup.js.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import { resetTransactionalTables } from './fixtures/reset-db.js';

loadEnv({ path: path.join(import.meta.dirname, '.env.e2e') });

const APP_ROOT = path.join(import.meta.dirname, '..', '..');
const THIS_FILE = path.join(import.meta.dirname, 'prepare-test-db.js');

/** Every place the app could pick its real database URL up from. */
function realDatabaseUrls() {
  const urls = new Set();
  for (const file of [path.join(APP_ROOT, '.env'), path.join(APP_ROOT, 'server', '.env')]) {
    try {
      const m = readFileSync(file, 'utf-8').match(/^DATABASE_URL=(.*)$/m);
      if (m?.[1]?.trim()) urls.add(m[1].trim().replace(/^["']|["']$/g, ''));
    } catch { /* file not present */ }
  }
  return [...urls];
}

const hostDb = (u) => { try { const x = new URL(u); return `${x.hostname}:${x.port}${x.pathname}`; } catch { return u; } };

export async function prepareTestDatabase() {
  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  if (!testUrl) {
    throw new Error('TEST_DATABASE_URL is not set in tests/e2e/.env.e2e. This suite refuses to run without a dedicated test database — see tests/e2e/README.md.');
  }
  for (const real of realDatabaseUrls()) {
    if (testUrl === real || hostDb(testUrl) === hostDb(real)) {
      throw new Error('TEST_DATABASE_URL points at the same database as the app\'s real DATABASE_URL. Refusing to run — use a separate, dedicated test database.');
    }
  }
  if (!/test/i.test(new URL(testUrl).pathname)) {
    throw new Error('The test database name must contain "test" (e.g. upskill_ui_test) so a real database can never be wiped by mistake.');
  }

  const local = ['localhost', '127.0.0.1'].includes(new URL(testUrl).hostname);
  const res = spawnSync('node', ['server/scripts/setup-db.js', ...(local ? ['--create-local-db'] : [])], {
    cwd: APP_ROOT,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });
  if (res.status !== 0) throw new Error('Schema setup against the test database failed');

  await resetTransactionalTables(testUrl);
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
  prepareTestDatabase()
    .then(() => console.log('Test database ready.'))
    .catch((err) => { console.error(err.message); process.exit(1); });
}
