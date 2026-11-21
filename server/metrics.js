// Business metrics (OpenTelemetry). Instruments are created once at module scope; they are no-ops
// unless telemetry.js started the SDK. Attributes are LOW CARDINALITY only (never ids / emails).
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('upskill');

export const authEvents = meter.createCounter('upskill.auth.events', { description: 'Register/login attempts by outcome' });
export const coursePurchases = meter.createCounter('upskill.course.purchases', { description: 'Course purchase attempts by outcome' });
export const revenue = meter.createCounter('upskill.revenue', { description: 'Amount charged (simulated payments), by kind', unit: 'USD' });
export const paymentAmount = meter.createHistogram('upskill.payment.amount', { description: 'Size of individual charges', unit: 'USD' });
export const subscriptionEvents = meter.createCounter('upskill.subscription.events', { description: 'Subscription lifecycle events' });
export const lessonEvents = meter.createCounter('upskill.lessons.events', { description: 'Lesson completed / undone' });
export const accessDenied = meter.createCounter('upskill.access.denied', { description: 'Requests rejected for access reasons (401/403)' });
export const rateLimited = meter.createCounter('upskill.rate_limited', { description: 'Requests rejected by a rate limiter' });
