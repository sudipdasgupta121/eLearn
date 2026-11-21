// Test harness: boots a throwaway Postgres + the app on an ephemeral port.
// Tests NEVER use DATABASE_URL. They use TEST_DATABASE_URL (CI service container; DB name must contain "test")
// or, by default, a temporary embedded Postgres that is deleted afterwards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function startTestDb() {
  if (process.env.TEST_DATABASE_URL) {
    const name = new URL(process.env.TEST_DATABASE_URL).pathname;
    if (!/test/i.test(name)) throw new Error(`Refusing to run tests against "${name}": database name must contain "test"`);
    return { url: process.env.TEST_DATABASE_URL, stop: async () => {} };
  }
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upskill-pg-'));
  const port = 55000 + Math.floor(Math.random() * 4000);
  const pg = new EmbeddedPostgres({
    databaseDir: path.join(root, 'data'), user: 'postgres', password: 'postgres', port,
    persistent: true, onLog: () => {}, onError: () => {},
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('upskill_test');
  return {
    url: `postgres://postgres:postgres@localhost:${port}/upskill_test`,
    stop: async () => { await pg.stop(); try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* temp dir; OS cleans up */ } },
  };
}

/** Starts DB + app. Returns helpers; call close() in an `after` hook. */
export async function startApp(appOpts = {}) {
  const dbh = await startTestDb();
  process.env.DATABASE_URL = dbh.url;
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
  delete process.env.NODE_ENV;
  const { setupSchema, pool, query } = await import('../../db.js');
  const { seed } = await import('../../seed.js');
  const { createApp } = await import('../../app.js');
  await setupSchema();
  await seed();

  const servers = [];
  const listen = (opts) => new Promise((resolve) => {
    const s = createApp(opts).listen(0, '127.0.0.1', () => { servers.push(s); resolve(`http://127.0.0.1:${s.address().port}`); });
  });
  const base = await listen(appOpts);
  return {
    base, listen, query,
    close: async () => { servers.forEach((s) => s.close()); await pool.end(); await dbh.stop(); },
  };
}

/** Minimal HTTP client with a cookie jar and the CSRF header. */
export function client(base) {
  let cookie = '';
  const api = {
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; },
    async call(method, p, body, { csrf = true, headers = {} } = {}) {
      const res = await fetch(base + '/api' + p, {
        method,
        headers: { 'Content-Type': 'application/json', ...(csrf && { 'X-Requested-With': 'upskill' }), ...(cookie && { Cookie: cookie }), ...headers },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      });
      const setCookies = res.headers.getSetCookie();
      for (const sc of setCookies) {
        const pair = sc.split(';')[0];
        cookie = pair.endsWith('=') ? '' : pair;
      }
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data, headers: res.headers, setCookies };
    },
    get: (p, o) => api.call('GET', p, undefined, o),
    post: (p, b = {}, o) => api.call('POST', p, b, o),
    del: (p, o) => api.call('DELETE', p, undefined, o),
  };
  return api;
}

let n = 0;
export async function newUser(base, name = 'Test User') {
  const c = client(base);
  const email = `u${Date.now()}_${n++}@example.com`;
  const r = await c.post('/auth/register', { name, email, password: 'Secret123' });
  if (r.status !== 200) throw new Error('register failed: ' + JSON.stringify(r.data));
  return Object.assign(c, { email });
}

export const CARD = { number: '4242 4242 4242 4242', expiry: '12/40', cvc: '123' };
export const DECLINED_CARD = { ...CARD, number: '4000 0000 0000 0002' };
