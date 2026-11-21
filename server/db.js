import 'dotenv/config';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and set a Postgres connection string.');
}

// NUMERIC -> number, BIGINT (count) -> number
pg.types.setTypeParser(1700, parseFloat);
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

const local = ['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname);
// TLS is verified by default for remote databases. PG_SSL=no-verify / disable are escape hatches.
const sslMode = process.env.PG_SSL || (local ? 'disable' : 'verify');
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslMode === 'disable' ? false : { rejectUnauthorized: sslMode !== 'no-verify' },
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
pool.on('error', (e) => console.error('Postgres pool error:', e.message));

export const query = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0];
export const many = async (text, params) => (await pool.query(text, params)).rows;

/** Run fn(client) inside a transaction. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  level TEXT NOT NULL,
  instructor TEXT NOT NULL,
  description TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  hours NUMERIC(6,1) NOT NULL,
  rating NUMERIC(2,1) NOT NULL,
  students INTEGER NOT NULL,
  tier INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  color TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lessons (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  content TEXT NOT NULL,
  UNIQUE (course_id, position)
);
CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  rank INTEGER NOT NULL UNIQUE,
  price_monthly NUMERIC(10,2) NOT NULL,
  price_yearly NUMERIC(10,2) NOT NULL,
  description TEXT NOT NULL,
  features JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS enrollments (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  cycle TEXT NOT NULL,
  status TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  pending_plan_id INTEGER REFERENCES plans(id),
  pending_cycle TEXT,
  card_last4 TEXT
);
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);
`;

/** Idempotent: create tables (and seed, via seed.js). */
export async function setupSchema() {
  await pool.query(SCHEMA);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_lessons_course ON lessons(course_id);
    CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments(user_id);
    CREATE INDEX IF NOT EXISTS idx_progress_lesson ON progress(lesson_id);
    CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_end ON subscriptions(period_end);
  `);
}
