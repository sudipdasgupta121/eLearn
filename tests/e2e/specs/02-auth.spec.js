import { test as base, expect } from '@playwright/test';
import { test, PASSWORD } from '../fixtures/app.js';

const uniqueEmail = () => `e2e-auth-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

base.describe('Register & log in', () => {
  base('protected page redirects to login, then returns after registering', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login/);
    await page.getByRole('link', { name: 'Create an account' }).click();
    await page.getByLabel('Full name').fill('Ada Lovelace');
    await page.getByLabel('Email').fill(uniqueEmail());
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();
    await expect(page.getByRole('link', { name: "Ada's account" })).toBeVisible();
  });

  base('server-side password policy is surfaced to the user', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Full name').fill('Weak Pass');
    await page.getByLabel('Email').fill(uniqueEmail());
    await page.getByLabel('Password').fill('12345678'); // 8 chars, but no letter
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.getByText('Password must contain at least one letter and one number')).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
  });

  base('registering an existing email is rejected', async ({ page }) => {
    const email = uniqueEmail();
    const res = await page.request.post('/api/auth/register', {
      headers: { 'X-Requested-With': 'upskill' }, data: { name: 'First', email, password: PASSWORD },
    });
    expect(res.ok()).toBeTruthy();
    await page.context().clearCookies();
    await page.goto('/register');
    await page.getByLabel('Full name').fill('Second');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.getByText('An account with this email already exists')).toBeVisible();
  });
});

test.describe('Session behaviour', () => {
  test('login with wrong password fails, correct password works, logout ends the session', async ({ page, user }) => {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill('Wrong12345');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText('Invalid email or password')).toBeVisible();

    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/my-learning/);
    await expect(page.getByRole('heading', { name: /Welcome back, E2E/ })).toBeVisible();

    await page.reload(); // session survives a refresh
    await expect(page.getByRole('heading', { name: /Welcome back, E2E/ })).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
    await page.goto('/my-learning');
    await expect(page).toHaveURL(/\/login/);
  });

  test('session token is an httpOnly cookie, never exposed to page JavaScript', async ({ page, user }) => {
    await page.goto('/my-learning');
    const cookie = (await page.context().cookies()).find((c) => c.name === 'upskill_session');
    expect(cookie, `session cookie for ${user.email}`).toBeTruthy();
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    const exposed = await page.evaluate(() => ({ cookie: document.cookie, storage: JSON.stringify({ ...localStorage, ...sessionStorage }) }));
    expect(exposed.cookie).not.toContain('upskill_session');
    expect(exposed.storage).not.toMatch(/token|jwt|session/i);
  });

  test('an expired/cleared session sends the user back to login', async ({ page, user }) => {
    await page.goto('/my-learning');
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
    await page.context().clearCookies();
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login/);
    expect(user.email).toContain('@example.test');
  });
});
