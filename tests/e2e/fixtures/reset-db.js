// Truncates transactional tables (users and everything hanging off them).
// Catalog data (courses, lessons, plans) is seed data and is left alone.
import { createRequire } from 'node:module';
import path from 'node:path';

// Reuse the app's own `pg` dependency (installed under server/) instead of adding another.
const require = createRequire(path.join(import.meta.dirname, '..', '..', '..', 'server', 'package.json'));

export async function resetTransactionalTables(connectionString) {
  const pg = require('pg');
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('TRUNCATE payments, progress, enrollments, subscriptions, users RESTART IDENTITY CASCADE');
  } finally {
    await client.end();
  }
}
