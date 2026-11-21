// Verifies the app sends the right Slack messages (via a captured transport), only for committed work,
// and never includes personal data.
import test, { describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client, newUser, CARD, DECLINED_CARD } from '../helpers/harness.js';
import { setSlackTransport, resetSlackThrottle } from '../../slack.js';

let app, base;
let sent = [];
const titles = () => sent.map((m) => m.text.split(' - ')[0]);
const flush = () => new Promise((r) => setTimeout(r, 50)); // notifications are fire-and-forget

before(async () => {
  app = await startApp({ demoTools: true, authLimit: 1000, generalLimit: 100000 });
  base = app.base;
  setSlackTransport(async (_url, payload) => { sent.push(payload); });
});
after(async () => { setSlackTransport(null); await app?.close(); });
beforeEach(() => { sent = []; resetSlackThrottle(); });

describe('Slack notifications', () => {
  test('sign-up sends an anonymous "New learner signed up"', async () => {
    const c = client(base);
    const email = `slack-signup-${Date.now()}@example.com`;
    await c.post('/auth/register', { name: 'Slack Person', email, password: 'Secret123' });
    await flush();
    assert.deepEqual(titles(), ['New learner signed up']);
    const all = JSON.stringify(sent);
    assert.ok(!all.includes(email) && !all.includes('Slack Person') && !all.includes('Secret123'), 'no PII in Slack');
    assert.match(sent[0].text, /User: #\d+/);
  });

  test('purchase -> "Course purchased" with course and amount; repeat purchase sends nothing more', async () => {
    const u = await newUser(base);
    sent = [];
    await u.post('/courses/1/purchase', { card: CARD });
    await flush();
    assert.deepEqual(titles(), ['Course purchased']);
    assert.match(sent[0].text, /Python for Everybody/);
    assert.match(sent[0].text, /\$49/);
    await u.post('/courses/1/purchase', { card: CARD }); // 409, rolled back
    await flush();
    assert.equal(sent.length, 1);
  });

  test('declined card -> a warning, and no purchase message', async () => {
    const u = await newUser(base);
    sent = [];
    await u.post('/courses/2/purchase', { card: DECLINED_CARD });
    await flush();
    assert.deepEqual(titles(), ['Payment declined']);
  });

  test('double-click purchase notifies exactly once', async () => {
    const u = await newUser(base);
    sent = [];
    await Promise.all(Array.from({ length: 5 }, () => u.post('/courses/3/purchase', { card: CARD })));
    await flush();
    assert.equal(titles().filter((t) => t === 'Course purchased').length, 1);
  });

  test('subscription lifecycle sends one message per event', async () => {
    const u = await newUser(base);
    sent = [];
    await u.post('/subscription/subscribe', { planId: 1, cycle: 'monthly', card: CARD });
    await u.post('/subscription/change', { planId: 2, cycle: 'monthly' }); // upgrade
    await u.post('/subscription/change', { planId: 1, cycle: 'monthly' }); // downgrade scheduled
    await u.post('/subscription/cancel-change');
    await u.post('/subscription/cancel');
    await u.post('/subscription/resume');
    await u.post('/subscription/cancel');
    await u.post('/subscription/demo-expire'); // -> expired (no message for the demo helper itself)
    await u.post('/subscription/renew');
    await flush();
    assert.deepEqual(titles(), [
      'New subscription', 'Plan upgraded', 'Downgrade scheduled', 'Scheduled plan change withdrawn',
      'Subscription cancellation scheduled', 'Subscription resumed', 'Subscription cancellation scheduled',
      'Subscription expired', 'Subscription renewed',
    ]);
  });

  test('auto-renewal at period end is reported', async () => {
    const u = await newUser(base);
    await u.post('/subscription/subscribe', { planId: 1, cycle: 'monthly', card: CARD });
    sent = [];
    await u.post('/subscription/demo-expire');
    await flush();
    assert.deepEqual(titles(), ['Subscription auto-renewed']);
  });

  test('rejected requests (validation, 401, 403) send no business messages', async () => {
    const u = await newUser(base);
    sent = [];
    await u.post('/subscription/subscribe', { planId: 99, cycle: 'monthly', card: CARD });
    await u.post('/courses/4/enroll');
    await client(base).get('/my/courses');
    await u.post('/subscription/change', { planId: 1, cycle: 'monthly' });
    await flush();
    assert.equal(sent.length, 0, titles().join());
  });

  test('a Slack outage never breaks or delays the API', async () => {
    setSlackTransport(async () => { throw new Error('slack is down'); });
    const started = Date.now();
    const u = await newUser(base);
    const r = await u.post('/courses/5/purchase', { card: CARD });
    assert.equal(r.status, 200);
    assert.ok(Date.now() - started < 5000);
    setSlackTransport(async (_u, p) => { sent.push(p); });
  });

  test('hitting the auth rate limit raises one throttled security alert', async () => {
    const limited = await app.listen({ authLimit: 2, generalLimit: 1000 });
    const c = client(limited);
    sent = [];
    for (let i = 0; i < 6; i++) await c.post('/auth/login', { email: 'x@example.com', password: 'Wrong1234' });
    await flush();
    assert.deepEqual(titles(), ['Login/register rate limit triggered']); // 4 blocked requests, 1 alert
  });
});
