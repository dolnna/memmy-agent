import { creditAnniversary, creditCycleWindow, type CreditDemoState } from "./credits-preview-quota.js";

export type SubscriptionMode = "recurring" | "month";
export const SUBSCRIPTION_CNY = { recurring: 40, month: 50 } as const;
export const SUBSCRIPTION_USD_MONTH = 8.99;

/** Display-only order estimate. A live order must supply its confirmed dates. */
export function previewSubscriptionTerm(demo: CreditDemoState, now: Date) {
  const paidUntil = demo.plan === "pro" && demo.paidUntil ? new Date(demo.paidUntil) : null;
  const start = paidUntil && paidUntil.getTime() > now.getTime() ? paidUntil : now;
  const paidCycle = creditCycleWindow(demo, start);
  const retainsAnchor = start === paidUntil && paidCycle.start.getTime() === start.getTime();
  const end = retainsAnchor ? creditAnniversary(demo.cycleAnchor, paidCycle.index + 1) : creditAnniversary(start.toISOString(), 1);
  const renewal = new Date(end);
  renewal.setDate(renewal.getDate() - 1);
  return { start, end, renewal };
}
