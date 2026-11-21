// Regression gate: compares a run's result.json with the stored baseline for the SAME
// parameter set (baselines/<tpsX-vusY-usersZ>.json). Different parameters = different baseline,
// so a heavier run is never judged against a lighter one.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function baselinePath(dir, key) {
  return path.join(dir, `${key}.json`);
}

export function compareToBaseline(result, baseline, tolerancePct) {
  const tol = 1 + tolerancePct / 100;
  const findings = [];
  const worse = (name, cur, base, { floorMs = 0 } = {}) => {
    if (cur == null || base == null) return;
    if (base < floorMs && cur < floorMs) return; // ignore noise on very fast endpoints
    if (cur > base * tol) findings.push(`${name}: ${base} -> ${cur} ms (+${(((cur - base) / base) * 100).toFixed(0)}%, limit +${tolerancePct}%)`);
  };
  for (const k of ["avg", "p95", "p99"]) worse(`latency ${k}`, result.latencyMs[k], baseline.latencyMs[k], { floorMs: 20 });
  for (const [name, e] of Object.entries(result.endpoints)) worse(`endpoint ${name} p95`, e.p95, baseline.endpoints?.[name]?.p95, { floorMs: 50 });
  if (result.errorRate > baseline.errorRate + 0.005)
    findings.push(`error rate: ${(baseline.errorRate * 100).toFixed(2)}% -> ${(result.errorRate * 100).toFixed(2)}% (limit +0.5 pt)`);
  if (result.achievedTps < baseline.achievedTps * 0.9)
    findings.push(`achieved TPS: ${baseline.achievedTps} -> ${Math.round(result.achievedTps * 10) / 10} (limit -10%)`);
  return findings;
}

export function readBaseline(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) : null;
}

export function writeBaseline(file, result) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(result, null, 2));
}
