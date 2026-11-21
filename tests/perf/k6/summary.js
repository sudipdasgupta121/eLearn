// Turns k6's end-of-test data into (a) a console report and (b) a compact JSON result file that
// compare-baseline.js diffs against the stored baseline.
const v = (data, name, key) => data.metrics[name]?.values?.[key];
const r1 = (n) => (n === undefined ? null : Math.round(n * 10) / 10);

export function buildSummary(data, p, derived, endpointNames) {
  const failedThresholds = [];
  for (const [metric, m] of Object.entries(data.metrics)) {
    for (const [expr, t] of Object.entries(m.thresholds ?? {})) if (!t.ok) failedThresholds.push(`${metric}: ${expr}`);
  }
  const result = {
    finishedAt: new Date().toISOString(),
    params: p,
    derived,
    passed: failedThresholds.length === 0,
    failedThresholds,
    totals: {
      journeys: v(data, "iterations", "count"),
      requests: v(data, "http_reqs", "count"),
      droppedIterations: v(data, "dropped_iterations", "count") ?? 0,
      maxVUsReached: v(data, "vus_max", "max"),
    },
    achievedTps: r1(v(data, "iterations", "rate")),
    requestsPerSec: r1(v(data, "http_reqs", "rate")),
    errorRate: v(data, "http_req_failed", "rate") ?? 0,
    checkRate: v(data, "checks", "rate"),
    latencyMs: {
      avg: r1(v(data, "http_req_duration", "avg")),
      p50: r1(v(data, "http_req_duration", "med")),
      p90: r1(v(data, "http_req_duration", "p(90)")),
      p95: r1(v(data, "http_req_duration", "p(95)")),
      p99: r1(v(data, "http_req_duration", "p(99)")),
      max: r1(v(data, "http_req_duration", "max")),
    },
    journeyMs: { avg: r1(v(data, "journey_duration", "avg")), p95: r1(v(data, "journey_duration", "p(95)")) },
    endpoints: Object.fromEntries(
      endpointNames.map((n) => [
        n,
        {
          count: v(data, `http_reqs{name:${n}}`, "count") ?? 0,
          avg: r1(v(data, `http_req_duration{name:${n}}`, "avg")),
          p95: r1(v(data, `http_req_duration{name:${n}}`, "p(95)")),
        },
      ])
    ),
  };

  const pad = (s, n) => String(s).padEnd(n);
  const lines = [
    "",
    "================ PERFORMANCE RESULT ================",
    `Target : ${p.tps} TPS | ${p.vus} concurrent users | ${p.totalUsers} total users | p95 < ${p.p95Ms} ms` +
      (p.p99Ms ? ` | p99 < ${p.p99Ms} ms` : "") + (p.avgMs ? ` | avg < ${p.avgMs} ms` : ""),
    `Actual : ${result.achievedTps} TPS achieved (${result.totals.journeys} journeys, ${result.totals.requests} requests, ` +
      `${result.requestsPerSec} req/s) | max VUs used ${result.totals.maxVUsReached} | dropped ${result.totals.droppedIterations}`,
    `Latency: avg ${result.latencyMs.avg} | p50 ${result.latencyMs.p50} | p90 ${result.latencyMs.p90} | p95 ${result.latencyMs.p95} | p99 ${result.latencyMs.p99} | max ${result.latencyMs.max} (ms)`,
    `Errors : ${(result.errorRate * 100).toFixed(2)}% failed requests | checks ${((result.checkRate ?? 1) * 100).toFixed(2)}% passed`,
    "",
    `${pad("endpoint", 28)}${pad("count", 8)}${pad("avg ms", 10)}p95 ms`,
    ...Object.entries(result.endpoints).map(([n, e]) => `${pad(n, 28)}${pad(e.count, 8)}${pad(e.avg ?? "-", 10)}${e.p95 ?? "-"}`),
    "",
    result.passed ? "THRESHOLDS: PASS" : `THRESHOLDS: FAIL\n  - ${failedThresholds.join("\n  - ")}`,
    "====================================================",
    "",
  ];
  return { stdout: lines.join("\n"), [__ENV.PERF_RESULT_FILE]: JSON.stringify(result, null, 2) };
}
