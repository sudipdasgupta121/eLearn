import { createRequire } from 'node:module';

// pino is loaded with require() on purpose: the OpenTelemetry pino instrumentation patches the
// module through the CommonJS require hook, which a plain ESM `import pino from 'pino'` bypasses
// (the result would be logs with no trace_id and nothing shipped to Grafana Loki).
const pino = createRequire(import.meta.url)('pino');

// With telemetry.js active, each record gets trace_id/span_id and is also exported to Loki;
// stdout JSON still reaches the host's log viewer.
// Log ids and outcomes only - never emails, names, passwords, tokens or card data.
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.card'],
});
