import { describe, expect, it } from "vitest";
import {
  createCreditDemo,
  CHECKIN_DAILY,
  CREDIT_LEDGER,
  CREDIT_PURCHASE_VALIDITY_DAYS,
  CREDIT_USED,
  claimCheckin,
  creditPurchaseExpiresAt,
  describeCheckin,
  describeCreditPool,
  ledgerGroupCredits,
  type CreditDemoState
} from "../credits-preview-quota.js";

const base: CreditDemoState = {
  ...createCreditDemo(new Date(2026, 9, 1)),
  plan: "free",
  lastClaimDate: null,
  streak: 0,
  cycles: 0,
  bonus: 0,
  autoRenew: true,
  checkedIn: false
};

describe("check-in streak", () => {
  it("pays exactly 100 daily across seventh and fourteenth days", () => {
    let demo = base;
    for (let day = 1; day <= 15; day += 1) {
      const today = `2026-10-${String(day).padStart(2, "0")}`;
      demo = claimCheckin(demo, today);
      expect(demo.bonus).toBe(day * CHECKIN_DAILY);
      expect(demo.streak).toBe(day);
      expect(demo.buckets.at(-1)?.granted).toBe(100);
      expect(demo.buckets.at(-1)?.remaining).toBe(100);
    }
    expect(demo.cycles).toBe(0);
  });

  it("does not pay twice on the same day", () => {
    const once = claimCheckin(base, "2026-10-01");
    expect(claimCheckin(once, "2026-10-01")).toBe(once);
  });

  it("keeps consecutive days across month boundaries and preserves previously granted rewards", () => {
    const previous=claimCheckin({ ...base, lastClaimDate:"2026-10-30", streak:30, bonus:4000, cycles:2 }, "2026-10-31");
    const next=claimCheckin(previous,"2026-11-01");
    expect(next.streak).toBe(32);
    expect(next.bonus).toBe(4200);
    expect(next.buckets.slice(0,-1)).toEqual(previous.buckets);
    expect(describeCheckin(previous,"2026-11-01").upcomingDay).toBe(32);
  });

  it("restarts at day 1 after a missed day", () => {
    const missed = claimCheckin({ ...base, lastClaimDate: "2026-10-01", streak: 4, bonus: 400 }, "2026-10-04");
    expect(describeCheckin({ ...base, lastClaimDate:"2026-10-01", streak:4 },"2026-10-04").filled).toBe(0);
    expect(missed.streak).toBe(1);
    expect(missed.bonus).toBe(500);
  });
});

describe("preview ledger", () => {
  it("keeps request rows and memory rows, and the calls still add up to the sample spend", () => {
    expect(CREDIT_LEDGER.filter((group) => group.kind === "request")).toHaveLength(3);
    expect(CREDIT_LEDGER.filter((group) => group.kind === "memory")).toHaveLength(1);
    const total = CREDIT_LEDGER.reduce((sum, group) => sum + ledgerGroupCredits(group), 0);
    expect(Math.round(total * 100) / 100).toBe(CREDIT_USED);
    expect(CREDIT_LEDGER.find((group) => group.kind === "memory")?.calls.length).toBeGreaterThan(1);
  });
});

describe("purchased credit expiry", () => {
  it("expires the unused portion exactly 90 days after it was granted", () => {
    const grantedAt = "2026-01-01T12:00:00.000Z";
    const expiresAt = creditPurchaseExpiresAt(grantedAt);
    expect(CREDIT_PURCHASE_VALIDITY_DAYS).toBe(90);
    expect(expiresAt).toBe("2026-04-01T12:00:00.000Z");
    const demo = createCreditDemo(new Date(grantedAt));
    demo.buckets.push({ id: "pack", source: "purchase", granted: 200, remaining: 125, grantedAt, expiresAt });
    expect(describeCreditPool(demo, new Date("2026-04-01T11:59:59.000Z")).purchaseRemaining).toBe(125);
    expect(describeCreditPool(demo, new Date(expiresAt)).purchaseRemaining).toBe(0);
  });
});
