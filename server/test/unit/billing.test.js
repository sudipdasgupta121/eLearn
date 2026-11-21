import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, isUpgrade, periodMs, priceOf, prorate, round2 } from '../../lib/billing.js';

const basic = { rank: 1, price_monthly: 9, price_yearly: 90 };
const pro = { rank: 2, price_monthly: 19, price_yearly: 190 };

test('periodMs: monthly=30d, yearly=365d', () => {
  assert.equal(periodMs('monthly'), 30 * DAY);
  assert.equal(periodMs('yearly'), 365 * DAY);
});

test('priceOf picks the right cycle price', () => {
  assert.equal(priceOf(pro, 'monthly'), 19);
  assert.equal(priceOf(pro, 'yearly'), 190);
});

test('round2', () => {
  assert.equal(round2(1.2345), 1.23);
  assert.equal(round2(4.5), 4.5);
});

test('isUpgrade: higher tier is an upgrade, lower tier is not', () => {
  assert.equal(isUpgrade(basic, 'monthly', pro, 'monthly'), true);
  assert.equal(isUpgrade(pro, 'monthly', basic, 'monthly'), false);
});

test('isUpgrade: same tier monthly->yearly is an upgrade, yearly->monthly is not', () => {
  assert.equal(isUpgrade(pro, 'monthly', pro, 'yearly'), true);
  assert.equal(isUpgrade(pro, 'yearly', pro, 'monthly'), false);
});

test('isUpgrade: higher tier is an upgrade regardless of cycle change', () => {
  assert.equal(isUpgrade(basic, 'yearly', pro, 'monthly'), true);
});

test('prorate: half the period left credits half the old price', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date(start.getTime() + 30 * DAY);
  const now = new Date(start.getTime() + 15 * DAY);
  assert.deepEqual(prorate({ oldPrice: 9, newPrice: 19, periodStart: start, periodEnd: end, now }), { credit: 4.5, amount: 14.5 });
});

test('prorate: full period left credits full old price', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date(start.getTime() + 30 * DAY);
  assert.deepEqual(prorate({ oldPrice: 9, newPrice: 19, periodStart: start, periodEnd: end, now: start }), { credit: 9, amount: 10 });
});

test('prorate: expired period gives no credit and charges the full price', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date(start.getTime() + 30 * DAY);
  const now = new Date(end.getTime() + DAY);
  assert.deepEqual(prorate({ oldPrice: 9, newPrice: 19, periodStart: start, periodEnd: end, now }), { credit: 0, amount: 19 });
});

test('prorate: never charges a negative amount', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date(start.getTime() + 30 * DAY);
  const r = prorate({ oldPrice: 29, newPrice: 9, periodStart: start, periodEnd: end, now: start });
  assert.equal(r.amount, 0);
  assert.equal(r.credit, 29);
});

test('prorate: zero-length period does not divide by zero', () => {
  const t = new Date('2026-01-01T00:00:00Z');
  const r = prorate({ oldPrice: 9, newPrice: 19, periodStart: t, periodEnd: t, now: t });
  assert.deepEqual(r, { credit: 0, amount: 19 });
});
