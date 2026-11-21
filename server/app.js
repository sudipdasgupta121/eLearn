import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { one, many, query, tx } from './db.js';
import { HttpError, bad } from './lib/errors.js';
import { isUpgrade, periodMs, priceOf, prorate } from './lib/billing.js';
import { escapeLike, validateCard, validateEmail, validateName, validatePassword } from './lib/validation.js';

const isProd = () => process.env.NODE_ENV === 'production';
const COOKIE = 'upskill_session';
const SESSION_MS = 24 * 60 * 60 * 1000;
// Compared against when the email is unknown so login timing doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-1', 12);

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (isProd() && (!s || s.length < 32)) throw new Error('JWT_SECRET must be set to a random value of at least 32 characters in production');
  return s || 'dev-only-secret-not-for-production';
}

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).then((r) => { if (r !== undefined && !res.headersSent) res.json(r); }).catch(next);

/** Parses a positive int32 id from a URL param; anything else is a 404 (never reaches SQL). */
function parseId(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw new HttpError(404, 'Not found');
  return n;
}
const oneOf = (v, allowed, msg) => { if (!allowed.includes(v)) throw bad(msg); return v; };

// ---------- mock payment gateway (swap for Stripe etc. in a real deployment) ----------
function charge(card) {
  const num = validateCard(card);
  if (num === '4000000000000002') throw new HttpError(402, 'Payment declined by the issuer (test card 4000 0000 0000 0002)');
  return num.slice(-4);
}
const recordPayment = (c, userId, kind, description, amount) =>
  c.query('INSERT INTO payments (user_id,kind,description,amount) VALUES ($1,$2,$3,$4)', [userId, kind, description, amount]);

// Serializes all money/subscription mutations for one user (prevents double-click double-charges).
const lockUser = (c, userId) => c.query('SELECT pg_advisory_xact_lock($1)', [userId]);

// ---------- subscription domain ----------
async function getPlan(c, id) {
  const { rows } = await c.query('SELECT * FROM plans WHERE id=$1', [id]);
  if (!rows[0]) throw bad('Unknown plan');
  return rows[0];
}
const checkCycle = (cycle) => oneOf(cycle, ['monthly', 'yearly'], 'Billing cycle must be monthly or yearly');

/** Locks the user and applies period-end transitions (auto-renew / pending change / expiry). */
async function syncSubscription(c, userId) {
  await lockUser(c, userId);
  const { rows } = await c.query('SELECT * FROM subscriptions WHERE user_id=$1 FOR UPDATE', [userId]);
  const s = rows[0];
  if (!s) return null;
  let changed = false;
  for (let guard = 0; s.status === 'active' && new Date(s.period_end) <= new Date() && guard < 36; guard++) {
    changed = true;
    if (s.cancel_at_period_end) {
      s.status = 'expired';
      s.cancel_at_period_end = false;
      s.pending_plan_id = null; s.pending_cycle = null;
      break;
    }
    if (s.pending_plan_id) {
      s.plan_id = s.pending_plan_id; s.cycle = s.pending_cycle || s.cycle;
      s.pending_plan_id = null; s.pending_cycle = null;
    }
    const plan = await getPlan(c, s.plan_id);
    const start = new Date(s.period_end);
    s.period_start = start;
    s.period_end = new Date(start.getTime() + periodMs(s.cycle));
    await recordPayment(c, userId, 'subscription_renewal', `${plan.name} (${s.cycle}) auto-renewal${s.card_last4 ? ` •••• ${s.card_last4}` : ''}`, priceOf(plan, s.cycle));
  }
  if (changed) {
    await c.query(
      `UPDATE subscriptions SET plan_id=$2,cycle=$3,status=$4,period_start=$5,period_end=$6,cancel_at_period_end=$7,pending_plan_id=$8,pending_cycle=$9 WHERE user_id=$1`,
      [userId, s.plan_id, s.cycle, s.status, s.period_start, s.period_end, s.cancel_at_period_end, s.pending_plan_id, s.pending_cycle]);
  }
  return s;
}

const SUB_SELECT = `SELECT s.*, p.name AS plan_name, p.rank AS plan_rank, p.price_monthly, p.price_yearly, pp.name AS pending_plan_name
  FROM subscriptions s JOIN plans p ON p.id=s.plan_id LEFT JOIN plans pp ON pp.id=s.pending_plan_id WHERE s.user_id=$1`;

async function subscriptionView(userId) {
  let s = await one(SUB_SELECT, [userId]);
  if (s && s.status === 'active' && new Date(s.period_end) <= new Date()) {
    await tx((c) => syncSubscription(c, userId));
    s = await one(SUB_SELECT, [userId]);
  }
  return s || null;
}
const activeRank = (s) => (s && s.status === 'active' ? s.plan_rank : 0);

// ---------- app ----------
/**
 * @param {object} [opts]
 * @param {boolean} [opts.demoTools]    expose the "fast-forward billing period" endpoint (default: ENABLE_DEMO_TOOLS=true)
 * @param {number}  [opts.authLimit]    max login/register attempts per IP per 15 min (default 10)
 * @param {number}  [opts.generalLimit] max API requests per IP per minute (default 300)
 */
export function createApp(opts = {}) {
  const demoTools = opts.demoTools ?? process.env.ENABLE_DEMO_TOOLS === 'true';
  const secret = jwtSecret();
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY || isProd()) app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"],
        frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"],
        'upgrade-insecure-requests': isProd() ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  // Same-origin by default (no CORS headers). Only enable cross-origin access explicitly.
  if (process.env.CORS_ORIGINS) app.use(cors({ origin: process.env.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  const api = express.Router();
  app.use('/api', api);
  api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use(rateLimit({ windowMs: 60_000, limit: opts.generalLimit ?? (Number(process.env.API_RATE_LIMIT_MAX) || 300), standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests, slow down' } }));
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: opts.authLimit ?? (Number(process.env.AUTH_RATE_LIMIT_MAX) || 10), standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in 15 minutes.' } });

  // CSRF defence: state-changing requests must carry a custom header. Browsers cannot attach it
  // cross-site without a CORS preflight, which we do not allow. Combined with SameSite=Lax cookies.
  api.use((req, _res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('x-requested-with') !== 'upskill') {
      return next(new HttpError(403, 'Missing CSRF header'));
    }
    next();
  });

  // ----- auth helpers -----
  const setSession = (res, user) => res.cookie(COOKIE, jwt.sign({ id: user.id }, secret, { expiresIn: '1d', algorithm: 'HS256' }), {
    httpOnly: true, sameSite: 'lax', secure: isProd(), maxAge: SESSION_MS, path: '/',
  });
  const readUserId = (req) => {
    const t = req.cookies?.[COOKIE];
    if (!t) return null;
    try { return jwt.verify(t, secret, { algorithms: ['HS256'] }).id; } catch { return null; }
  };
  const optionalAuth = (req, _res, next) => { req.userId = readUserId(req); next(); };
  const requireAuth = (req, _res, next) => {
    req.userId = readUserId(req);
    next(req.userId ? undefined : new HttpError(401, 'Please log in to continue'));
  };
  const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

  api.get('/health', wrap(async () => { await one('SELECT 1'); return { ok: true }; }));
  api.get('/config', (_req, res) => res.json({ demoTools }));

  // ----- auth -----
  api.post('/auth/register', authLimiter, wrap(async (req, res) => {
    const name = validateName(req.body?.name);
    const email = validateEmail(req.body?.email);
    const password = validatePassword(req.body?.password);
    const hash = await bcrypt.hash(password, 12);
    try {
      const u = await one('INSERT INTO users (name,email,password_hash) VALUES ($1,$2,$3) RETURNING *', [name, email, hash]);
      setSession(res, u);
      return { user: publicUser(u) };
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'An account with this email already exists');
      throw e;
    }
  }));

  api.post('/auth/login', authLimiter, wrap(async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase().slice(0, 254);
    const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
    const u = await one('SELECT * FROM users WHERE email=$1', [email]);
    const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);
    if (!u || !ok) throw new HttpError(401, 'Invalid email or password');
    setSession(res, u);
    return { user: publicUser(u) };
  }));

  api.post('/auth/logout', wrap(async (_req, res) => {
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: isProd(), path: '/' });
    return { ok: true };
  }));

  // Anonymous visitors get { user: null } (not a 401) so the SPA can check the session without console errors.
  api.get('/auth/me', optionalAuth, wrap(async (req) => {
    const u = req.userId ? await one('SELECT * FROM users WHERE id=$1', [req.userId]) : null;
    return { user: u ? publicUser(u) : null };
  }));

  // ----- catalog -----
  const lessonCounts = '(SELECT COUNT(*)::int FROM lessons l WHERE l.course_id=c.id) AS lesson_count';

  api.get('/courses', wrap(async (req) => {
    const str = (v) => (typeof v === 'string' ? v.slice(0, 100) : '');
    const search = str(req.query.search).trim(), category = str(req.query.category), level = str(req.query.level);
    const where = []; const params = [];
    if (search) { params.push(`%${escapeLike(search)}%`); where.push(`(c.title ILIKE $${params.length} OR c.description ILIKE $${params.length} OR c.instructor ILIKE $${params.length})`); }
    if (category) { params.push(category); where.push(`c.category=$${params.length}`); }
    if (level) { params.push(level); where.push(`c.level=$${params.length}`); }
    const order = { price_asc: 'c.price ASC', price_desc: 'c.price DESC', rating: 'c.rating DESC', newest: 'c.id DESC' }[str(req.query.sort)] || 'c.students DESC';
    const courses = await many(`SELECT c.*, ${lessonCounts} FROM courses c ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}, c.id`, params);
    const categories = await many('SELECT category, COUNT(*)::int AS count FROM courses GROUP BY category ORDER BY category');
    return { courses, categories };
  }));

  api.get('/plans', wrap(async () => many('SELECT * FROM plans ORDER BY rank')));

  async function loadCourse(idParam) {
    const course = await one('SELECT * FROM courses WHERE id=$1', [parseId(idParam)]);
    if (!course) throw new HttpError(404, 'Course not found');
    return course;
  }

  /** What the given user may do with a course. */
  async function courseAccess(userId, course) {
    if (!userId) return { enrolled: false, access: false, source: null, includedInPlan: false };
    const e = await one('SELECT source FROM enrollments WHERE user_id=$1 AND course_id=$2', [userId, course.id]);
    const includedInPlan = activeRank(await subscriptionView(userId)) >= course.tier;
    return { enrolled: !!e, access: !!e && (e.source === 'purchase' || includedInPlan), source: e?.source || null, includedInPlan };
  }

  api.get('/courses/:id', optionalAuth, wrap(async (req) => {
    const course = await loadCourse(req.params.id);
    const full = await one(`SELECT c.*, ${lessonCounts} FROM courses c WHERE c.id=$1`, [course.id]);
    const lessons = await many('SELECT id, position, title, minutes FROM lessons WHERE course_id=$1 ORDER BY position', [course.id]);
    const tierPlan = await one('SELECT id, name FROM plans WHERE rank=$1', [course.tier]);
    return { course: full, lessons, tierPlan, ...(await courseAccess(req.userId, course)) };
  }));

  // ----- purchase / enroll -----
  api.post('/courses/:id/purchase', requireAuth, wrap(async (req) => {
    const course = await loadCourse(req.params.id);
    return tx(async (c) => {
      await lockUser(c, req.userId);
      const { rows } = await c.query('SELECT source FROM enrollments WHERE user_id=$1 AND course_id=$2', [req.userId, course.id]);
      if (rows[0]?.source === 'purchase') throw new HttpError(409, 'You already own this course');
      const last4 = charge(req.body?.card);
      await recordPayment(c, req.userId, 'course_purchase', `Course: ${course.title} •••• ${last4}`, course.price);
      await c.query(
        `INSERT INTO enrollments (user_id,course_id,source) VALUES ($1,$2,'purchase')
         ON CONFLICT (user_id,course_id) DO UPDATE SET source='purchase'`, [req.userId, course.id]);
      return { ok: true, courseId: course.id };
    });
  }));

  api.post('/courses/:id/enroll', requireAuth, wrap(async (req) => {
    const course = await loadCourse(req.params.id);
    const sub = await subscriptionView(req.userId);
    if (activeRank(sub) < course.tier) throw new HttpError(403, 'Your plan does not include this course. Upgrade or purchase it.');
    await query(`INSERT INTO enrollments (user_id,course_id,source) VALUES ($1,$2,'subscription') ON CONFLICT DO NOTHING`, [req.userId, course.id]);
    return { ok: true, courseId: course.id };
  }));

  // ----- learning -----
  api.get('/my/courses', requireAuth, wrap(async (req) => {
    const sub = await subscriptionView(req.userId);
    const rows = await many(
      `SELECT c.*, e.source, e.created_at AS enrolled_at,
              (SELECT COUNT(*)::int FROM lessons l WHERE l.course_id=c.id) AS lesson_count,
              (SELECT COUNT(*)::int FROM progress p JOIN lessons l ON l.id=p.lesson_id WHERE p.user_id=$1 AND l.course_id=c.id) AS completed_count
       FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.user_id=$1 ORDER BY e.created_at DESC`, [req.userId]);
    const courses = rows.map((c) => ({
      ...c,
      locked: c.source !== 'purchase' && activeRank(sub) < c.tier,
      percent: c.lesson_count ? Math.round((c.completed_count / c.lesson_count) * 100) : 0,
    }));
    return {
      courses,
      stats: {
        enrolled: courses.length,
        completed: courses.filter((c) => c.lesson_count && c.completed_count === c.lesson_count).length,
        lessonsDone: courses.reduce((a, c) => a + c.completed_count, 0),
      },
    };
  }));

  api.get('/courses/:id/learn', requireAuth, wrap(async (req) => {
    const course = await loadCourse(req.params.id);
    const a = await courseAccess(req.userId, course);
    if (!a.access) throw new HttpError(403, a.enrolled ? 'Your subscription no longer covers this course. Renew or purchase it.' : 'Enroll in this course to start learning');
    const lessons = await many(
      `SELECT l.id, l.position, l.title, l.minutes, l.content, (p.user_id IS NOT NULL) AS completed
       FROM lessons l LEFT JOIN progress p ON p.lesson_id=l.id AND p.user_id=$2 WHERE l.course_id=$1 ORDER BY l.position`, [course.id, req.userId]);
    return { course, lessons };
  }));

  const setLesson = (done) => wrap(async (req) => {
    const lesson = await one('SELECT id, course_id FROM lessons WHERE id=$1', [parseId(req.params.id)]);
    if (!lesson) throw new HttpError(404, 'Lesson not found');
    const course = await one('SELECT * FROM courses WHERE id=$1', [lesson.course_id]);
    if (!(await courseAccess(req.userId, course)).access) throw new HttpError(403, 'No access to this course');
    if (done) await query('INSERT INTO progress (user_id,lesson_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.userId, lesson.id]);
    else await query('DELETE FROM progress WHERE user_id=$1 AND lesson_id=$2', [req.userId, lesson.id]);
    return one(`SELECT COUNT(*)::int AS completed, (SELECT COUNT(*)::int FROM lessons WHERE course_id=$2) AS total
                FROM progress p JOIN lessons l ON l.id=p.lesson_id WHERE p.user_id=$1 AND l.course_id=$2`, [req.userId, lesson.course_id]);
  });
  api.post('/lessons/:id/complete', requireAuth, setLesson(true));
  api.delete('/lessons/:id/complete', requireAuth, setLesson(false));

  // ----- subscriptions -----
  api.get('/subscription', requireAuth, wrap(async (req) => ({ subscription: await subscriptionView(req.userId) })));

  api.post('/subscription/subscribe', requireAuth, wrap(async (req) => {
    const cycle = checkCycle(req.body?.cycle);
    await tx(async (c) => {
      const cur = await syncSubscription(c, req.userId);
      if (cur?.status === 'active') throw new HttpError(409, 'You already have an active subscription. Use upgrade/downgrade instead.');
      const plan = await getPlan(c, Number.isInteger(req.body?.planId) ? req.body.planId : 0);
      const last4 = charge(req.body?.card);
      const now = new Date();
      await c.query(
        `INSERT INTO subscriptions (user_id,plan_id,cycle,status,period_start,period_end,cancel_at_period_end,pending_plan_id,pending_cycle,card_last4)
         VALUES ($1,$2,$3,'active',$4,$5,false,NULL,NULL,$6)
         ON CONFLICT (user_id) DO UPDATE SET plan_id=$2,cycle=$3,status='active',period_start=$4,period_end=$5,
           cancel_at_period_end=false,pending_plan_id=NULL,pending_cycle=NULL,card_last4=$6`,
        [req.userId, plan.id, cycle, now, new Date(now.getTime() + periodMs(cycle)), last4]);
      await recordPayment(c, req.userId, 'subscription_new', `${plan.name} plan (${cycle}) •••• ${last4}`, priceOf(plan, cycle));
    });
    return { subscription: await subscriptionView(req.userId) };
  }));

  api.post('/subscription/change', requireAuth, wrap(async (req) => {
    const cycle = checkCycle(req.body?.cycle);
    const result = await tx(async (c) => {
      const s = await syncSubscription(c, req.userId);
      if (!s || s.status !== 'active') throw new HttpError(409, 'No active subscription. Subscribe or renew first.');
      const oldPlan = await getPlan(c, s.plan_id);
      const newPlan = await getPlan(c, Number.isInteger(req.body?.planId) ? req.body.planId : 0);
      if (newPlan.id === oldPlan.id && cycle === s.cycle) throw bad('You are already on this plan');
      if (isUpgrade(oldPlan, s.cycle, newPlan, cycle)) {
        const now = new Date();
        const { credit, amount } = prorate({ oldPrice: priceOf(oldPlan, s.cycle), newPrice: priceOf(newPlan, cycle), periodStart: s.period_start, periodEnd: s.period_end, now });
        await recordPayment(c, req.userId, 'subscription_upgrade',
          `Upgrade ${oldPlan.name} → ${newPlan.name} (${cycle}), prorated credit $${credit.toFixed(2)}${s.card_last4 ? ` •••• ${s.card_last4}` : ''}`, amount);
        await c.query(
          `UPDATE subscriptions SET plan_id=$2,cycle=$3,period_start=$4,period_end=$5,cancel_at_period_end=false,pending_plan_id=NULL,pending_cycle=NULL WHERE user_id=$1`,
          [req.userId, newPlan.id, cycle, now, new Date(now.getTime() + periodMs(cycle))]);
        return { type: 'upgrade', charged: amount, credit };
      }
      if (s.cancel_at_period_end) throw new HttpError(409, 'Your subscription is set to cancel. Resume it before scheduling a downgrade.');
      await c.query('UPDATE subscriptions SET pending_plan_id=$2,pending_cycle=$3 WHERE user_id=$1', [req.userId, newPlan.id, cycle]);
      return { type: 'downgrade', effectiveAt: s.period_end };
    });
    return { ...result, subscription: await subscriptionView(req.userId) };
  }));

  const simple = (path, fn) => api.post(`/subscription/${path}`, requireAuth, wrap(async (req) => {
    await tx(async (c) => {
      const s = await syncSubscription(c, req.userId);
      if (!s) throw new HttpError(404, 'No subscription found');
      await fn(c, s, req);
    });
    return { subscription: await subscriptionView(req.userId) };
  }));

  simple('cancel', async (c, s, req) => {
    if (s.status !== 'active') throw new HttpError(409, 'Subscription is not active');
    if (s.cancel_at_period_end) throw new HttpError(409, 'Already set to cancel');
    await c.query('UPDATE subscriptions SET cancel_at_period_end=true,pending_plan_id=NULL,pending_cycle=NULL WHERE user_id=$1', [req.userId]);
  });
  simple('resume', async (c, s, req) => {
    if (s.status !== 'active' || !s.cancel_at_period_end) throw new HttpError(409, 'Nothing to resume');
    await c.query('UPDATE subscriptions SET cancel_at_period_end=false WHERE user_id=$1', [req.userId]);
  });
  simple('cancel-change', async (c, s, req) => {
    if (!s.pending_plan_id) throw new HttpError(409, 'No scheduled plan change');
    await c.query('UPDATE subscriptions SET pending_plan_id=NULL,pending_cycle=NULL WHERE user_id=$1', [req.userId]);
  });
  simple('renew', async (c, s, req) => {
    const plan = await getPlan(c, s.plan_id);
    // Use the saved card (last4 only is stored); a new card may be supplied.
    const last4 = req.body?.card ? charge(req.body.card) : s.card_last4;
    if (!last4) throw bad('Card details are required');
    const now = new Date();
    if (s.status === 'expired') {
      await c.query(`UPDATE subscriptions SET status='active',period_start=$2,period_end=$3,card_last4=$4,cancel_at_period_end=false WHERE user_id=$1`,
        [req.userId, now, new Date(now.getTime() + periodMs(s.cycle)), last4]);
    } else {
      await c.query(`UPDATE subscriptions SET period_end=$2,cancel_at_period_end=false,card_last4=$3 WHERE user_id=$1`,
        [req.userId, new Date(new Date(s.period_end).getTime() + periodMs(s.cycle)), last4]);
    }
    await recordPayment(c, req.userId, 'subscription_renewal', `${plan.name} (${s.cycle}) renewal •••• ${last4}`, priceOf(plan, s.cycle));
  });

  // Demo helper only: jump to the end of the billing period. Not registered unless explicitly enabled.
  if (demoTools) {
    simple('demo-expire', async (c, s, req) => {
      if (s.status !== 'active') throw new HttpError(409, 'Subscription is not active');
      await c.query('UPDATE subscriptions SET period_end=now() WHERE user_id=$1', [req.userId]);
    });
  }

  api.get('/payments', requireAuth, wrap(async (req) =>
    many('SELECT * FROM payments WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 200', [req.userId])));

  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    let status = err.status, message = err.message;
    if (err.type === 'entity.parse.failed') { status = 400; message = 'Malformed JSON'; }
    else if (err.type === 'entity.too.large') { status = 413; message = 'Request too large'; }
    else if (!status) { console.error('Unhandled error:', err.stack || err); status = 500; message = 'Internal server error'; }
    res.status(status).json({ error: message });
  });
  return app;
}
