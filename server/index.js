import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { pool, setupSchema } from './db.js';
import { seed } from './seed.js';
import { createApp } from './app.js';
import { logger } from './logger.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(dir, '..', 'client', 'dist');

await setupSchema();
await seed();

const app = createApp();
if (fs.existsSync(dist)) {
  // Vite emits content-hashed files under /assets, so they can be cached forever.
  app.use('/assets', express.static(path.join(dist, 'assets'), { maxAge: '1y', immutable: true, index: false }));
  app.use(express.static(dist, { maxAge: 0, index: false }));
  app.get(/^(?!\/api(\/|$)).*/, (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
}

const port = process.env.PORT || 4000;
const server = app.listen(port, () => logger.info({ port, env: process.env.NODE_ENV || 'development', otel: !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_SDK_DISABLED !== 'true' }, 'upSkill started'));
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;

async function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => { await pool.end().catch(() => {}); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
