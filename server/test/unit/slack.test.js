import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { formatMessage, notify, resetSlackThrottle, setSlackTransport, slackEnabled } from '../../slack.js';

const saved = { url: process.env.SLACK_WEBHOOK_URL, disabled: process.env.SLACK_DISABLED };
beforeEach(() => { setSlackTransport(null); resetSlackThrottle(); delete process.env.SLACK_WEBHOOK_URL; delete process.env.SLACK_DISABLED; });
afterEach(() => {
  setSlackTransport(null);
  if (saved.url === undefined) delete process.env.SLACK_WEBHOOK_URL; else process.env.SLACK_WEBHOOK_URL = saved.url;
  if (saved.disabled === undefined) delete process.env.SLACK_DISABLED; else process.env.SLACK_DISABLED = saved.disabled;
});

test('is a silent no-op when no webhook is configured', async () => {
  assert.equal(slackEnabled(), false);
  assert.equal(await notify('signup', 'hello'), false);
});

test('rejects webhook URLs that are not hooks.slack.com (no arbitrary outbound requests)', async () => {
  for (const url of ['http://hooks.slack.com/services/T/B/x', 'https://evil.example.com/services/T/B/x', 'https://hooks.slack.com.evil.com/services/T/B/x', 'file:///etc/passwd', 'garbage']) {
    process.env.SLACK_WEBHOOK_URL = url;
    assert.equal(slackEnabled(), false, url);
  }
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/abcDEF123';
  assert.equal(slackEnabled(), true);
});

test('SLACK_DISABLED=true wins over a configured webhook', () => {
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/abcDEF123';
  process.env.SLACK_DISABLED = 'true';
  assert.equal(slackEnabled(), false);
});

test('sends a Slack payload with a headline, fields and an environment footer', async () => {
  const sent = [];
  setSlackTransport(async (url, payload) => sent.push(payload));
  assert.equal(await notify('purchase', 'Course purchased', { Course: 'Python for Everybody', Amount: '$49', User: '#7' }), true);
  const [p] = sent;
  assert.match(p.text, /Course purchased/);
  assert.match(p.text, /Amount: \$49/);
  assert.equal(p.blocks[0].type, 'section');
  assert.equal(p.blocks[1].fields.length, 3);
  assert.equal(p.blocks.at(-1).type, 'context');
});

test('escapes Slack control characters in dynamic text', () => {
  const p = formatMessage('warn', 'x', { Course: '<!channel> & <script>' });
  const text = JSON.stringify(p);
  assert.ok(!text.includes('<!channel>'));
  assert.ok(text.includes('&lt;!channel&gt; &amp; &lt;script&gt;'));
});

test('skips empty fields', () => {
  const p = formatMessage('deploy', 'live', { A: '1', B: '', C: undefined, D: null });
  assert.equal(p.blocks[1].fields.length, 1);
});

test('throttles repeated alerts by key but not other keys', async () => {
  const sent = [];
  setSlackTransport(async (_u, payload) => sent.push(payload));
  assert.equal(await notify('error', 'a', {}, { throttleKey: 'k', throttleMs: 60_000 }), true);
  assert.equal(await notify('error', 'a', {}, { throttleKey: 'k', throttleMs: 60_000 }), false);
  assert.equal(await notify('error', 'a', {}, { throttleKey: 'other', throttleMs: 60_000 }), true);
  assert.equal(await notify('error', 'a'), true); // no key = never throttled
  assert.equal(sent.length, 3);
});

test('a failing or throwing Slack transport never throws to the caller', async () => {
  setSlackTransport(async () => { throw new Error('slack is down'); });
  assert.equal(await notify('signup', 'x'), false);
  setSlackTransport(() => { throw new Error('sync boom'); });
  assert.equal(await notify('signup', 'x'), false);
});

test('notify returns without waiting on a slow Slack (fire-and-forget callers do not await it)', async () => {
  let release;
  setSlackTransport(() => new Promise((r) => { release = r; }));
  const started = Date.now();
  const p = notify('signup', 'slow'); // not awaited by app code
  assert.ok(Date.now() - started < 50);
  release();
  assert.equal(await p, true);
});
