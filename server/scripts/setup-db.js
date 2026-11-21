// Idempotent: (optionally creates a LOCAL database), creates tables and seeds catalog data.
// Usage: DATABASE_URL=... node scripts/setup-db.js [--create-local-db]
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is required'); process.exit(1); }

if (process.argv.includes('--create-local-db')) {
  const u = new URL(url);
  if (!['localhost', '127.0.0.1'].includes(u.hostname)) {
    console.error('--create-local-db only works for localhost databases'); process.exit(1);
  }
  const dbName = u.pathname.slice(1);
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) { console.error('Unsafe database name'); process.exit(1); }
  u.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: u.toString() });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName]);
  if (!rowCount) { await admin.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`); console.log(`Created database ${dbName}`); }
  await admin.end();
}

const { setupSchema, pool } = await import('../db.js');
const { seed } = await import('../seed.js');
await setupSchema();
await seed();
await pool.end();
console.log('Schema and seed data ready.');
