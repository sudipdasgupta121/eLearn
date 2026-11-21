// k6 entry point. Everything here is generic; app-specific behaviour lives in ./journeys.js.
// Run through tests/perf/run-perf.js (it passes the parameters as -e variables) - not directly.
import { Trend } from "k6/metrics";
import { setup as journeySetup, journey, ENDPOINT_NAMES } from "./journeys.js";
import { buildSummary } from "./summary.js";

const p = {
  tps: Number(__ENV.PERF_TPS),
  vus: Number(__ENV.PERF_VUS),
  totalUsers: Number(__ENV.PERF_TOTAL_USERS),
  p95Ms: Number(__ENV.PERF_P95_MS),
  p99Ms: __ENV.PERF_P99_MS ? Number(__ENV.PERF_P99_MS) : undefined,
  avgMs: __ENV.PERF_AVG_MS ? Number(__ENV.PERF_AVG_MS) : undefined,
  maxErrorPct: Number(__ENV.PERF_MAX_ERROR_PCT ?? 1),
};
if (![p.tps, p.vus, p.totalUsers, p.p95Ms].every((n) => n > 0)) {
  throw new Error("PERF_TPS, PERF_VUS, PERF_TOTAL_USERS and PERF_P95_MS are required - run via run-perf.js");
}

// Same derivation as lib/params.js (k6 cannot import Node modules, so it is repeated; the
// runner passes the derived values in too and main.js cross-checks them).
const durationS = Math.max(1, Math.floor(p.totalUsers / p.tps));
const maxVUs = Math.min(p.vus, p.totalUsers);
if (__ENV.PERF_DURATION_S && Number(__ENV.PERF_DURATION_S) !== durationS) {
  throw new Error("Scenario derivation drifted between lib/params.js and k6/main.js - keep them identical.");
}

const journeyDuration = new Trend("journey_duration", true);

const reqThresholds = [`p(95)<${p.p95Ms}`];
if (p.p99Ms) reqThresholds.push(`p(99)<${p.p99Ms}`);
if (p.avgMs) reqThresholds.push(`avg<${p.avgMs}`);

// Empty threshold arrays make k6 track + report a per-endpoint sub-metric without gating on it.
const perEndpoint = Object.fromEntries(
  ENDPOINT_NAMES.flatMap((n) => [[`http_req_duration{name:${n}}`, []], [`http_reqs{name:${n}}`, []]])
);

export const options = {
  scenarios: {
    load: {
      executor: "constant-arrival-rate",
      rate: p.totalUsers,
      timeUnit: `${durationS}s`,
      duration: `${durationS}s`,
      preAllocatedVUs: Math.min(maxVUs, 200),
      maxVUs,
      gracefulStop: "30s",
    },
  },
  thresholds: {
    http_req_duration: reqThresholds,
    http_req_failed: [`rate<${p.maxErrorPct / 100}`],
    checks: [`rate>${1 - p.maxErrorPct / 100}`],
    dropped_iterations: ["count==0"], // target TPS must be sustainable at the allowed concurrency
    iterations: [`rate>=${(p.tps * 0.9).toFixed(3)}`], // achieved TPS within 10% of target
    ...perEndpoint,
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  discardResponseBodies: false,
  noConnectionReuse: false,
};

export function setup() {
  return journeySetup();
}

export default function (data) {
  const start = Date.now();
  journey(data);
  journeyDuration.add(Date.now() - start);
}

export function handleSummary(data) {
  return buildSummary(data, p, { durationS, maxVUs }, ENDPOINT_NAMES);
}
