import { test, expect, openCourse, pay, subscribe } from '../fixtures/app.js';

const pill = (page) => page.locator('.pill');
const acceptNextDialog = (page) => page.once('dialog', (d) => d.accept());
const fastForward = async (page) => {
  await page.getByRole('button', { name: 'Fast-forward to end of billing period' }).click();
  await expect(page.getByText(/Billing period ended/)).toBeVisible();
};

test.describe('Subscribe & plan access', () => {
  test('subscribe to Basic: account, payment history and tier access', async ({ page }) => {
    await subscribe(page, 'Basic');
    await expect(pill(page)).toHaveText('Active');
    await expect(page.getByText(/\$9\/month · billed monthly · card •••• 4242/)).toBeVisible();
    await expect(page.getByText('Next renewal')).toBeVisible();
    const row = page.getByRole('row', { name: /New subscription/ });
    await expect(row).toContainText('Basic plan (monthly)');
    await expect(row).toContainText('$9.00');

    // a Basic-tier course can be enrolled for free ...
    await openCourse(page, 'Data Analysis with SQL');
    await page.getByRole('button', { name: 'Enroll free with your plan' }).click();
    await expect(page).toHaveURL(/\/learn\//);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('SELECT basics');

    // ... but a Pro-tier course cannot
    await openCourse(page, 'Full-Stack Web Development');
    await expect(page.getByRole('button', { name: 'Enroll free with your plan' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Pro.*plan or higher/ })).toBeVisible();
  });

  test('declined card creates no subscription', async ({ page }) => {
    await page.goto('/pricing');
    await page.getByRole('button', { name: 'Choose Pro' }).click();
    await pay(page, { submit: /^Subscribe/, number: '4000 0000 0000 0002' });
    await expect(page.getByText(/Payment declined/)).toBeVisible();
    await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click();
    await page.goto('/account');
    await expect(page.getByText("You don't have a subscription yet.")).toBeVisible();
  });

  test('yearly billing is charged and shown as yearly', async ({ page }) => {
    await page.goto('/pricing');
    await page.getByRole('button', { name: /^Yearly/ }).click();
    await page.getByRole('button', { name: 'Choose Pro' }).click();
    await expect(page.locator('.total')).toContainText('$190.00');
    await pay(page, { submit: /^Subscribe/ });
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByText(/\$190\/year · billed yearly/)).toBeVisible();
  });
});

test.describe('Upgrade & downgrade', () => {
  test('upgrade is immediate, prorated, and unlocks higher-tier courses', async ({ page }) => {
    await subscribe(page, 'Basic');
    await page.goto('/pricing');
    await page.getByRole('button', { name: 'Upgrade to Pro' }).click();
    await expect(page.getByText(/Upgraded to Pro\. Charged \$\d+\.\d{2}/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Current plan' })).toBeDisabled();

    await page.getByRole('link', { name: 'Manage subscription' }).click();
    await expect(page.getByRole('heading', { name: /Pro plan/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Upgrade/ })).toContainText('prorated credit');

    await openCourse(page, 'Full-Stack Web Development');
    await page.getByRole('button', { name: 'Enroll free with your plan' }).click();
    await expect(page).toHaveURL(/\/learn\//);
  });

  test('downgrade is scheduled, can be undone, and keeps current benefits', async ({ page }) => {
    await subscribe(page, 'Pro');
    await page.goto('/pricing');
    await page.getByRole('button', { name: 'Downgrade to Basic' }).click();
    await expect(page.getByText(/Downgrade to Basic scheduled for/)).toBeVisible();

    await page.goto('/account');
    await expect(page.getByRole('heading', { name: /Pro plan/ })).toBeVisible(); // still Pro until period end
    await expect(page.getByText(/Scheduled change: switching to/)).toContainText('Basic');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Scheduled plan change removed.')).toBeVisible();
    await expect(page.getByText(/Scheduled change:/)).toHaveCount(0);
  });

  test('scheduled downgrade applies at period end and locks higher-tier courses', async ({ page }) => {
    await subscribe(page, 'Pro');
    await openCourse(page, 'Full-Stack Web Development');
    await page.getByRole('button', { name: 'Enroll free with your plan' }).click();
    await expect(page).toHaveURL(/\/learn\/(\d+)/);
    const learnUrl = page.url();

    await page.goto('/pricing');
    await page.getByRole('button', { name: 'Downgrade to Basic' }).click();
    await expect(page.getByText(/scheduled for/)).toBeVisible();

    await page.goto('/account');
    await fastForward(page);
    await expect(page.getByRole('heading', { name: /Basic plan/ })).toBeVisible();
    await expect(pill(page)).toHaveText('Active');
    await expect(page.getByRole('row', { name: /Renewal/ })).toContainText('Basic (monthly) auto-renewal');

    await page.goto('/my-learning');
    await expect(page.getByText('🔒 Locked')).toBeVisible();
    await expect(page.getByText(/courses? (is|are) locked/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Unlock' })).toBeVisible();

    await page.goto(learnUrl);
    await expect(page.getByText(/no longer covers this course/)).toBeVisible();
  });
});

test.describe('Cancel, resume, renew', () => {
  test('cancel at period end, then resume', async ({ page }) => {
    await subscribe(page, 'Basic');
    acceptNextDialog(page);
    await page.getByRole('button', { name: 'Cancel subscription' }).click();
    await expect(page.getByText('Cancellation scheduled.')).toBeVisible();
    await expect(pill(page)).toHaveText('Cancelling');
    await expect(page.getByText(/will not renew/)).toBeVisible();
    await expect(page.getByText('Access ends')).toBeVisible();

    await page.getByRole('button', { name: 'Resume subscription' }).click();
    await expect(page.getByText('Subscription resumed.')).toBeVisible();
    await expect(pill(page)).toHaveText('Active');
    await expect(page.getByText('Next renewal')).toBeVisible();
  });

  test('cancelled subscription expires, locks access, and can be renewed', async ({ page }) => {
    await subscribe(page, 'Basic');
    await openCourse(page, 'Data Analysis with SQL');
    await page.getByRole('button', { name: 'Enroll free with your plan' }).click();
    await expect(page).toHaveURL(/\/learn\//);

    await page.goto('/account');
    acceptNextDialog(page);
    await page.getByRole('button', { name: 'Cancel subscription' }).click();
    await expect(pill(page)).toHaveText('Cancelling');
    await fastForward(page);
    await expect(pill(page)).toHaveText('Expired');
    await expect(page.getByText(/Your subscription has expired/)).toBeVisible();

    await page.goto('/my-learning');
    await expect(page.getByText('🔒 Locked')).toBeVisible();

    await page.goto('/account');
    await page.getByRole('button', { name: 'Renew $9' }).click();
    await expect(page.getByText('Subscription renewed. Welcome back!')).toBeVisible();
    await expect(pill(page)).toHaveText('Active');
    await expect(page.getByRole('row', { name: /Renewal/ })).toContainText('$9.00');

    await page.goto('/my-learning');
    await expect(page.getByText('🔒 Locked')).toHaveCount(0); // access restored
  });

  test('early renewal adds another billing period', async ({ page }) => {
    await subscribe(page, 'Basic');
    const period = page.locator('dl.kv dd').first();
    const before = await period.textContent();
    acceptNextDialog(page);
    await page.getByRole('button', { name: 'Renew early' }).click();
    await expect(page.getByText(/Renewed early/)).toBeVisible();
    await expect(page.locator('dl.kv dd').nth(1)).not.toHaveText(before.split('–')[1].trim());
    await expect(page.getByRole('row', { name: /Renewal/ })).toBeVisible();
  });

  test('an expired subscriber can choose a different plan', async ({ page }) => {
    await subscribe(page, 'Basic');
    acceptNextDialog(page);
    await page.getByRole('button', { name: 'Cancel subscription' }).click();
    await fastForward(page);
    await expect(pill(page)).toHaveText('Expired');

    await page.getByRole('link', { name: 'Choose a different plan' }).click();
    await expect(page.getByText(/Your subscription expired/)).toBeVisible();
    await page.getByRole('button', { name: 'Choose Premium' }).click();
    await pay(page, { submit: /^Subscribe/ });
    await expect(page.getByRole('heading', { name: /Premium plan/ })).toBeVisible();
    await expect(pill(page)).toHaveText('Active');
  });
});
