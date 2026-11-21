import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client, newUser, CARD, DECLINED_CARD } from '../helpers/harness.js';

let app, base;
before(async () => {
  app = await startApp({ demoTools: true, authLimit: 1000, generalLimit: 100000 });
  base = app.base;
});
after(async () => { await app?.close(); });

const courses = async () => (await client(base).get('/courses')).data.courses;
const paymentsOf = async (u) => (await u.get('/payments')).data;

describe('catalog', () => {
  test('lists seeded courses and categories', async () => {
    const r = await client(base).get('/courses');
    assert.equal(r.status, 200);
    assert.equal(r.data.courses.length, 13);
    assert.ok(r.data.categories.length >= 5);
  });
  test('search, category, level and sort work', async () => {
    const c = client(base);
    assert.equal((await c.get('/courses?search=Python%20for')).data.courses.length, 1);
    assert.ok((await c.get('/courses?category=Design')).data.courses.every((x) => x.category === 'Design'));
    assert.ok((await c.get('/courses?level=Advanced')).data.courses.every((x) => x.level === 'Advanced'));
    const asc = (await c.get('/courses?sort=price_asc')).data.courses.map((x) => x.price);
    assert.deepEqual(asc, [...asc].sort((a, b) => a - b));
  });
  test('course detail shows syllabus without lesson content', async () => {
    const r = await client(base).get('/courses/1');
    assert.equal(r.status, 200);
    assert.ok(r.data.lessons.length > 0);
    assert.equal(r.data.lessons[0].content, undefined);
    assert.equal(r.data.access, false);
  });
  test('plans are public', async () => {
    const r = await client(base).get('/plans');
    assert.deepEqual(r.data.map((p) => p.name), ['Basic', 'Pro', 'Premium']);
  });
});

describe('auth', () => {
  test('register sets an httpOnly SameSite cookie and never returns the token in the body', async () => {
    const c = client(base);
    const r = await c.post('/auth/register', { name: 'A B', email: `reg${Date.now()}@example.com`, password: 'Secret123' });
    assert.equal(r.status, 200);
    assert.equal(r.data.token, undefined);
    assert.equal(r.data.user.password_hash, undefined);
    const sc = r.setCookies[0];
    assert.match(sc, /HttpOnly/i);
    assert.match(sc, /SameSite=Lax/i);
    assert.equal((await c.get('/auth/me')).status, 200);
  });
  test('duplicate email -> 409, email is case-insensitive', async () => {
    const u = await newUser(base);
    const r = await client(base).post('/auth/register', { name: 'X', email: u.email.toUpperCase(), password: 'Secret123' });
    assert.equal(r.status, 409);
  });
  test('weak passwords, bad emails and bad names are rejected', async () => {
    const c = client(base);
    const e = `w${Date.now()}@example.com`;
    for (const body of [
      { name: 'A', email: e, password: 'short1' }, { name: 'A', email: e, password: 'onlyletters' },
      { name: 'A', email: 'not-an-email', password: 'Secret123' }, { name: '', email: e, password: 'Secret123' },
      { name: 'A', email: e, password: { $ne: 1 } }, { name: ['a'], email: e, password: 'Secret123' },
    ]) assert.equal((await c.post('/auth/register', body)).status, 400, JSON.stringify(body));
  });
  test('login: right password works, wrong/unknown give the same 401 message', async () => {
    const u = await newUser(base);
    const ok = await client(base).post('/auth/login', { email: u.email, password: 'Secret123' });
    assert.equal(ok.status, 200);
    const wrong = await client(base).post('/auth/login', { email: u.email, password: 'Wrong1234' });
    const unknown = await client(base).post('/auth/login', { email: 'nobody@example.com', password: 'Wrong1234' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.data.error, unknown.data.error);
  });
  test('login ignores non-string credentials (no NoSQL/type confusion)', async () => {
    const r = await client(base).post('/auth/login', { email: { $gt: '' }, password: { $gt: '' } });
    assert.equal(r.status, 401);
  });
  test('tampered, foreign-secret and missing cookies are rejected', async () => {
    const u = await newUser(base);
    const good = u.cookie;
    u.cookie = good.slice(0, -3) + 'abc';
    assert.equal((await u.get('/auth/me')).data.user, null);
    const { default: jwt } = await import('jsonwebtoken');
    u.cookie = 'upskill_session=' + jwt.sign({ id: 1 }, 'some-other-secret');
    assert.equal((await u.get('/auth/me')).data.user, null);
    u.cookie = 'upskill_session=' + jwt.sign({ id: 1 }, '', { algorithm: 'none' });
    assert.equal((await u.get('/auth/me')).data.user, null);
    u.cookie = '';
    assert.equal((await u.get('/auth/me')).data.user, null);
  });
  test('logout clears the cookie', async () => {
    const u = await newUser(base);
    const r = await u.post('/auth/logout');
    assert.equal(r.status, 200);
    assert.equal((await u.get('/auth/me')).data.user, null);
  });
  test('protected endpoints require login', async () => {
    const c = client(base);
    for (const p of ['/my/courses', '/subscription', '/payments', '/courses/1/learn']) assert.equal((await c.get(p)).status, 401, p);
    for (const p of ['/courses/1/purchase', '/courses/1/enroll', '/lessons/1/complete', '/subscription/subscribe', '/subscription/cancel']) {
      assert.equal((await c.post(p)).status, 401, p);
    }
  });
});

describe('security hardening', () => {
  test('state-changing requests without the CSRF header are blocked', async () => {
    const u = await newUser(base);
    const r = await u.post('/courses/1/purchase', { card: CARD }, { csrf: false });
    assert.equal(r.status, 403);
    assert.equal((await u.get('/payments')).data.length, 0);
    assert.equal((await client(base).post('/auth/login', { email: u.email, password: 'Secret123' }, { csrf: false })).status, 403);
  });
  test('security headers are set and x-powered-by is hidden', async () => {
    const res = await fetch(base + '/api/health');
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.ok(res.headers.get('strict-transport-security'));
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
  test('malformed JSON -> 400, oversized body -> 413, no stack traces leak', async () => {
    const c = client(base);
    const m = await c.post('/auth/login', '{bad json');
    assert.equal(m.status, 400);
    assert.equal(m.data.error, 'Malformed JSON');
    const big = await c.post('/auth/login', JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(50_000) }));
    assert.equal(big.status, 413);
    assert.deepEqual(Object.keys(m.data), ['error']);
  });
  test('invalid ids never reach SQL (404, not 500)', async () => {
    const u = await newUser(base);
    for (const id of ['abc', '0', '-1', '1.5', '99999999999', '1;DROP TABLE users', 'NaN']) {
      assert.equal((await u.get(`/courses/${encodeURIComponent(id)}`)).status, 404, id);
      assert.equal((await u.post(`/lessons/${encodeURIComponent(id)}/complete`)).status, 404, id);
    }
  });
  test('SQL injection / wildcard payloads in search are treated as plain text', async () => {
    const c = client(base);
    for (const q of ["' OR '1'='1", "'; DROP TABLE courses; --", '%', '_']) {
      const r = await c.get('/courses?search=' + encodeURIComponent(q));
      assert.equal(r.status, 200);
      assert.equal(r.data.courses.length, 0, q);
    }
    assert.equal((await courses()).length, 13);
    const sort = await c.get('/courses?sort=' + encodeURIComponent('price; DROP TABLE courses'));
    assert.equal(sort.status, 200);
  });
  test('users cannot touch each other\'s data', async () => {
    const [a, b] = [await newUser(base), await newUser(base)];
    assert.equal((await a.post('/courses/1/purchase', { card: CARD })).status, 200);
    const lessonId = (await a.get('/courses/1/learn')).data.lessons[0].id;
    assert.equal((await a.post(`/lessons/${lessonId}/complete`)).status, 200);
    assert.equal((await b.get('/courses/1/learn')).status, 403);
    assert.equal((await b.post(`/lessons/${lessonId}/complete`)).status, 403);
    assert.equal((await b.del(`/lessons/${lessonId}/complete`)).status, 403);
    assert.equal((await b.get('/my/courses')).data.courses.length, 0);
    assert.equal((await b.get('/payments')).data.length, 0);
    assert.equal((await a.get('/courses/1/learn')).data.lessons[0].completed, true);
  });
  test('no price tampering: amount comes from the server, not the client', async () => {
    const u = await newUser(base);
    await u.post('/courses/3/purchase', { card: CARD, amount: 0.01, price: 0 });
    const [p] = await paymentsOf(u);
    assert.equal(p.amount, 89);
  });
  test('demo endpoint is absent unless enabled', async () => {
    const plain = await app.listen({ demoTools: false });
    const u = await newUser(plain);
    assert.equal((await u.post('/subscription/demo-expire')).status, 404);
    assert.equal((await u.get('/config')).data.demoTools, false);
    assert.equal((await client(base).get('/config')).data.demoTools, true);
  });
  test('login/register are rate limited', async () => {
    const limited = await app.listen({ authLimit: 4, generalLimit: 1000 });
    const c = client(limited);
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await c.post('/auth/login', { email: 'x@example.com', password: 'Wrong1234' })).status);
    assert.deepEqual(statuses.slice(0, 4), [401, 401, 401, 401]);
    assert.ok(statuses.slice(4).every((s) => s === 429), statuses.join());
  });
  test('general API rate limit', async () => {
    const limited = await app.listen({ generalLimit: 5 });
    const statuses = [];
    for (let i = 0; i < 8; i++) statuses.push((await fetch(limited + '/api/health')).status);
    assert.ok(statuses.includes(429));
  });
});

describe('purchase, learning and progress', () => {
  test('declined and malformed cards do not charge or enroll', async () => {
    const u = await newUser(base);
    assert.equal((await u.post('/courses/1/purchase', { card: DECLINED_CARD })).status, 402);
    assert.equal((await u.post('/courses/1/purchase', { card: { ...CARD, number: '4242 4242 4242 4241' } })).status, 400);
    assert.equal((await u.post('/courses/1/purchase', { card: { ...CARD, expiry: '01/20' } })).status, 400);
    assert.equal((await u.post('/courses/1/purchase', {})).status, 400);
    assert.equal((await paymentsOf(u)).length, 0);
    assert.equal((await u.get('/my/courses')).data.courses.length, 0);
  });
  test('purchase -> learn -> progress -> repurchase blocked', async () => {
    const u = await newUser(base);
    assert.equal((await u.post('/courses/1/purchase', { card: CARD })).status, 200);
    assert.equal((await u.post('/courses/1/purchase', { card: CARD })).status, 409);
    const { lessons } = (await u.get('/courses/1/learn')).data;
    assert.ok(lessons.length > 1 && lessons[0].content);
    let r = await u.post(`/lessons/${lessons[0].id}/complete`);
    assert.deepEqual(r.data, { completed: 1, total: lessons.length });
    r = await u.post(`/lessons/${lessons[0].id}/complete`); // idempotent
    assert.equal(r.data.completed, 1);
    r = await u.post(`/lessons/${lessons[1].id}/complete`);
    assert.equal(r.data.completed, 2);
    const mine = (await u.get('/my/courses')).data;
    assert.equal(mine.courses[0].completed_count, 2);
    assert.equal(mine.courses[0].percent, Math.round((2 / lessons.length) * 100));
    assert.equal(mine.stats.lessonsDone, 2);
    r = await u.del(`/lessons/${lessons[0].id}/complete`);
    assert.equal(r.data.completed, 1);
    assert.equal((await paymentsOf(u)).length, 1);
  });
  test('completing every lesson marks the course completed', async () => {
    const u = await newUser(base);
    await u.post('/courses/4/purchase', { card: CARD });
    for (const l of (await u.get('/courses/4/learn')).data.lessons) await u.post(`/lessons/${l.id}/complete`);
    const m = (await u.get('/my/courses')).data;
    assert.equal(m.courses[0].percent, 100);
    assert.equal(m.stats.completed, 1);
  });
  test('learning requires enrollment', async () => {
    const u = await newUser(base);
    assert.equal((await u.get('/courses/2/learn')).status, 403);
    assert.equal((await u.post('/courses/2/enroll')).status, 403);
  });
  test('concurrent purchases (double click) charge exactly once', async () => {
    const u = await newUser(base);
    const rs = await Promise.all(Array.from({ length: 6 }, () => u.post('/courses/5/purchase', { card: CARD })));
    assert.equal(rs.filter((r) => r.status === 200).length, 1, rs.map((r) => r.status).join());
    assert.equal(rs.filter((r) => r.status === 409).length, 5);
    assert.equal((await paymentsOf(u)).length, 1);
  });
});

describe('subscription lifecycle', () => {
  const sub = async (u) => (await u.get('/subscription')).data.subscription;

  test('subscribe -> access by tier -> double subscribe blocked', async () => {
    const u = await newUser(base);
    assert.equal((await u.post('/subscription/subscribe', { planId: 1, cycle: 'weekly', card: CARD })).status, 400);
    assert.equal((await u.post('/subscription/subscribe', { planId: 999, cycle: 'monthly', card: CARD })).status, 400);
    assert.equal((await u.post('/subscription/subscribe', { planId: 1, cycle: 'monthly', card: DECLINED_CARD })).status, 402);
    assert.equal(await sub(u), null);
    let r = await u.post('/subscription/subscribe', { planId: 1, cycle: 'monthly', card: CARD });
    assert.equal(r.status, 200);
    assert.equal(r.data.subscription.plan_name, 'Basic');
    assert.equal(r.data.subscription.card_last4, '4242');
    assert.equal((await u.post('/subscription/subscribe', { planId: 1, cycle: 'monthly', card: CARD })).status, 409);
    const all = await courses();
    const basicCourse = all.find((c) => c.tier === 1), proCourse = all.find((c) => c.tier === 2);
    assert.equal((await u.post(`/courses/${basicCourse.id}/enroll`)).status, 200);
    assert.equal((await u.post(`/courses/${proCourse.id}/enroll`)).status, 403);
    assert.equal((await u.get(`/courses/${basicCourse.id}/learn`)).status, 200);
  });

  test('concurrent subscribe attempts create one subscription and one charge', async () => {
    const u = await newUser(base);
    const rs = await Promise.all(Array.from({ length: 5 }, () => u.post('/subscription/subscribe', { planId: 2, cycle: 'monthly', card: CARD })));
    assert.equal(rs.filter((r) => r.status === 200).length, 1, rs.map((r) => r.status).join());
    assert.equal((await paymentsOf(u)).length, 1);
  });

  test('upgrade is immediate and prorated; downgrade is scheduled and applied at period end', async () => {
    const u = await newUser(base);
    await u.post('/subscription/subscribe', { planId: 1, cycle: 'monthly', card: CARD });
    let r = await u.post('/subscription/change', { planId: 2, cycle: 'monthly' });
    assert.equal(r.data.type, 'upgrade');
    assert.ok(r.data.charged > 9.9 && r.data.charged <= 10, `charged ${r.data.charged}`);
    assert.equal(r.data.subscription.plan_name, 'Pro');
    const proCourse = (await courses()).find((c) => c.tier === 2);
    assert.equal((await u.post(`/courses/${proCourse.id}/enroll`)).status, 200);

    assert.equal((await u.post('/subscription/change', { planId: 2, cycle: 'monthly' })).status, 400);
    r = await u.post('/subscription/change', { planId: 1, cycle: 'monthly' });
    assert.equal(r.data.type, 'downgrade');
    assert.equal(r.data.subscription.plan_name, 'Pro');
    assert.equal(r.data.subscription.pending_plan_name, 'Basic');
    assert.equal((await u.post('/subscription/cancel-change')).data.subscription.pending_plan_id, null);
    assert.equal((await u.post('/subscription/cancel-change')).status, 409);
    await u.post('/subscription/change', { planId: 1, cycle: 'monthly' });

    r = await u.post('/subscription/demo-expire');
    assert.equal(r.data.subscription.plan_name, 'Basic');
    assert.equal(r.data.subscription.status, 'active');
    assert.equal(r.data.subscription.pending_plan_id, null);
    const mine = (await u.get('/my/courses')).data.courses;
    assert.equal(mine.find((c) => c.id === proCourse.id).locked, true);
    assert.equal((await u.get(`/courses/${proCourse.id}/learn`)).status, 403);
    assert.ok((await paymentsOf(u)).some((p) => p.kind === 'subscription_renewal'));
  });

  test('purchased courses stay unlocked after the subscription is gone', async () => {
    const u = await newUser(base);
    await u.post('/subscription/subscribe', { planId: 3, cycle: 'monthly', card: CARD });
    const prem = (await courses()).find((c) => c.tier === 3);
    await u.post(`/courses/${prem.id}/enroll`);
    await u.post(`/courses/${prem.id}/purchase`, { card: CARD }); // convert to owned
    await u.post('/subscription/cancel');
    await u.post('/subscription/demo-expire');
    assert.equal((await sub(u)).status, 'expired');
    assert.equal((await u.get(`/courses/${prem.id}/learn`)).status, 200);
  });

  test('cancel -> resume -> cancel -> expire -> renew', async () => {
    const u = await newUser(base);
    await u.post('/subscription/subscribe', { planId: 2, cycle: 'yearly', card: CARD });
    let r = await u.post('/subscription/cancel');
    assert.equal(r.data.subscription.cancel_at_period_end, true);
    assert.equal(r.data.subscription.status, 'active'); // still has access until period end
    assert.equal((await u.post('/subscription/cancel')).status, 409);
    assert.equal((await u.post('/subscription/change', { planId: 1, cycle: 'monthly' })).status, 409); // must resume first
    r = await u.post('/subscription/resume');
    assert.equal(r.data.subscription.cancel_at_period_end, false);
    assert.equal((await u.post('/subscription/resume')).status, 409);
    await u.post('/subscription/cancel');
    r = await u.post('/subscription/demo-expire');
    assert.equal(r.data.subscription.status, 'expired');
    assert.equal((await u.post('/subscription/cancel')).status, 409);
    assert.equal((await u.post('/subscription/change', { planId: 1, cycle: 'monthly' })).status, 409);
    const before = (await paymentsOf(u)).length;
    r = await u.post('/subscription/renew');
    assert.equal(r.data.subscription.status, 'active');
    assert.equal((await paymentsOf(u)).length, before + 1);
    const end1 = new Date((await sub(u)).period_end);
    r = await u.post('/subscription/renew'); // early renew extends
    assert.ok(new Date(r.data.subscription.period_end) > end1);
  });

  test('expired users can pick a new plan via subscribe', async () => {
    const u = await newUser(base);
    await u.post('/subscription/subscribe', { planId: 1, cycle: 'monthly', card: CARD });
    await u.post('/subscription/cancel');
    await u.post('/subscription/demo-expire');
    const r = await u.post('/subscription/subscribe', { planId: 3, cycle: 'yearly', card: CARD });
    assert.equal(r.status, 200);
    assert.equal(r.data.subscription.plan_name, 'Premium');
    assert.equal(r.data.subscription.status, 'active');
  });

  test('monthly -> yearly on the same plan is an immediate upgrade', async () => {
    const u = await newUser(base);
    await u.post('/subscription/subscribe', { planId: 2, cycle: 'monthly', card: CARD });
    const r = await u.post('/subscription/change', { planId: 2, cycle: 'yearly' });
    assert.equal(r.data.type, 'upgrade');
    assert.equal(r.data.subscription.cycle, 'yearly');
  });

  test('subscription actions are scoped to the caller', async () => {
    const [a, b] = [await newUser(base), await newUser(base)];
    await a.post('/subscription/subscribe', { planId: 1, cycle: 'monthly', card: CARD });
    assert.equal((await b.post('/subscription/cancel')).status, 404);
    assert.equal((await b.get('/subscription')).data.subscription, null);
    assert.equal((await a.get('/subscription')).data.subscription.cancel_at_period_end, false);
  });

  test('payment history records every charge', async () => {
    const u = await newUser(base);
    await u.post('/courses/1/purchase', { card: CARD });
    await u.post('/subscription/subscribe', { planId: 1, cycle: 'monthly', card: CARD });
    await u.post('/subscription/change', { planId: 2, cycle: 'monthly' });
    const kinds = (await paymentsOf(u)).map((p) => p.kind).sort();
    assert.deepEqual(kinds, ['course_purchase', 'subscription_new', 'subscription_upgrade']);
  });
});
