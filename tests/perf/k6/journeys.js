// upSkill user journeys. This is the ONLY k6 file that knows the app. One iteration = one "user":
//   50% browse      (anonymous)  catalog list -> search -> course detail -> plans
//   20% learner     (logged in)  my courses -> open a course player -> subscription status
//   20% progress    (write)      mark a lesson complete (and sometimes undo it)
//   10% purchase    (write)      buy a course: advisory lock, payment insert, enrollment upsert
import http from 'k6/http';
import exec from 'k6/execution';
import { check, fail } from 'k6';

const BASE = __ENV.PERF_BASE_URL;
const POOL = 40; // seeded users perfuser1..40 (see prepare-test-db.js)
const CARD = { number: '4242 4242 4242 4242', expiry: '12/40', cvc: '123' };
const TERMS = ['python', 'data', 'design', 'cloud', 'web', 'security', 'learning', 'sql'];

// Every request is tagged with one of these names (per-endpoint latency is reported + baselined).
export const ENDPOINT_NAMES = [
  'courses_list', 'courses_search', 'course_detail', 'plans',
  'my_courses', 'course_learn', 'subscription',
  'lesson_complete', 'lesson_undo', 'course_purchase',
];

const json = { 'Content-Type': 'application/json', 'X-Requested-With': 'upskill' };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function setup() {
  // Session cookies for the seeded pool users are minted by the runner (see perf.config.js k6Env):
  // login is bcrypt-bound and is not what this suite measures.
  const cookies = __ENV.PERF_SESSIONS.split(',').map((t) => `upskill_session=${t}`);
  if (cookies.length < POOL) fail(`expected ${POOL} sessions, got ${cookies.length}`);
  const lessons = [];
  for (const course of [1, 2, 3]) {
    const r = http.get(`${BASE}/api/courses/${course}/learn`, { headers: { Cookie: cookies[0] }, tags: { name: 'setup_data' } });
    if (r.status !== 200) fail(`setup learn ${course} failed: ${r.status}`);
    for (const l of r.json().lessons) lessons.push(l.id);
  }
  return { cookies, lessons };
}

export function journey(data) {
  const n = exec.scenario.iterationInTest;
  const cookie = data.cookies[n % POOL];
  const auth = { ...json, Cookie: cookie };
  const roll = Math.random();

  if (roll < 0.5) {
    const list = http.get(`${BASE}/api/courses`, { tags: { name: 'courses_list' } });
    check(list, { 'list 200': (r) => r.status === 200 });
    const search = http.get(`${BASE}/api/courses?search=${pick(TERMS)}&sort=rating`, { tags: { name: 'courses_search' } });
    check(search, { 'search 200': (r) => r.status === 200 });
    const detail = http.get(`${BASE}/api/courses/${1 + Math.floor(Math.random() * 13)}`, { tags: { name: 'course_detail' } });
    check(detail, { 'detail 200': (r) => r.status === 200 });
    const plans = http.get(`${BASE}/api/plans`, { tags: { name: 'plans' } });
    check(plans, { 'plans 200': (r) => r.status === 200 });
  } else if (roll < 0.7) {
    const mine = http.get(`${BASE}/api/my/courses`, { headers: auth, tags: { name: 'my_courses' } });
    check(mine, { 'my courses 200': (r) => r.status === 200 });
    const learn = http.get(`${BASE}/api/courses/${1 + Math.floor(Math.random() * 3)}/learn`, { headers: auth, tags: { name: 'course_learn' } });
    check(learn, { 'learn 200': (r) => r.status === 200 });
    const sub = http.get(`${BASE}/api/subscription`, { headers: auth, tags: { name: 'subscription' } });
    check(sub, { 'subscription 200': (r) => r.status === 200 });
  } else if (roll < 0.9) {
    const lesson = pick(data.lessons);
    const done = http.post(`${BASE}/api/lessons/${lesson}/complete`, '{}', { headers: auth, tags: { name: 'lesson_complete' } });
    check(done, { 'complete 200': (r) => r.status === 200 });
    if (Math.random() < 0.3) {
      const undo = http.del(`${BASE}/api/lessons/${lesson}/complete`, null, { headers: auth, tags: { name: 'lesson_undo' } });
      check(undo, { 'undo 200': (r) => r.status === 200 });
    }
  } else {
    // unique (user, course) pair per iteration -> a fresh purchase each time (courses 4..13 are not pre-owned)
    const user = n % POOL;
    const course = 4 + (Math.floor(n / POOL) % 10);
    const res = http.post(`${BASE}/api/courses/${course}/purchase`, JSON.stringify({ card: CARD }),
      { headers: { ...json, Cookie: data.cookies[user] }, tags: { name: 'course_purchase' }, responseCallback: http.expectedStatuses(200, 409) });
    check(res, { 'purchase 200/409': (r) => r.status === 200 || r.status === 409 });
  }
}
