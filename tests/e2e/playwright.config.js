// Playwright config for the upSkill UI regression suite.
// Non-negotiable: headless is ALWAYS false, and the app under test ALWAYS runs against
// TEST_DATABASE_URL (tests/e2e/.env.e2e), never the app's real DATABASE_URL.
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(import.meta.dirname, '.env.e2e') });

const PORT = process.env.E2E_PORT || '3100';
const BASE_URL = `http://localhost:${PORT}`;
const APP_ROOT = path.join(import.meta.dirname, '..', '..');

export default defineConfig({
  testDir: './specs',
  outputDir: path.join(import.meta.dirname, 'test-results'),
  timeout: 45_000,
  expect: { timeout: 8_000 },
  // Specs share one test database, so they run sequentially (deterministic > fast).
  workers: 1,
  fullyParallel: false,
  retries: 0,
  // HTML report is produced on EVERY run (tests/e2e/run.js archives + opens it).
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(import.meta.dirname, 'playwright-report'), open: 'never' }],
    ['json', { outputFile: path.join(import.meta.dirname, 'playwright-report', 'results.json') }],
  ],
  globalSetup: './global-setup.js',
  globalTeardown: './global-teardown.js',
  use: {
    baseURL: BASE_URL,
    headless: false,
    trace: 'on',
    screenshot: 'on',
    video: 'retain-on-failure',
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO || 0) },
  },
  webServer: {
    // DB prep is chained BEFORE build/start: Playwright starts webServer and globalSetup
    // concurrently, so the app must never connect to an unprepared database.
    command: 'node tests/e2e/prepare-test-db.js && npm run build && npm start',
    cwd: APP_ROOT,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL, // never the real one
      PORT,
      NODE_ENV: 'production', // production parity: secure cookies, CSP, HSTS, strict config
      JWT_SECRET: process.env.E2E_JWT_SECRET || 'e2e-only-secret-e2e-only-secret-e2e-only-1234',
      ENABLE_DEMO_TOOLS: 'true', // lets the suite fast-forward billing periods
      AUTH_RATE_LIMIT_MAX: '500', // many sign-ups from one IP in a single run
    },
  },
});
