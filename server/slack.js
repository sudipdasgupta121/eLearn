// Slack notifications via an Incoming Webhook (SLACK_WEBHOOK_URL). A silent no-op when unset or when
// SLACK_DISABLED=true (tests, perf and e2e runners set it). Design rules:
//   - fire-and-forget: notify() never throws and never makes a request wait on Slack
//   - anonymous by construction: callers pass user ids, plan names, amounts - never names/emails/IPs
//   - noisy alerts are throttled per key
import { logger } from './logger.js';

// Only real Slack webhook URLs are accepted, so a bad env value can never turn into an outbound request elsewhere.
const WEBHOOK_RE = /^https:\/\/hooks\.slack\.com\/(services|triggers)\/[A-Za-z0-9/_-]+$/;

const ICON = { signup: ':wave:', purchase: ':moneybag:', subscription: ':credit_card:', warn: ':warning:', error: ':rotating_light:', security: ':shield:', deploy: ':rocket:' };

async function httpTransport(url, payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal });
    if (!res.ok) logger.warn({ status: res.status }, 'slack webhook rejected the message');
  } finally {
    clearTimeout(timer);
  }
}

let transport = httpTransport;
/** Test hook: replace the HTTP transport (and bypass the webhook-URL requirement) with a capture function. */
export function setSlackTransport(fn) { transport = fn || httpTransport; }

const webhookUrl = () => {
  if (process.env.SLACK_DISABLED === 'true') return null;
  if (transport !== httpTransport) return 'test://transport';
  const url = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!url) return null;
  if (!WEBHOOK_RE.test(url)) { logger.warn('SLACK_WEBHOOK_URL is not a hooks.slack.com URL; Slack notifications are disabled'); return null; }
  return url;
};

export const slackEnabled = () => !!webhookUrl();

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
 */
export function notify(kind, title, fields = {}, opts = {}) {
  try {
    const url = webhookUrl();
    if (!url) return Promise.resolve(false);
    if (opts.throttleKey) {
      const now = Date.now();
      if (now - (lastSent.get(opts.throttleKey) ?? 0) < (opts.throttleMs ?? 300_000)) return Promise.resolve(false);
      lastSent.set(opts.throttleKey, now);
      if (lastSent.size > 500) lastSent.clear();
    }
    return Promise.resolve(transport(url, formatMessage(kind, title, fields)))
      .then(() => true)
      .catch((err) => { logger.warn({ err: err?.message }, 'slack notification failed'); return false; });
  } catch (err) {
    logger.warn({ err: err?.message }, 'slack notification failed');
    return Promise.resolve(false);
  }
}

export const resetSlackThrottle = () => lastSent.clear();
