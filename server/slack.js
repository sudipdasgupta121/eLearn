// Slack notifications. Two delivery modes (a bot token wins if both are configured):
//   1. Bot token:  UPSKILL_SLACK_BOT_TOKEN (xoxb-..., needs chat:write) + UPSKILL_SLACK_CHANNEL (channel id, e.g. C0123456789; the bot must be in the channel)
//   2. Incoming Webhook:  SLACK_WEBHOOK_URL (https://hooks.slack.com/services/...)
// A silent no-op when neither is configured or SLACK_DISABLED=true (tests, perf and e2e runners set it).
// Design rules:
//   - fire-and-forget: notify() never throws and never makes a request wait on Slack
//   - anonymous by construction: callers pass user ids, plan names, amounts - never names/emails/IPs
//   - noisy alerts are throttled per key
//   - credentials are never logged
import { logger } from './logger.js';

// Only real Slack endpoints are ever contacted, so a bad env value can never turn into an outbound request elsewhere.
const WEBHOOK_RE = /^https:\/\/hooks\.slack\.com\/(services|triggers)\/[A-Za-z0-9/_-]+$/;
const BOT_TOKEN_RE = /^xoxb-[A-Za-z0-9-]+$/;
const CHANNEL_RE = /^(?:[CG][A-Z0-9]{8,}|#?[a-z0-9][a-z0-9._-]{0,79})$/;
const POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';

const ICON = { signup: ':wave:', purchase: ':moneybag:', subscription: ':credit_card:', warn: ':warning:', error: ':rotating_light:', security: ':shield:', deploy: ':rocket:' };

async function post(url, headers, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** target: { kind: 'bot', token, channel } | { kind: 'webhook', url } */
async function httpTransport(target, payload) {
  if (target.kind === 'bot') {
    const res = await post(POST_MESSAGE_URL, { Authorization: `Bearer ${target.token}` }, { channel: target.channel, ...payload });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) logger.warn({ status: res.status, slackError: json.error }, 'slack rejected the message');
    return;
  }
  const res = await post(target.url, {}, payload);
  if (!res.ok) logger.warn({ status: res.status }, 'slack webhook rejected the message');
}

let transport = httpTransport;
/** Test hook: replace the HTTP transport (and bypass the configuration requirement) with a capture function. */
export function setSlackTransport(fn) { transport = fn || httpTransport; }

function target() {
  if (process.env.SLACK_DISABLED === 'true') return null;
  if (transport !== httpTransport) return { kind: 'test' };
  const token = process.env.UPSKILL_SLACK_BOT_TOKEN?.trim();
  const channel = process.env.UPSKILL_SLACK_CHANNEL?.trim();
  if (token && channel) {
    if (BOT_TOKEN_RE.test(token) && CHANNEL_RE.test(channel)) return { kind: 'bot', token, channel };
    logger.warn('UPSKILL_SLACK_BOT_TOKEN / UPSKILL_SLACK_CHANNEL look invalid; Slack bot notifications are disabled');
  }
  const url = process.env.SLACK_WEBHOOK_URL?.trim();
  if (url) {
    if (WEBHOOK_RE.test(url)) return { kind: 'webhook', url };
    logger.warn('SLACK_WEBHOOK_URL is not a hooks.slack.com URL; Slack webhook notifications are disabled');
  }
  return null;
}

export const slackEnabled = () => !!target();

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function formatMessage(kind, title, fields = {}, env = process.env.NODE_ENV || 'development') {
  const icon = ICON[kind] || ':information_source:';
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined && v !== null && v !== '');
  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: `${icon} *${esc(title)}*` } }];
  if (entries.length) blocks.push({ type: 'section', fields: entries.map(([k, v]) => ({ type: 'mrkdwn', text: `*${esc(k)}*\n${esc(v)}` })) });
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `upSkill - ${esc(process.env.SLACK_ENV_LABEL || env)}` }] });
  // the fallback text is rendered as mrkdwn too (notifications, search), so it must be escaped as well
  return { text: `${esc(title)}${entries.length ? ' - ' + entries.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(', ') : ''}`, blocks };
}

const lastSent = new Map();
/**
 * @param {string} kind  signup | purchase | subscription | warn | error | security | deploy
 * @param {string} title short headline
 * @param {Record<string,string|number>} [fields]  key/value details (ids and outcomes only - no PII)
 * @param {{throttleKey?: string, throttleMs?: number}} [opts]  drop repeats of the same key within the window
 * @returns {Promise<boolean>} resolves true if handed to the transport; never rejects
 */
export function notify(kind, title, fields = {}, opts = {}) {
  try {
    const dest = target();
    if (!dest) return Promise.resolve(false);
    if (opts.throttleKey) {
      const now = Date.now();
      if (now - (lastSent.get(opts.throttleKey) ?? 0) < (opts.throttleMs ?? 300_000)) return Promise.resolve(false);
      lastSent.set(opts.throttleKey, now);
      if (lastSent.size > 500) lastSent.clear();
    }
    return Promise.resolve(transport(dest.kind === 'test' ? 'test://transport' : dest, formatMessage(kind, title, fields)))
      .then(() => true)
      .catch((err) => { logger.warn({ err: err?.message }, 'slack notification failed'); return false; });
  } catch (err) {
    logger.warn({ err: err?.message }, 'slack notification failed');
    return Promise.resolve(false);
  }
}

export const resetSlackThrottle = () => lastSent.clear();
