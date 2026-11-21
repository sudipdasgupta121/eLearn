// Loaded with `node --import ./telemetry.js ...` (see package.json scripts) so the OpenTelemetry
// hooks are registered BEFORE Express / pg are imported; importing it from app code is too late.
// Exports traces, metrics and logs to Grafana Cloud over OTLP using the standard OTEL_* env vars.
// A no-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset or OTEL_SDK_DISABLED=true (local dev, CI, tests).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';

// Runs before the app's own env loading, so read server/.env here too (existing env vars win).
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'), quiet: true });

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_SDK_DISABLED !== 'true') {
  process.env.OTEL_SERVICE_NAME ||= 'upskill';
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'deployment.environment.name': process.env.NODE_ENV || 'development',
    }),
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [
      new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: 30_000 }),
    ],
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter(), scheduledDelayMillis: 5000 })],
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false }, // pure noise for an Express app
        // Request bodies/headers are never recorded; also keep the health probe out of traces.
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) => req.url === '/api/health' || req.url?.startsWith('/assets/'),
        },
      }),
    ],
  });
  sdk.start();
  const stop = () => sdk.shutdown().catch(() => {});
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
