// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createRenewalCreditDemo, creditCycleWindow, describeCreditPool, readCreditDemo, writeCreditDemo } from "../credits-preview-quota.js";
import { creditRenewalScenario } from "../credits-preview-mode.js";
import { previewRefundOrder } from "../credit-refund-preview.js";
const now=new Date(2026,9,16,12);
afterEach(()=>{window.history.replaceState(null,"","/");window.sessionStorage.clear();});
describe("manual renewal examples",()=>{
  it("extends the paid term while retaining balances, anniversary and auto-renew setting",()=>{
    const before=createRenewalCreditDemo(now), after=createRenewalCreditDemo(now,true);
    expect(before.paidUntil).toBe(new Date(2026,10,1).toISOString());
    expect(after.paidUntil).toBe(new Date(2026,11,1).toISOString());
    expect(after.buckets).toEqual(before.buckets);
    expect(creditCycleWindow(after,now)).toEqual(creditCycleWindow(before,now));
    expect(after.autoRenew).toBe(false);
    expect(describeCreditPool(after,now).totalRemaining).toBe(3400);
  });
  it("isolates example accounts from the existing preview and never reseeds on refresh",()=>{
    const original=readCreditDemo(now);
    window.history.replaceState(null,"","/?credits-preview=1&credits-scenario=renewal");
    const renewal=readCreditDemo(now);
    expect(renewal.plan).toBe('pro');
    writeCreditDemo({...renewal,autoRenew:true});
    expect(readCreditDemo(now).autoRenew).toBe(true);
    window.history.replaceState(null,"","/?credits-preview=1&credits-scenario=auto-renew");
    expect(readCreditDemo(now).autoRenew).toBe(true);
    window.history.replaceState(null,"","/?credits-preview=1&credits-scenario=payment-pending");
    expect(readCreditDemo(now).paidUntil).toBe(new Date(2026,10,1).toISOString());
    window.history.replaceState(null,"","/?credits-preview=1&credits-scenario=prepaid-next");
    expect(readCreditDemo(now).paidUntil).toBe(new Date(2026,11,1).toISOString());
    expect(readCreditDemo(now).autoRenew).toBe(false);
    window.history.replaceState(null,"","/?credits-preview=1&credits-scenario=renewal-success");
    expect(readCreditDemo(now).paidUntil).toBe(new Date(2026,11,1).toISOString());
    window.history.replaceState(null,"","/");
    expect(readCreditDemo(now)).toEqual(original);
  });
  it("enables scenarios only through the explicit credits preview flag",()=>{
    expect(creditRenewalScenario('?credits-scenario=renewal')).toBeNull();
    expect(creditRenewalScenario('?credits-preview=1&credits-scenario=renewal')).toBe('renewal');
    expect(creditRenewalScenario('?credits-preview=1&credits-scenario=auto-renew')).toBe('auto-renew');
    expect(creditRenewalScenario('?credits-preview=1&credits-scenario=payment-pending')).toBe('payment-pending');
    expect(creditRenewalScenario('?credits-preview=1&credits-scenario=prepaid-next')).toBe('prepaid-next');
  });
  it("uses the latest paid sample order and excludes a pending renewal",()=>{
    const current=createRenewalCreditDemo(now);
    const prepaid=createRenewalCreditDemo(now,true);
    expect(previewRefundOrder(current,'renewal','cn')).toMatchObject({id:'DEMO-MM-20261001-01',amount:50,mode:'month',channel:'alipay'});
    expect(previewRefundOrder(current,'auto-renew','cn')).toMatchObject({id:'DEMO-MM-20261001-01',amount:40,mode:'recurring'});
    expect(previewRefundOrder(current,'payment-pending','cn')).toMatchObject({id:'DEMO-MM-20261001-01',amount:50,mode:'month'});
    expect(previewRefundOrder(prepaid,'prepaid-next','cn')).toMatchObject({id:'DEMO-MM-20261016-02',amount:50,mode:'month',termStart:new Date(2026,10,1).toISOString()});
    expect(previewRefundOrder(prepaid,'renewal-success','cn')?.id).toBe('DEMO-MM-20261016-02');
  });
});
