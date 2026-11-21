import { test, expect } from '../fixtures/app.js';
import { test as anon } from '@playwright/test';

anon.describe('Access control (anonymous)', () => {
  for (const path of ['/my-learning', '/account', '/learn/1']) {
    anon(`${path} requires login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    });
  }

  anon('API refuses unauthenticated and CSRF-less requests', async ({ request }) => {
    expect((await request.get('/api/my/courses')).status()).toBe(401);
    expect((await request.post('/api/courses/1/purchase', { data: {} })).status()).toBe(403); // no CSRF header
  });
});

test.describe('Access control (logged in)', () => {
  test('one user cannot read another user\'s course content', async ({ page, browser, baseURL }) => {
    // user A (fixture) buys Python
    await page.request.post('/api/courses/1/purchase', {
      headers: { 'X-Requested-With': 'upskill' },
      data: { card: { number: '4242 4242 4242 4242', expiry: `12/${(new Date().getFullYear() + 3) % 100}`, cvc: '123' } },
    });
    await page.goto('/learn/1');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Setting up Python');

    // user B in a separate browser context
    const ctx = await browser.newContext({ baseURL });
    const other = await ctx.newPage();
    await other.request.post('/api/auth/register', {
      headers: { 'X-Requested-With': 'upskill' },
      data: { name: 'Other User', email: `e2e-other-${Date.now()}@example.test`, password: 'Secret123' },
    });
    await other.goto('/learn/1');
    await expect(other.getByText('Enroll in this course to start learning')).toBeVisible();
    await ctx.close();
  });

  test('plan tiers: Basic cannot enroll in a Pro course via the API either', async ({ page }) => {
    const headers = { 'X-Requested-With': 'upskill' };
    const card = { number: '4242 4242 4242 4242', expiry: `12/${(new Date().getFullYear() + 3) % 100}`, cvc: '123' };
    expect((await page.request.post('/api/subscription/subscribe', { headers, data: { planId: 1, cycle: 'monthly', card } })).ok()).toBeTruthy();
    const res = await page.request.post('/api/courses/3/enroll', { headers }); // Full-Stack = Pro tier
    expect(res.status()).toBe(403);
  });
});
