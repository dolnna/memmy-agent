// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "../../app/providers.js";
import { useAppState } from "../../state/app-state.js";
import { appActions } from "../../state/app-actions.js";
import { createRenewalCreditDemo, describeCreditPool, formatDayKey, readCreditDemo, previewCreditPlan, shiftDayKey, writeCreditDemo } from "../../app/credits-preview-quota.js";
import { CreditsSettingsPanel, CreditsSettingsShell, CreditsSourceDetailPage, HomeCheckinCard } from "../credits-in-app.js";
import { CreditsPlansPage, CreditsPacksPage, CreditsRedeemPage, CreditsCheckoutPage } from "../credits-commerce.js";
import type { AppRoutePath } from "../../app/routes.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let navigate: (path: AppRoutePath) => void;
function Harness() {
  const { state, dispatch } = useAppState();
  navigate = path => dispatch(appActions.navigate(path));
  switch (state.navigation.currentPath) {
    case "/credit-purchase-details": return <CreditsSourceDetailPage source="purchase" />;
    case "/credit-reward-details": return <CreditsSourceDetailPage source="reward" />;
    case "/plans": return <CreditsPlansPage />;
    case "/credit-packs": return <CreditsPacksPage />;
    case "/redeem": return <CreditsRedeemPage />;
    case "/credit-checkout": return <CreditsCheckoutPage />;
    default: return <CreditsSettingsShell><CreditsSettingsPanel /></CreditsSettingsShell>;
  }
}
function button(text: string) {
  const match = [...document.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent?.trim() === text);
  if (!match) throw new Error(`Missing button: ${text}`);
  return match;
}
function click(el: HTMLElement) { act(() => el.click()); }
function go(path: AppRoutePath) { act(() => navigate(path)); }
function headings() { return [...container.querySelectorAll("h1")].map(el => el.textContent); }
beforeEach(() => {
  window.sessionStorage.clear(); window.localStorage.clear();
  vi.stubEnv("MEMMY_APP_EDITION", "cn");
  container = document.createElement("div");document.body.append(container);root = createRoot(container);
  act(() => root.render(<AppProviders><Harness /></AppProviders>));
});
afterEach(() => { act(() => root.unmount());document.body.replaceChildren();vi.unstubAllEnvs(); });

describe("separate credit destinations", () => {
  it("dismisses the home reminder for today without claiming, and shows it on a later day", () => {
    const before = readCreditDemo();
    act(() => root.render(<AppProviders><HomeCheckinCard key="first" dismissible /></AppProviders>));
    click(container.querySelector<HTMLButtonElement>('[aria-label="关闭签到提醒"]')!);
    expect(container.querySelector(".home-checkin")).toBeNull();
    expect(readCreditDemo()).toEqual(before);
    act(() => root.render(<AppProviders><HomeCheckinCard key="revisit" dismissible /></AppProviders>));
    expect(container.querySelector(".home-checkin")).toBeNull();
    window.localStorage.setItem("memmy.home.checkinDismissedOn", shiftDayKey(formatDayKey(new Date()), -1));
    act(() => root.render(<AppProviders><HomeCheckinCard key="next-day" dismissible /></AppProviders>));
    expect(container.querySelector(".home-checkin")).not.toBeNull();
  });

  it("shows the continuous streak after claiming exactly 100, even on day seven", () => {
    const today = formatDayKey(new Date());
    const current = readCreditDemo();
    act(() => writeCreditDemo({ ...current, lastClaimDate: shiftDayKey(today, -1), streak: 6 }));
    act(() => root.render(<AppProviders><HomeCheckinCard /></AppProviders>));
    expect(container.textContent).toContain("+100积分");
    expect(button("签到领取")).toBeTruthy();
    expect(container.textContent).not.toContain("连续签到");
    expect(container.textContent).not.toContain("1,000");
    expect(container.querySelectorAll(".home-checkin__dot")).toHaveLength(0);
    const before=describeCreditPool(readCreditDemo()).totalRemaining;
    click(button("签到领取"));
    expect(container.textContent).toContain("已连续签到 7 天");
    expect(container.textContent).toContain("+100积分已到账");
    expect(container.textContent).not.toContain("额外");
    expect(container.textContent).not.toContain("1,000");
    expect(describeCreditPool(readCreditDemo()).totalRemaining).toBe(before+100);
    expect(container.querySelector(".home-checkin__done")?.textContent).toContain("已连续签到 7 天");
    expect(container.textContent).toContain("今日已签到");
    expect(container.querySelector(".home-checkin__action")).toBeNull();
  });

  it("opens source details from titles and returns to the compact balance summary", () => {
    expect(container.textContent).not.toContain("发放于");
    click(button("购买积分"));expect(headings()).toContain("购买积分明细");
    expect(container.querySelectorAll('article ul > li')).toHaveLength(4);
    click(button("积分余额"));
    expect(container.textContent).not.toContain("发放于");
    click(button("平台奖励积分"));expect(headings()).toContain("平台奖励积分明细");
    expect(container.querySelectorAll('article ul > li')).toHaveLength(4);
    click(button("积分余额"));click(button("兑换码"));
    expect(headings()).not.toContain("兑换码");
    expect(container.querySelector('input[placeholder="请输入兑换码"]')).not.toBeNull();
  });

  it("opens plans and packs, and expands redemption in the balance page", () => {
    expect(container.querySelector('input[placeholder="请输入兑换码"]')).toBeNull();
    expect(container.textContent).not.toContain("免费版每月 1,000 积分；");
    click(button("升级套餐"));expect(headings()).toContain("套餐");
    click(button("积分余额"));click(button("购买更多积分"));expect(headings()).toContain("购买积分");
    click(button("积分余额"));click(button("兑换码"));
    expect(headings()).not.toContain("兑换码");
    expect(container.querySelector('input[placeholder="请输入兑换码"]')).not.toBeNull();
    expect(container.querySelector('form label')?.textContent).toBe("兑换码");
    expect(container.querySelector('form')?.textContent).toContain("兑换后积分将发放至您的个人账户");
    expect(button("兑换码").getAttribute("aria-expanded")).toBe("true");
    const before = readCreditDemo();
    const input = container.querySelector<HTMLInputElement>('input[placeholder="请输入兑换码"]')!;
    act(() => { input.value = "TEST-CODE"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(readCreditDemo()).toEqual(before);
    click(button("兑换码"));
    expect(button("兑换码").getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('input[placeholder="请输入兑换码"]')).toBeNull();
  });

  it("shows monthly validity directly with no cycle or owner tooltips", () => {
    go("/plans");
    expect(container.textContent).toContain("每月 5,000 积分");
    expect(container.textContent).toContain("每个知识库 10 人共享");
    expect(container.textContent).toContain("¥50");
    expect(container.textContent).not.toContain("$7.99");
    expect(container.textContent).not.toContain("套餐积分每周期清零，不结转");
    expect(container.textContent).not.toContain("自己的 API Key 不消耗积分");
    expect(container.querySelector('#credits-pay')).toBeNull();
    expect(container.textContent).toContain("（有效期 1 个月）");
    expect(container.querySelector('[aria-label="积分有效期说明"]')).toBeNull();
    expect(container.querySelector('[aria-label="共享人数说明"]')).toBeNull();
    expect(container.textContent).not.toContain("包含创建者");
  });

  it("confirms a one-time pack purchase before revealing the sample QR, without an agreement or payment mutation", () => {
    const initial = readCreditDemo();
    click(button("购买更多积分"));
    const options = container.querySelectorAll<HTMLButtonElement>('[aria-label="积分包"] button');
    click(options[0]!);
    expect(headings()).toEqual(["购买积分"]);
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container.textContent).toContain("积分总数200");
    expect(container.textContent).toContain("购买积分到账后 90 天有效");
    expect(container.textContent).toContain("¥5");
    expect(container.textContent).not.toContain("有效期至");
    expect(container.querySelector('img[alt="支付二维码示意"]')?.className).not.toBe("");
    click(container.querySelector<HTMLButtonElement>('[aria-label="增加购买份数"]')!);
    click(container.querySelector<HTMLButtonElement>('[aria-label="增加购买份数"]')!);
    expect(container.textContent).toContain("积分总数600");
    expect(container.textContent).toContain("¥15");
    click(button("微信支付"));
    click(button("立即购买"));
    expect(container.querySelector('img[alt="支付二维码示意"]')?.className).toBe("");
    expect(readCreditDemo()).toEqual(initial);
    click(container.querySelector<HTMLButtonElement>('[aria-label="增加购买份数"]')!);
    expect(container.querySelector('img[alt="支付二维码示意"]')?.className).not.toBe("");
    expect(container.textContent).toContain("¥20");
    click(options[2]!);
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container.querySelector('output')?.textContent).toBe("1");
    expect(container.querySelector('img[alt="支付二维码示意"]')?.className).not.toBe("");
    expect(container.querySelector('[aria-label="确认购买"]')?.textContent).toContain("¥125");
    expect(headings()).toEqual(["购买积分"]);
    expect(readCreditDemo()).toEqual(initial);
  });

  it("shows sample purchase history newest first and expands older records without changing balance", () => {
    go("/credit-packs");
    const initial = readCreditDemo();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(container.querySelector('tbody')?.textContent).toContain("已关闭");
    const dates = [...container.querySelectorAll('tbody time')].map(el => el.getAttribute('datetime')!);
    expect(dates).toEqual([...dates].sort().reverse());
    click(button("查看全部 7 条"));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(7);
    click(button("收起"));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(readCreditDemo()).toEqual(initial);
  });

  it("confirms a plan on the same page without issuing credits, including renewal", () => {
    go("/plans");const initial=readCreditDemo();
    expect(headings()).toEqual(["套餐"]);
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    click(button("微信支付"));click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(container.textContent).not.toContain("确认支付 ¥40");
    expect(headings()).toEqual(["套餐"]);
    expect(readCreditDemo()).toEqual(initial);
    go("/settings");act(() => writeCreditDemo(previewCreditPlan(readCreditDemo(), "pro")));
    go("/plans");const pro=readCreditDemo();
    expect(headings()).toEqual(["管理套餐"]);
    expect(container.textContent).not.toContain("续费套餐");
    expect(container.textContent).not.toContain("下次积分发放");
    expect(container.textContent).not.toContain("下次发放 5,000 积分");
    expect(container.textContent).toContain("进阶版·1个月");
    expect(container.textContent).toMatch(/有效期 \d{4}\/\d{2}\/\d{2} – \d{4}\/\d{2}\/\d{2}/);
    expect(container.textContent).toContain("¥50");
    const renewalOptions=container.querySelectorAll<HTMLButtonElement>('[aria-label="订阅方式"] button');
    expect(renewalOptions).toHaveLength(2);
    click(renewalOptions[0]!);
    expect(container.textContent).toContain("进阶版·连续包月");
    click(renewalOptions[1]!);
    expect(container.textContent).toContain("进阶版·1个月");
    expect(container.textContent).toContain("¥50");
    click(button("支付宝"));click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(container.textContent).not.toContain("确认支付 ¥40");
    expect(headings()).toEqual(["管理套餐"]);
    expect(readCreditDemo().paidUntil).toBe(pro.paidUntil);
    expect(describeCreditPool(readCreditDemo()).planRemaining).toBe(5000);
    expect(readCreditDemo().autoRenew).toBe(pro.autoRenew);
  });

  it("shows a close action only for an active recurring subscription", () => {
    go("/settings");
    act(() => writeCreditDemo({ ...previewCreditPlan(readCreditDemo(), "pro"), autoRenew: true }));
    go("/plans");
    expect(container.textContent).toContain("连续包月");
    expect(container.textContent).toContain("下次扣款 ¥40");
    expect(container.querySelector('[aria-label="订阅方式"]')).toBeNull();
    expect(container.textContent).not.toContain("重新开启");
    click(button("关闭自动续费"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("关闭自动续费？");
    click(button("确认关闭"));
    expect(readCreditDemo().autoRenew).toBe(false);
    expect(container.querySelector('[aria-label="订阅方式"]')).not.toBeNull();
    expect(container.textContent).not.toContain("关闭自动续费");
  });

  it("shows the prepaid next month without another checkout", () => {
    go("/settings");
    act(() => writeCreditDemo(createRenewalCreditDemo(new Date(), true)));
    go("/plans");
    expect(container.textContent).toContain("下一期已购买");
    expect(container.textContent).toContain("当前有效期");
    expect(container.textContent).not.toContain("下次积分发放");
    expect(container.querySelector('[aria-label="订阅方式"]')).toBeNull();
    expect(container.querySelector('[aria-label="确认购买"]')).toBeNull();
  });

  it("provides a contact email without a separate refund action", () => {
    window.history.replaceState(null, "", "/?credits-preview=1&credits-scenario=prepaid-next");
    go("/plans");
    const links = container.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:"]');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("mailto:memmy@memtensor.cn");
    expect(container.textContent).not.toContain("申请退款");
    window.history.replaceState(null, "", "/");
  });

  it("retains the current paid term and opens checkout after a failed renewal", () => {
    window.history.replaceState(null, "", "/?credits-preview=1&credits-scenario=renewal-failed");
    const before = readCreditDemo();
    go("/plans");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("续费失败");
    expect(container.textContent).toContain("自动续费已关闭");
    expect(readCreditDemo().autoRenew).toBe(false);
    expect([...container.querySelectorAll("button")].some(el => el.textContent === "关闭自动续费")).toBe(false);
    expect(container.querySelector('[aria-label="订阅方式"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="确认购买"]')).not.toBeNull();
    expect(container.textContent).not.toContain("下一期已购买");
    const options = container.querySelectorAll<HTMLButtonElement>('[aria-label="订阅方式"] button');
    click(options[1]!);
    click(button("同意协议"));
    expect(readCreditDemo().autoRenew).toBe(false);
    expect(readCreditDemo().paidUntil).toBe(before.paidUntil);
    expect(readCreditDemo().buckets).toEqual(before.buckets);
    window.history.replaceState(null, "", "/");
  });

  it.each([
    ["payment-failed", "支付失败，请重试", "重新支付"],
    ["qr-expired", "二维码已过期", "刷新二维码"]
  ])("recovers %s within checkout without changing paid entitlements", (scenario, message, action) => {
    window.history.replaceState(null, "", `/?credits-preview=1&credits-scenario=${scenario}`);
    const before = readCreditDemo();
    go("/plans");
    expect(container.querySelector('[aria-label="确认购买"] [role="status"]')?.textContent).toContain(message);
    expect(container.textContent).not.toContain("自动续费失败");
    click(button(action));
    expect(container.textContent).not.toContain(message);
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect(readCreditDemo()).toEqual(before);
    window.history.replaceState(null, "", "/");
  });

  it("holds the existing payment while confirming without manual refresh or a new purchase", () => {
    window.history.replaceState(null, "", "/?credits-preview=1&credits-scenario=payment-confirming");
    const before = readCreditDemo();
    go("/plans");
    const choices = container.querySelectorAll<HTMLButtonElement>('[aria-label="订阅方式"] button, [aria-label="支付方式"] button');
    expect(choices).toHaveLength(4);
    expect([...choices].every(choice => choice.disabled)).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
    expect(container.textContent).not.toContain("重新支付");
    expect(container.textContent).not.toContain("刷新二维码");
    expect(container.textContent).toContain("正在确认支付结果");
    expect(container.textContent).not.toContain("刷新支付状态");
    expect(readCreditDemo()).toEqual(before);
    window.history.replaceState(null, "", "/");
  });

  it("shows a pending payment without granting the next month", () => {
    window.history.replaceState(null, "", "/?credits-preview=1&credits-scenario=payment-pending");
    go("/plans");
    expect(container.textContent).toContain("支付中");
    expect(container.textContent).toContain("正在确认支付结果");
    expect(container.textContent).toContain("预计有效期");
    expect(container.textContent).not.toContain("下一期已购买");
    expect(container.querySelector('[aria-label="订阅方式"]')).toBeNull();
    expect(container.querySelector('[aria-label="确认购买"]')).toBeNull();
    expect(readCreditDemo().paidUntil).toBe(createRenewalCreditDemo(new Date()).paidUntil);
    window.history.replaceState(null, "", "/");
  });

  it("hides payment when selecting Free and resets confirmation when switching back", () => {
    go("/plans");click(button("微信支付"));click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    click(button("免费版轻松开始体验"));
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    click(button("进阶版适合高频使用"));expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  });

  it("defaults to one month and requires an explicit choice for recurring payments", () => {
    go("/plans");
    expect(button("支付宝").getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("使用支付宝扫码支付");
    expect(container.textContent).toContain("进阶版·1个月，有效期 ");
    expect(container.textContent).not.toContain("到期日前一天自动续费");
    expect(container.querySelector('img[alt="支付二维码示意"]')).not.toBeNull();
    const initial=readCreditDemo();
    const options=container.querySelectorAll<HTMLButtonElement>('[aria-label="订阅方式"] button');
    expect(options[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(options[1]!.getAttribute("aria-pressed")).toBe("true");
    click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    click(options[0]!);
    expect(container.textContent).toContain("到期日前一天自动续费，随时取消");
    expect(container.textContent).toContain("¥40");
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    click(button("微信支付"));expect(container.textContent).toContain("使用微信扫码支付");
    expect(readCreditDemo()).toEqual(initial);
    click(options[1]!);
    expect(container.textContent).toContain("进阶版·1个月，有效期 ");
    expect(container.textContent).not.toContain("到期日前一天自动续费");
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  });

  it("accepts from the QR cover and keeps the agreement link separately readable", () => {
    go("/plans");
    const initial=readCreditDemo();
    expect(container.textContent).not.toContain("阅读协议");
    expect([...container.querySelectorAll("button")].some(el => el.textContent?.includes("确认支付"))).toBe(false);
    click(button("同意协议"));
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    expect(container.textContent).not.toContain("同意协议后扫码支付");
    expect(container.querySelector('img[alt="支付二维码示意"]')?.className).toBe("");
    click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(container.textContent).toContain("同意协议后扫码支付");
    click(button("《Memmy 个人版订阅服务协议（含自动续费服务规则）》"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(readCreditDemo()).toEqual(initial);
  });

  it("international plans offer one month for $8.99 through PayPal and no pack checkout", () => {
    expect(describeCreditPool(readCreditDemo()).purchaseRemaining).toBeGreaterThan(0);
    vi.stubEnv("MEMMY_APP_EDITION", "intl");go("/plans");
    expect(container.textContent).toContain("$8.99");
    expect(container.textContent).not.toContain("¥50");
    expect(container.textContent).not.toContain("连续包月");
    expect(container.textContent).toContain("PayPal 支付");
    expect(button("前往 PayPal 支付").disabled).toBe(true);
    click(button("《Memmy 单月购买条款》"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("$8.99");
    click(button("关闭"));
    click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    click(button("前往 PayPal 支付"));
    expect(container.textContent).toContain("PayPal 支付尚未接入。这次没有创建订单、扣款或开通套餐。");
    go("/credit-packs");
    expect(container.textContent).toContain("$8.99");
    expect(container.textContent).not.toContain("购买份数");
    go("/settings");
    expect(container.textContent).not.toContain("购买更多积分");
    expect(container.textContent).not.toContain("购买积分");
    expect(describeCreditPool(readCreditDemo()).purchaseRemaining).toBe(0);
    expect(describeCreditPool(readCreditDemo()).totalRemaining).toBe(1557);
  });

  it("omits the preview badge and preserves purchase information on demand", () => {
    go("/plans");expect(container.textContent).not.toContain("支付预览：不会实际扣款或发放积分。");
    expect([...container.querySelectorAll("button")].some(el => el.textContent?.trim() === "预览")).toBe(false);
    click(button("《Memmy 个人版订阅服务协议（含自动续费服务规则）》"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("按过期时间从近到远扣除");
  });
});
