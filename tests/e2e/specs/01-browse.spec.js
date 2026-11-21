import { test, expect } from '@playwright/test';

test.describe('Discover & browse (anonymous)', () => {
  test('landing page shows hero, categories and popular courses', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Learn in-demand skills');
    await expect(page.getByRole('heading', { name: 'Browse by category' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Design/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Popular courses' })).toBeVisible();
    await expect(page.locator('.course-card').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'See plans' })).toBeVisible();
  });

  test('hero search leads to filtered results', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder(/What do you want to learn/).fill('sql');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/courses\?search=sql/);
    await expect(page.getByRole('link', { name: /Data Analysis with SQL/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /UI\/UX Design Essentials/ })).toHaveCount(0);
  });

  test('category chip filters the catalog', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /^Design/ }).click();
    await expect(page).toHaveURL(/category=Design/);
    await expect(page.getByRole('link', { name: /UI\/UX Design Essentials/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Python for Everybody/ })).toHaveCount(0);
  });

  test('level filter, sorting and empty state', async ({ page }) => {
    await page.goto('/courses');
    await expect(page.getByText(/13 courses/)).toBeVisible();

    await page.getByLabel('Level').selectOption('Advanced');
    await expect(page.getByRole('link', { name: /Deep Learning Specialization/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Python for Everybody/ })).toHaveCount(0);

    await page.getByLabel('Level').selectOption('');
    await page.getByLabel('Sort by').selectOption('price_asc');
    await expect(page.locator('.course-card .price').first()).toHaveText('$39');

    await page.getByLabel('Search courses').fill('zzzz-no-such-course');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('No courses match your filters.')).toBeVisible();
  });

  test('course detail shows syllabus and purchase options', async ({ page }) => {
    await page.goto('/courses');
    await page.getByRole('link', { name: /Python for Everybody/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Python for Everybody');
    await expect(page.getByRole('heading', { name: 'Course content' })).toBeVisible();
    await expect(page.getByText('1. Setting up Python')).toBeVisible();
    await expect(page.getByText(/6 lessons/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Buy this course · \$49/ })).toBeVisible();
    await expect(page.getByText(/Included in Basic plan/)).toBeVisible();
  });

  test('buying while logged out sends you to log in', async ({ page }) => {
    await page.goto('/courses');
    await page.getByRole('link', { name: /Python for Everybody/ }).click();
    await page.getByRole('button', { name: /Buy this course/ }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('pricing page lists plans and switches to yearly prices', async ({ page }) => {
    await page.goto('/pricing');
    for (const name of ['Basic', 'Pro', 'Premium']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByText('$19', { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: /^Yearly/ }).click();
    await expect(page.getByText('$190')).toBeVisible();
    await expect(page.getByText('$290')).toBeVisible();
  });

  test('unknown routes show the 404 page', async ({ page }) => {
    await page.goto('/this/does/not/exist');
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
    await page.getByRole('link', { name: 'Go home' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
