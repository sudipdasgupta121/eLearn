// Benchmark parameters. There are deliberately NO defaults for the four required ones: the
// operator must state them for every run (the skill asks; this file enforces it in code).
//
//   TPS               target transactions (user journeys) started per second
//   Concurrent users  max virtual users in flight at once
//   Total users       total user journeys executed in the run
//   Latency           max p95 (required); p99 / avg optional, all in ms
//
// Sources, highest priority first: --flag=value on the command line, then PERF_* env vars.
const REQUIRED = [
  ["tps", "PERF_TPS", "target transactions per second (TPS)"],
  ["vus", "PERF_VUS", "number of concurrent users"],
  ["totalUsers", "PERF_TOTAL_USERS", "total number of users (journeys) for the run"],
  ["p95Ms", "PERF_P95_MS", "latency: max acceptable p95 response time in ms"],
];

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  for (const a of argv) {
    const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
    if (m) flags[m[1]] = m[2] ?? true;
  }
  return flags;
}

const num = (v) => (v === undefined || v === "" ? undefined : Number(v));

export function readParams(flags = parseArgs(), env = process.env) {
  const pick = (flag, envName) => flags[flag] ?? env[envName];
  const raw = {
    tps: num(pick("tps", "PERF_TPS")),
    vus: num(pick("vus", "PERF_VUS")),
    totalUsers: num(pick("total-users", "PERF_TOTAL_USERS")),
    p95Ms: num(pick("p95-ms", "PERF_P95_MS")),
    p99Ms: num(pick("p99-ms", "PERF_P99_MS")),
    avgMs: num(pick("avg-ms", "PERF_AVG_MS")),
    maxErrorPct: num(pick("max-error-pct", "PERF_MAX_ERROR_PCT")) ?? 1,
    regressionPct: num(pick("regression-pct", "PERF_REGRESSION_PCT")) ?? 25,
  };
  const missing = REQUIRED.filter(([k]) => raw[k] === undefined).map(([, e, d]) => `  ${e}  (${d})`);
  if (missing.length) {
    throw new Error(
      "Missing required performance parameters. They must be supplied for every run:\n" +
        missing.join("\n") +
        "\nPass as env vars or flags, e.g. --tps=20 --vus=50 --total-users=2000 --p95-ms=800"
    );
  }
  for (const [k, e] of REQUIRED) {
    if (!Number.isFinite(raw[k]) || raw[k] <= 0) throw new Error(`${e} must be a positive number (got ${raw[k]}).`);
  }
  for (const k of ["tps", "vus", "totalUsers"]) {
    if (!Number.isInteger(raw[k])) throw new Error(`${k} must be a whole number (got ${raw[k]}).`);
  }
  return raw;
}

// Translate the four parameters into a k6 arrival-rate scenario.
//  - total users  -> exactly this many journeys (iterations)
//  - TPS          -> journeys start at ~TPS per second (duration = floor(total/TPS), min 1s)
//  - concurrent   -> hard cap on VUs in flight; if the system can't keep up with TPS at this
//                    concurrency, k6 drops iterations and the run FAILS (dropped_iterations == 0)
export function deriveScenario(p) {
  const durationS = Math.max(1, Math.floor(p.totalUsers / p.tps));
  const maxVUs = Math.min(p.vus, p.totalUsers);
  return {
    durationS,
    effectiveTps: p.totalUsers / durationS,
    maxVUs,
    preAllocatedVUs: Math.min(maxVUs, 200),
    notes: [
      ...(p.vus > p.totalUsers ? [`concurrent users (${p.vus}) capped to total users (${p.totalUsers})`] : []),
      ...(p.totalUsers < p.tps ? [`total users (${p.totalUsers}) < TPS (${p.tps}); run lasts 1s`] : []),
    ],
  };
}

// Little's law: VUs needed ~= TPS x journey latency. Advisory only (k6 enforces it for real).
export function feasibility(p, scenario) {
  const needed = Math.ceil(p.tps * (p.p95Ms / 1000));
  return needed > scenario.maxVUs
    ? `Concurrency may be too low: sustaining ${p.tps} TPS at ~${p.p95Ms} ms needs ~${needed} concurrent users, ` +
        `but only ${scenario.maxVUs} allowed. Expect dropped iterations (the run will fail on them) - ` +
        `that is the signal that this TPS is not reachable at this concurrency.`
    : null;
}

export const paramKey = (p) => `tps${p.tps}-vus${p.vus}-users${p.totalUsers}`;
