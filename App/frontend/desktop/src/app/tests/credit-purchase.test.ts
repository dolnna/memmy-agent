import { describe, it, expect } from "vitest";
import { SUBSCRIPTION_CNY, previewSubscriptionTerm } from "../credit-purchase.js";
import { createCreditDemo, previewCreditPlan, creditAnniversary } from "../credits-preview-quota.js";

describe("subscription purchase display", () => {
  it("prices continuous monthly at 20% off with identical monthly grant", () => {
    expect(SUBSCRIPTION_CNY.recurring).toBe(SUBSCRIPTION_CNY.month * 0.8);
    expect(SUBSCRIPTION_CNY.recurring).toBe(40);
  });
  it("estimates a calendar month, with renewal a day before expiry", () => {
    const now=new Date(2026,9,16,10);
    const term=previewSubscriptionTerm(createCreditDemo(now),now);
    expect(term.end).toEqual(new Date(2026,10,16,10));
    expect(term.renewal).toEqual(new Date(2026,10,15,10));
  });
  it("extends an existing paid term instead of starting over today", () => {
    const opened=new Date(2026,9,20,12);
    const demo=previewCreditPlan(createCreditDemo(opened),"pro",opened);
    const before=JSON.stringify(demo);
    const term=previewSubscriptionTerm(demo,new Date(2026,10,10,12));
    expect(term.start).toEqual(new Date(2026,10,20,12));
    expect(term.end).toEqual(new Date(2026,11,20,12));
    expect(JSON.stringify(demo)).toBe(before);
  });
  it("keeps a day-31 anniversary after a short-month paid term", () => {
    const opened=new Date(2026,0,31,9);
    const demo=previewCreditPlan(createCreditDemo(opened),"pro",opened);
    expect(demo.paidUntil).toBe(creditAnniversary(opened.toISOString(),1).toISOString());
    expect(previewSubscriptionTerm(demo,new Date(2026,1,10,9)).end).toEqual(new Date(2026,2,31,9));
  });
});
