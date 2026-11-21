// On-demand performance regression runner (generic - app specifics live in perf.config.js,
// prepare-test-db.js and k6/journeys.js).
//
//   TEST_DATABASE_URL=<fresh test db> npm run perf -- --tps=20 --vus=50 --total-users=2000 --p95-ms=800
//
// Flow: validate parameters + test DB -> prepare DB -> build + start the app on an isolated port
// against the test DB -> k6 -> stop app -> compare with the stored baseline for these parameters.
// Exit code 0 = pass, 1 = thresholds failed or regression vs baseline, 2 = setup/usage error.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseEnv } from "dotenv";
import { assertSafeTestDatabase } from "./lib/dbguard.js";
import { deriveScenario, feasibility, paramKey, parseArgs, readParams } from "./lib/params.js";
import { baselinePath, compareToBaseline, readBaseline, writeBaseline } from "./compare-baseline.js";

const HERE = import.meta.dirname;
const RESULTS = path.join(HERE, "results");
const BASELINES = path.join(HERE, "baselines");

function fail(msg, code = 2) {
  console.error(`\n[perf] ${msg}\n`);
  process.exit(code);
}

function findK6() {
  const candidates = [process.env.K6_BIN, "k6", path.join(os.homedir(), ".k6", "bin", process.platform === "win32" ? "k6.exe" : "k6")].filter(Boolean);
  for (const c of candidates) {
    if (spawnSync(c, ["version"], { stdio: "ignore" }).status === 0) return c;
  }
  return null;
}

async function waitForReady(url, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`App did not become ready at ${url} within ${ms / 1000}s`);
}

function stopTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else try { process.kill(-child.pid, "SIGTERM"); } catch {}
}

async function main() {
  const flags = parseArgs();
  const cfg = (await import("./perf.config.js")).default;

  // 1. Parameters: required every run, no defaults.
  let params;
  try { params = readParams(flags); } catch (e) { fail(e.message); }
  const scenario = deriveScenario(params);

  // 2. Test database: must be supplied for THIS run (never read from a file) and must not be the real DB.
  const testUrl = process.env.TEST_DATABASE_URL ?? flags.db;
  let dbId;
  try { dbId = assertSafeTestDatabase(testUrl, cfg.appRoot, cfg.realDbEnvVars); } catch (e) { fail(e.message); }

  // Non-DB settings (ports, secrets) may come from .env.perf. A DB URL in that file is ignored on purpose.
  const envFile = path.join(HERE, ".env.perf");
  const fileEnv = existsSync(envFile) ? parseEnv(readFileSync(envFile)) : {};
  if (fileEnv.TEST_DATABASE_URL) console.warn("[perf] Ignoring TEST_DATABASE_URL in .env.perf - the DB URL must be provided fresh for every run.");
  delete fileEnv.TEST_DATABASE_URL;

  const k6 = findK6();
  if (!k6) fail("k6 not found. Install it (https://grafana.com/docs/k6/latest/set-up/install-k6/) or set K6_BIN.");

  const port = Number(fileEnv.PERF_PORT ?? process.env.PERF_PORT ?? cfg.defaultPort);
  const baseUrl = `http://localhost:${port}`;
  const appEnv = { ...process.env, ...fileEnv };
  for (const n of cfg.realDbEnvVars) delete appEnv[n]; // the app must never see the real DB URL
  Object.assign(appEnv, cfg.appEnv({ testUrl, port, baseUrl, fileEnv: { ...process.env, ...fileEnv } }));

  console.log(`[perf] test database : ${dbId}`);
  console.log(`[perf] parameters    : ${params.tps} TPS | ${params.vus} concurrent users | ${params.totalUsers} total users | p95 < ${params.p95Ms} ms`);
  console.log(`[perf] derived       : ${scenario.durationS}s run, ~${scenario.effectiveTps.toFixed(2)} TPS, max ${scenario.maxVUs} VUs`);
  for (const n of scenario.notes) console.log(`[perf] note          : ${n}`);
  const warn = feasibility(params, scenario);
  if (warn) console.warn(`[perf] WARNING       : ${warn}`);

  // 3. Prepare DB (schema, reset, deterministic seed volume).
  const { prepareTestDatabase } = await import("./prepare-test-db.js");
  await prepareTestDatabase({ testUrl, appRoot: cfg.appRoot, env: appEnv, flags });

  // 4. Build + start the app against the test DB.
  if (!flags["skip-build"] && cfg.build) {
    console.log(`[perf] building: ${cfg.build}`);
    const b = spawnSync(cfg.build, { cwd: cfg.appRoot, env: appEnv, stdio: "inherit", shell: true });
    if (b.status !== 0) fail("Build failed.");
  }
  console.log(`[perf] starting app on ${baseUrl}`);
  const app = spawn(cfg.start, { cwd: cfg.appRoot, env: appEnv, stdio: ["ignore", "pipe", "pipe"], shell: true, detached: process.platform !== "win32" });
  let appLog = "";
  app.stdout.on("data", (d) => (appLog += d));
  app.stderr.on("data", (d) => (appLog += d));
  let exitCode = 0;
  try {
    await waitForReady(baseUrl + cfg.readyPath);

    // 5. k6.
    mkdirSync(RESULTS, { recursive: true });
    const resultFile = path.join(RESULTS, "latest.json");
    rmSync(resultFile, { force: true });
    const env = {
      PERF_TPS: params.tps, PERF_VUS: params.vus, PERF_TOTAL_USERS: params.totalUsers, PERF_P95_MS: params.p95Ms,
      PERF_MAX_ERROR_PCT: params.maxErrorPct, PERF_DURATION_S: scenario.durationS,
      PERF_BASE_URL: baseUrl, PERF_RESULT_FILE: resultFile, ...cfg.k6Env({ fileEnv: { ...process.env, ...fileEnv } }),
      ...(params.p99Ms ? { PERF_P99_MS: params.p99Ms } : {}), ...(params.avgMs ? { PERF_AVG_MS: params.avgMs } : {}),
    };
    const args = ["run", "--quiet", ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]), path.join(HERE, "k6", "main.js")];
    console.log("[perf] running k6 ...");
    const k = spawnSync(k6, args, { stdio: "inherit" });
    if (!existsSync(resultFile)) throw new Error(`k6 produced no result file (exit ${k.status}). App log tail:\n${appLog.slice(-1500)}`);
    const result = JSON.parse(readFileSync(resultFile, "utf-8"));
    if (!result.passed) exitCode = 1;

    // 6. Baseline.
    const file = baselinePath(BASELINES, paramKey(params));
    if (flags["update-baseline"]) {
      if (!result.passed) { console.error("[perf] Refusing to record a baseline from a run that failed its thresholds."); exitCode = 1; }
      else { writeBaseline(file, result); console.log(`[perf] baseline written: ${path.relative(process.cwd(), file)}`); }
    } else if (!flags["no-baseline-check"]) {
      const base = readBaseline(file);
      if (!base) console.log(`[perf] No baseline for ${paramKey(params)} yet - regression check skipped. Record one with: npm run perf:baseline -- <same parameters>`);
      else {
        const findings = compareToBaseline(result, base, params.regressionPct);
        if (findings.length) { console.error(`[perf] REGRESSION vs baseline (${base.finishedAt}):\n  - ${findings.join("\n  - ")}`); exitCode = 1; }
        else console.log(`[perf] No regression vs baseline (${base.finishedAt}, tolerance +${params.regressionPct}%).`);
      }
    }
  } catch (e) {
    console.error(`[perf] ${e.message}`);
    exitCode = 2;
  } finally {
    stopTree(app);
  }
  process.exit(exitCode);
}

main();
