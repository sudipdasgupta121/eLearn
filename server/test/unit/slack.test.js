import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { formatMessage, notify, resetSlackThrottle, setSlackTransport, slackEnabled } from '../../slack.js';

const KEYS = ['SLACK_WEBHOOK_URL', 'SLACK_DISABLED', 'UPSKILL_SLACK_BOT_TOKEN', 'UPSKILL_SLACK_CHANNEL'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const realFetch = globalThis.fetch;
beforeEach(() => { setSlackTransport(null); resetSlackThrottle(); KEYS.forEach((k) => delete process.env[k]); });
afterEach(() => {
  setSlackTransport(null);
  globalThis.fetch = realFetch;
  KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
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

// ---- bot-token mode (chat.postMessage) -------------------------------------------------------
const BOT = 'xoxb' + '-111111111111-222222222222-fakeFAKEfakeFAKEfake';

test('bot mode posts to chat.postMessage with a Bearer token and the channel', async () => {
  process.env.UPSKILL_SLACK_BOT_TOKEN = BOT;
  process.env.UPSKILL_SLACK_CHANNEL = 'C0123456789';
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
  assert.equal(slackEnabled(), true);
  assert.equal(await notify('purchase', 'Course purchased', { Amount: '$49' }), true);
  const [{ url, init }] = calls;
  assert.equal(url, 'https://slack.com/api/chat.postMessage');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${BOT}`);
  const body = JSON.parse(init.body);
  assert.equal(body.channel, 'C0123456789');
  assert.match(body.text, /Course purchased/);
  assert.ok(Array.isArray(body.blocks));
});

test('bot mode needs both token and channel, and rejects malformed values', () => {
  process.env.UPSKILL_SLACK_BOT_TOKEN = BOT;
  assert.equal(slackEnabled(), false); // no channel
  process.env.UPSKILL_SLACK_CHANNEL = 'C0123456789';
  assert.equal(slackEnabled(), true);
  process.env.UPSKILL_SLACK_BOT_TOKEN = 'xoxp' + '-user-token-not-allowed-1234';
  assert.equal(slackEnabled(), false); // only bot tokens are accepted (no user/app tokens)
  process.env.UPSKILL_SLACK_BOT_TOKEN = BOT;
  process.env.UPSKILL_SLACK_CHANNEL = 'not a valid channel!!';
  assert.equal(slackEnabled(), false);
  process.env.UPSKILL_SLACK_CHANNEL = 'upskill-enggteam'; // channel names are accepted too
  assert.equal(slackEnabled(), true);
});

test('bot mode wins over a webhook when both are configured', async () => {
  process.env.UPSKILL_SLACK_BOT_TOKEN = BOT;
  process.env.UPSKILL_SLACK_CHANNEL = 'C0123456789';
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/abc';
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(url); return new Response('{"ok":true}', { status: 200 }); };
  await notify('signup', 'x');
  assert.deepEqual(urls, ['https://slack.com/api/chat.postMessage']);
});

test('a Slack API error (ok:false, e.g. not_in_channel) or network failure never throws', async () => {
  process.env.UPSKILL_SLACK_BOT_TOKEN = BOT;
  process.env.UPSKILL_SLACK_CHANNEL = 'C0123456789';
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: 'not_in_channel' }), { status: 200 });
  assert.equal(await notify('signup', 'x'), true); // handed over; Slack's refusal is only logged
  globalThis.fetch = async () => { throw new Error('network down'); };
  assert.equal(await notify('signup', 'x'), false);
});

test('webhook mode still works', async () => {
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/abc';
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(url); return new Response('ok', { status: 200 }); };
  await notify('signup', 'x');
  assert.deepEqual(urls, ['https://hooks.slack.com/services/T000/B000/abc']);
});
