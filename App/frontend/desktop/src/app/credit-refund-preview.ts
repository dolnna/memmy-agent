import { creditAnniversary, type CreditDemoState } from "./credits-preview-quota.js";
import type { creditRenewalScenario } from "./credits-preview-mode.js";

export type PreviewRefundOrder = {
  id: string;
  paidAt: string;
  amount: number;
  currency: "CNY" | "USD";
  channel: "alipay" | "paypal";
  mode: "recurring" | "month";
  termStart: string;
  termEnd: string;
};

/** The latest paid order in each isolated preview; a pending order is never refundable. */
export function previewRefundOrder(
  demo: CreditDemoState,
  scenario: ReturnType<typeof creditRenewalScenario>,
  edition: "cn" | "intl"
): PreviewRefundOrder | null {
  if (demo.plan !== "pro" || !scenario) return null;

  const nextMonthPaid = scenario === "prepaid-next" || scenario === "renewal-success";
  const recurring = scenario === "auto-renew";
  const paidAt = nextMonthPaid ? demo.ledgerAnchor : demo.cycleAnchor;
  const termStart = nextMonthPaid ? creditAnniversary(demo.cycleAnchor, 1).toISOString() : demo.cycleAnchor;
  const termEnd = creditAnniversary(demo.cycleAnchor, nextMonthPaid ? 2 : 1).toISOString();
  const paidDate = new Date(paidAt);
  const dateKey = `${paidDate.getFullYear()}${String(paidDate.getMonth() + 1).padStart(2, "0")}${String(paidDate.getDate()).padStart(2, "0")}`;

  return {
    id: `DEMO-MM-${dateKey}-${nextMonthPaid ? "02" : "01"}`,
    paidAt,
    amount: edition === "intl" ? 8.99 : recurring ? 40 : 50,
    currency: edition === "intl" ? "USD" : "CNY",
    channel: edition === "intl" ? "paypal" : "alipay",
    mode: edition === "intl" ? "month" : recurring ? "recurring" : "month",
    termStart,
    termEnd
  };
}
