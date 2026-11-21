import { test, expect, openCourse, pay } from '../fixtures/app.js';

test.describe('Buy a course and learn', () => {
  test('payment errors keep the modal open and charge nothing', async ({ page, user }) => {
    await openCourse(page, 'Python for Everybody');
    await page.getByRole('button', { name: /Buy this course/ }).click();

    await pay(page, { submit: /^Pay now/, number: '4000 0000 0000 0002' });
    await expect(page.getByText(/Payment declined/)).toBeVisible();

    await page.locator('.modal').getByLabel('Card number').fill('4242 4242 4242 4241'); // fails Luhn
    await page.locator('.modal').getByRole('button', { name: /^Pay now/ }).click();
    await expect(page.getByText('Invalid card number')).toBeVisible();

    await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click();
    await page.goto('/account');
    await expect(page.getByText('No payments yet.')).toBeVisible();
    expect(user.email).toBeTruthy();
  });

  test('purchase -> learn -> track progress -> complete the course', async ({ page }) => {
    await openCourse(page, 'Python for Everybody');
    await page.getByRole('button', { name: /Buy this course/ }).click();
    await pay(page, { submit: /^Pay now/ });

    // lands in the course player
    await expect(page).toHaveURL(/\/learn\/\d+/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Setting up Python');
    await expect(page.getByText('0/6 lessons · 0% complete')).toBeVisible();

    // complete lesson 1 -> moves on, progress updates
    await page.getByRole('button', { name: 'Mark complete & continue' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Variables and types');
    await expect(page.getByText('1/6 lessons · 17% complete')).toBeVisible();

    // dashboard reflects it
    await page.getByRole('link', { name: '← My learning' }).click();
    await expect(page.getByText('1/6 lessons')).toBeVisible();
    await expect(page.getByText('17% complete')).toBeVisible();
    await page.getByRole('link', { name: 'Continue' }).click();

    // undo lesson 1 from the lesson list
    await page.locator('.lesson-list button', { hasText: 'Setting up Python' }).click();
    await page.getByRole('button', { name: /Completed \(click to undo\)/ }).click();
    await expect(page.getByText('0/6 lessons · 0% complete')).toBeVisible();

    // finish everything
    for (let i = 0; i < 5; i++) {
      await page.getByRole('button', { name: /^Mark complete/ }).first().click();
    }
    await page.locator('.lesson-list button', { hasText: 'Working with files' }).click();
    await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
    await expect(page.getByText('6/6 lessons · 100% complete')).toBeVisible();
    await expect(page.getByText(/You've completed this course/)).toBeVisible();

    await page.goto('/my-learning');
    await expect(page.getByText('100% complete')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review' })).toBeVisible();
  });

  test('owned courses show "Go to course" and cannot be bought twice', async ({ page }) => {
    await openCourse(page, 'Data Analysis with SQL');
    await page.getByRole('button', { name: /Buy this course/ }).click();
    await pay(page, { submit: /^Pay now/ });
    await expect(page).toHaveURL(/\/learn\//);

    await openCourse(page, 'Data Analysis with SQL');
    await expect(page.getByRole('link', { name: 'Go to course' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Buy this course/ })).toHaveCount(0);

    await page.goto('/account');
    const row = page.getByRole('row', { name: /Course purchase/ });
    await expect(row).toContainText('Data Analysis with SQL');
    await expect(row).toContainText('$39.00');
    await expect(row).toContainText('4242');
  });

  test('a course you have not enrolled in cannot be opened directly', async ({ page }) => {
    await page.goto('/learn/1');
    await expect(page.getByText('Enroll in this course to start learning')).toBeVisible();
    await expect(page.getByRole('link', { name: 'View course options' })).toBeVisible();
  });
});
