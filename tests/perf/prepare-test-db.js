// upSkill: bring the TEST database to a known, repeatable state.
//   1. apply schema + catalog seed with the app's own idempotent setup script
//   2. reset transactional data (users + everything hanging off them); catalog is left alone
//   3. seed a deterministic data volume so list/learn/progress queries hit realistic table sizes:
//        - POOL users  perfuser1..N   (the ones k6 logs in as; each enrolled in courses 1-3)
//        - BULK users  bulk1..M       (background volume: enrollments, progress, payments)
// Only ever called with the validated test URL (see run-perf.js + lib/dbguard.js).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

export const POOL_USERS = 40;
const DEFAULT_BULK = 2000;

export async function prepareTestDatabase({ testUrl, appRoot, env, flags }) {
  const bulk = Number(flags['seed-users'] ?? process.env.PERF_SEED_USERS ?? DEFAULT_BULK);
  if (!Number.isInteger(bulk) || bulk < 0) throw new Error('--seed-users must be a whole number >= 0');

  const local = ['localhost', '127.0.0.1'].includes(new URL(testUrl).hostname);
  console.log('[perf] applying schema + catalog seed to the test database ...');
  const r = spawnSync('node', ['server/scripts/setup-db.js', ...(local ? ['--create-local-db'] : [])], {
    cwd: appRoot, env: { ...env, DATABASE_URL: testUrl }, stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('database setup against the test database failed');

  // reuse the app's own dependencies (installed under server/)
  const require = createRequire(path.join(appRoot, 'server', 'package.json'));
  const pg = require('pg');
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('Secret123', 12); // same cost as the app, computed once

  const pool = new pg.Pool({ connectionString: testUrl, max: 2 });
  try {
    await pool.query('BEGIN');
    await pool.query('TRUNCATE payments, progress, enrollments, subscriptions, users RESTART IDENTITY CASCADE');

    await pool.query(
      `INSERT INTO users (name, email, password_hash)
       SELECT 'Perf User ' || g, 'perfuser' || g || '@perf.test', $2 FROM generate_series(1, $1::int) g`, [POOL_USERS, hash]);
    // pool users own courses 1-3 (so /learn and lesson progress work for them)
    await pool.query(
      `INSERT INTO enrollments (user_id, course_id, source)
       SELECT u.id, c, 'purchase' FROM users u, generate_series(1, 3) c`);

    if (bulk > 0) {
      await pool.query(
        `INSERT INTO users (name, email, password_hash)
         SELECT 'Bulk User ' || g, 'bulk' || g || '@perf.test', $2 FROM generate_series(1, $1::int) g`, [bulk, hash]);
      await pool.query(
        `INSERT INTO enrollments (user_id, course_id, source)
         SELECT u.id, 1 + ((u.id + k) % 13), 'purchase'
         FROM users u, generate_series(0, 2) k WHERE u.email LIKE 'bulk%'
         ON CONFLICT DO NOTHING`);
      await pool.query(
        `INSERT INTO progress (user_id, lesson_id)
         SELECT e.user_id, l.id FROM enrollments e JOIN lessons l ON l.course_id = e.course_id
         WHERE e.user_id IN (SELECT id FROM users WHERE email LIKE 'bulk%') AND (l.id + e.user_id) % 2 = 0
         ON CONFLICT DO NOTHING`);
      await pool.query(
        `INSERT INTO payments (user_id, kind, description, amount)
         SELECT e.user_id, 'course_purchase', 'Course: seeded', c.price
         FROM enrollments e JOIN courses c ON c.id = e.course_id
         WHERE e.user_id IN (SELECT id FROM users WHERE email LIKE 'bulk%')`);
    }
    await pool.query('COMMIT');
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM enrollments)::int AS enrollments,
              (SELECT count(*) FROM progress)::int AS progress, (SELECT count(*) FROM payments)::int AS payments`);
    console.log(`[perf] test database ready (deterministic): ${JSON.stringify(rows[0])}`);
  } catch (e) {
    await pool.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await pool.end();
  }
}
