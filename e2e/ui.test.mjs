// Browser end-to-end test (headless). Drives the real UI against a running server.
//   BASE=http://localhost:4000 npm test            (uses installed Edge/Chrome via BROWSER_CHANNEL, default msedge)
// WARNING: creates a new user + data in whatever database the target server uses. Point it at a LOCAL/test DB.
// Start the server with ENABLE_DEMO_TOOLS=true to also exercise the billing "fast-forward" step.
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:4000';
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
const step = (s) => console.log('PASS  ' + s);

try {
  await page.goto(BASE);
  await page.waitForSelector('.course-card');
  step('home renders courses');
  await page.fill('.search input', 'sql');
  await page.click('.search button');
  await page.waitForSelector('.course-card');
  step('search from landing page');

  await page.goto(BASE + '/my-learning');
  await page.waitForURL('**/login');
  step('protected route redirects to login');
  await page.click('text=Create an account');
  await page.fill('label:has-text("Full name") input', 'UI Tester');
  await page.fill('input[type=email]', `ui${Date.now()}@example.com`);
  await page.fill('input[type=password]', 'Secret123');
  await page.click('button:has-text("Sign up")');
  await page.waitForURL('**/my-learning');
  step('register + redirect back');

  const token = await page.evaluate(() => JSON.stringify(localStorage) + document.cookie);
  if (/upskill_session|jwt|token/i.test(token)) throw new Error('session token is readable from JavaScript');
  step('session cookie is not readable by JS (httpOnly)');

  await page.goto(BASE + '/courses/1');
  await page.click('text=Buy this course');
  await page.click('.modal button:has-text("Pay now")');
  await page.waitForURL('**/learn/1');
  step('purchase course -> learn page');
  await page.click('button:has-text("Mark complete & continue")');
  await page.waitForSelector('.dot.done');
  step('lesson completed');

  await page.goto(BASE + '/pricing');
  await page.click('button:has-text("Choose Basic")');
  await page.click('.modal button:has-text("Subscribe")');
  await page.waitForURL('**/account');
  await page.waitForSelector('text=Basic plan');
  step('subscribed to Basic');
  await page.goto(BASE + '/pricing');
  await page.click('button:has-text("Upgrade to Pro")');
  await page.waitForSelector('.alert-ok');
  step('upgraded to Pro');
  await page.click('button:has-text("Downgrade to Basic")');
  await page.waitForSelector('text=scheduled');
  step('downgrade scheduled');

  await page.goto(BASE + '/account');
  await page.waitForSelector('.alert-info');
  page.once('dialog', (d) => d.accept());
  await page.click('text=Cancel subscription');
  await page.waitForSelector('.pill-warn');
  await page.click('text=Resume subscription');
  await page.waitForSelector('.pill-ok');
  step('cancel + resume');

  if (await page.locator('text=Fast-forward').count()) {
    await page.click('text=Fast-forward');
    await page.waitForSelector('.alert-ok');
    step('billing period fast-forward (demo tools on)');
  } else {
    step('demo tools correctly hidden (ENABLE_DEMO_TOOLS is off)');
  }

  await page.click('button:has-text("Log out")');
  await page.goto(BASE + '/account');
  await page.waitForURL('**/login');
  step('logout ends the session');

  await page.goto(BASE + '/does-not-exist');
  await page.waitForSelector('text=404');
  step('404 page');
} catch (e) {
  console.error('FAIL ', e.message);
  await page.screenshot({ path: 'failure.png' }).catch(() => {});
  problems.push('test aborted');
}
await browser.close();
if (problems.length) { console.error('\nProblems:\n' + problems.join('\n')); process.exit(1); }
console.log('\nAll UI checks passed, no browser console errors');
