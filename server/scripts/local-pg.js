// Dev-only: starts a throwaway local Postgres (no install needed) on port 5433.
// Connection string: postgres://postgres:postgres@localhost:5433/upskill
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.pgdata');
const fresh = !fs.existsSync(dir);
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port: 5433, persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('upskill');
console.log('Local Postgres ready: postgres://postgres:postgres@localhost:5433/upskill');
process.on('SIGINT', async () => { await pg.stop(); process.exit(0); });
