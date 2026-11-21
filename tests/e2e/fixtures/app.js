// Shared fixtures/helpers for the specs.
import { test as base, expect } from '@playwright/test';

export { expect };

export const card = () => ({ number: '4242 4242 4242 4242', expiry: `12/${(new Date().getFullYear() + 3) % 100}`, cvc: '123' });
export const PASSWORD = 'Secret123';
const uniqueEmail = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

// Signs a brand-new user in through the real API (fast, no UI), then hands over the page.
// Sign-up and login through the UI itself are covered in 02-auth.spec.js.
export const test = base.extend({
  // auto: every test using this `test` starts as a freshly registered, signed-in learner
  user: [async ({ page }, use) => {
    const email = uniqueEmail();
    const res = await page.request.post('/api/auth/register', {
      headers: { 'X-Requested-With': 'upskill' },
      data: { name: 'E2E Learner', email, password: PASSWORD },
    });
    expect(res.ok()).toBeTruthy();
    await use({ email, password: PASSWORD, name: 'E2E Learner' });
  }, { auto: true }],
});

/** Fills and submits the payment modal. */
export async function pay(page, { submit, number } = {}) {
  const dialog = page.locator('.modal');
  await expect(dialog).toBeVisible();
  if (number) await dialog.getByLabel('Card number').fill(number);
  await dialog.getByRole('button', { name: submit }).click();
}

export async function openCourse(page, title) {
  await page.goto('/courses');
  await page.getByRole('link', { name: new RegExp(title) }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(title);
}

export async function subscribe(page, planName) {
  await page.goto('/pricing');
  await page.getByRole('button', { name: `Choose ${planName}` }).click();
  await pay(page, { submit: /^Subscribe/ });
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: new RegExp(`${planName} plan`) })).toBeVisible();
}
