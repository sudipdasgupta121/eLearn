// `npm run test:e2e` entry point: runs the (headed) Playwright suite, then ALWAYS produces a report:
//   - tests/e2e/playwright-report/        latest HTML report
//   - tests/e2e/reports/<timestamp>/      archived copy of every run (history)
// and opens the report in the browser (set E2E_NO_OPEN=1 to skip). Exit code = test result.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const reportDir = path.join(import.meta.dirname, 'playwright-report');
const archiveRoot = path.join(import.meta.dirname, 'reports');
const KEEP = Number(process.env.E2E_KEEP_REPORTS || 20);

const args = ['playwright', 'test', '--config=tests/e2e/playwright.config.js', ...process.argv.slice(2)];
const run = spawnSync('npx', args, { cwd: root, stdio: 'inherit', shell: true });
const code = run.status ?? 1;

if (existsSync(path.join(reportDir, 'index.html'))) {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const archived = path.join(archiveRoot, stamp);
  mkdirSync(archiveRoot, { recursive: true });
  cpSync(reportDir, archived, { recursive: true });
  // keep only the most recent runs
  readdirSync(archiveRoot).sort().slice(0, -KEEP).forEach((d) => rmSync(path.join(archiveRoot, d), { recursive: true, force: true }));

  try {
    const s = JSON.parse(readFileSync(path.join(reportDir, 'results.json'), 'utf-8')).stats;
    console.log(`\nResult: ${s.expected} passed, ${s.unexpected} failed, ${s.flaky} flaky, ${s.skipped} skipped (${Math.round(s.duration / 1000)}s)`);
  } catch { /* summary is optional */ }
  console.log(`HTML report : ${path.join(reportDir, 'index.html')}`);
  console.log(`Archived as : ${archived}`);

  if (!process.env.E2E_NO_OPEN && !process.env.CI) {
    const port = 9300 + Math.floor(Math.random() * 90);
    console.log(`Opening report at http://localhost:${port} (closes when you stop that process)`);
    spawn('npx', ['playwright', 'show-report', reportDir, '--port', String(port)], { cwd: root, detached: true, stdio: 'ignore', shell: true }).unref();
  }
} else {
  console.error('No HTML report was produced (the run likely failed before tests started).');
}
process.exit(code);
