export const DAY = 86400000;
export const round2 = (n) => Math.round(n * 100) / 100;
export const periodMs = (cycle) => (cycle === 'yearly' ? 365 : 30) * DAY;
export const priceOf = (plan, cycle) => (cycle === 'yearly' ? plan.price_yearly : plan.price_monthly);

/** Moving to a higher tier, or monthly -> yearly on the same tier, is an upgrade (applied immediately). */
export function isUpgrade(oldPlan, oldCycle, newPlan, newCycle) {
  return newPlan.rank > oldPlan.rank || (newPlan.rank === oldPlan.rank && oldCycle === 'monthly' && newCycle === 'yearly');
}

/** Prorated upgrade: credit the unused part of the current period against the new price. */
export function prorate({ oldPrice, newPrice, periodStart, periodEnd, now }) {
  const total = new Date(periodEnd) - new Date(periodStart);
  const remaining = Math.max(0, new Date(periodEnd) - now);
  const credit = round2(oldPrice * (total > 0 ? remaining / total : 0));
  return { credit, amount: Math.max(0, round2(newPrice - credit)) };
}
