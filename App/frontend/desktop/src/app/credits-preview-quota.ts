/** Shared preview balance so the sidebar menu and the credits pages show the same numbers. */
import { creditErrorScenario, creditRenewalScenario } from "./credits-preview-mode.js";

export type CreditPlan = "free" | "pro";

export type CreditSource = "plan" | "reward" | "purchase";
export type CreditBucket = {
  id: string;
  source: CreditSource;
  granted: number;
  remaining: number;
  grantedAt: string;
  /** null means no expiry in this preview scenario. */
  expiresAt: string | null;
};

export type CreditDemoState = {
  version: 2;
  balanceSampleVersion?: 1 | 2 | 3 | 4;
  plan: CreditPlan;
  cycleAnchor: string;
  cycleIndex: number;
  paidUntil: string | null;
  ledgerAnchor: string;
  buckets: CreditBucket[];
  lastClaimDate: string | null;
  streak: number;
  cycles: number;
  bonus: number;
  autoRenew: boolean;
  checkedIn: boolean;
};

const DEMO_KEY = "memmy.creditsPreview.demo";
function demoStorageKey() { const scenario=creditRenewalScenario(); const error=creditErrorScenario(); const params=typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null; const plan=params?.get("credits-plan") === "pro" ? "pro" : "free"; const recovered=error === "agent" && params?.get("credits-recovered") === "1" ? "-recovered" : ""; return error ? `${DEMO_KEY}:error-${error}-${plan}${recovered}` : scenario ? `${DEMO_KEY}:${scenario}` : DEMO_KEY; }
export const CREDIT_DEMO_EVENT = "memmy:credits-preview-changed";
export const CREDIT_GRANTS: Record<CreditPlan, number> = { free: 1000, pro: 5000 };
export const CREDIT_PACKS = [
  { credits: 200, cny: 5, usd: 0.99 },
  { credits: 1000, cny: 25, usd: 4.99 },
  { credits: 5000, cny: 125, usd: 24.99 }
] as const;
/** Shared display-only orders and balances for the populated preview scenario. */
export const CREDIT_PACK_ORDERS = [
  { id: "sample-pack-5", daysAgo: 1, pack: 1000, channel: "alipay", status: "completed", remaining: 1000 },
  { id: "sample-pack-4", daysAgo: 4, pack: 200, channel: "wechat", status: "completed", remaining: 125.5 },
  { id: "sample-pack-3", daysAgo: 8, pack: 5000, channel: "alipay", status: "closed", remaining: 0 },
  { id: "sample-pack-2", daysAgo: 12, pack: 1000, channel: "wechat", status: "completed", remaining: 0 },
  { id: "sample-pack-1", daysAgo: 19, pack: 200, channel: "alipay", status: "closed", remaining: 0 },
  { id: "sample-pack-0", daysAgo: 23, pack: 5000, channel: "alipay", status: "completed", remaining: 5000 },
  { id: "sample-pack-expired", daysAgo: 135, pack: 200, channel: "wechat", status: "completed", remaining: 80 }
] as const;
export const CREDIT_PURCHASE_VALIDITY_DAYS = 90;
export function creditPurchaseExpiresAt(grantedAt: string): string {
  return new Date(Date.parse(grantedAt) + CREDIT_PURCHASE_VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
export const CHECKIN_DAILY = 100;
export const CHECKIN_REWARD = CHECKIN_DAILY;
export const INVITE_TOKENS_PER_CREDIT = 1_000_000;
/** Sample calls are applied once when the example account is created. */
export const CREDIT_USED = 175.25;

const cents = (value: number) => Math.round(value * 100);
const amount = (value: number) => value / 100;

/** Preserve the original anniversary day through short months. */
export function creditAnniversary(anchor: string, months: number): Date {
  const start = new Date(anchor);
  const result = new Date(start);
  result.setDate(1);
  result.setMonth(start.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(start.getDate(), lastDay));
  return result;
}

export function creditCycleWindow(demo: CreditDemoState, now = new Date()) {
  const anchor = new Date(demo.cycleAnchor);
  let index = Math.max(0, (now.getFullYear() - anchor.getFullYear()) * 12 + now.getMonth() - anchor.getMonth());
  if (index > 0 && creditAnniversary(demo.cycleAnchor, index).getTime() > now.getTime()) index -= 1;
  return { index, start: creditAnniversary(demo.cycleAnchor, index), end: creditAnniversary(demo.cycleAnchor, index + 1) };
}

function planBucket(plan: CreditPlan, anchor: string, index: number): CreditBucket {
  return {
    id: `plan:${anchor}:${index}`,
    source: "plan",
    granted: CREDIT_GRANTS[plan],
    remaining: CREDIT_GRANTS[plan],
    grantedAt: creditAnniversary(anchor, index).toISOString(),
    expiresAt: creditAnniversary(anchor, index + 1).toISOString()
  };
}

export function createCreditDemo(now = new Date()): CreditDemoState {
  const anchor = now.toISOString();
  return {
    version: 2, balanceSampleVersion: 4, plan: "free", cycleAnchor: anchor, cycleIndex: 0, paidUntil: null,
    ledgerAnchor: anchor, buckets: [planBucket("free", anchor, 0)],
    lastClaimDate: null, streak: 0, cycles: 0, bonus: 0, autoRenew: false, checkedIn: false
  };
}

/** Explicit, isolated UI examples. No checkout action calls this function. */
export function createRenewalCreditDemo(now: Date, renewed = false): CreditDemoState {
  const opened = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const demo = previewCreditPlan(createCreditDemo(opened), "pro", opened);
  return { ...demo, ledgerAnchor: now.toISOString(),
    paidUntil: creditAnniversary(opened.toISOString(), renewed ? 2 : 1).toISOString(),
    buckets: [
      { ...demo.buckets[0]!, remaining: 3200 },
      { id:"renewal-example-reward", source:"reward", granted:200, remaining:200, grantedAt:opened.toISOString(), expiresAt:creditAnniversary(opened.toISOString(),1).toISOString() }
    ]
  };
}

function activeBucket(bucket: CreditBucket, now: Date) {
  return new Date(bucket.grantedAt).getTime() <= now.getTime()
    && (bucket.expiresAt === null || new Date(bucket.expiresAt).getTime() > now.getTime());
}

/** FEFO across all sources. Ties use stable arrival order for preview only. */
export function consumeCreditBuckets(buckets: CreditBucket[], credits: number, now = new Date()) {
  if (!Number.isFinite(credits) || credits < 0) throw new Error("Invalid credit consumption");
  let needed = cents(credits);
  const next = buckets.map(bucket => ({ ...bucket }));
  const ordered = next.filter(bucket => activeBucket(bucket, now) && bucket.remaining > 0)
    .sort((a, b) => {
      const expiry = (a.expiresAt === null ? Infinity : Date.parse(a.expiresAt))
        - (b.expiresAt === null ? Infinity : Date.parse(b.expiresAt));
      return (Number.isNaN(expiry) ? 0 : expiry) || Date.parse(a.grantedAt) - Date.parse(b.grantedAt);
    });
  for (const bucket of ordered) {
    const used = Math.min(needed, cents(bucket.remaining));
    bucket.remaining = amount(cents(bucket.remaining) - used);
    needed -= used;
    if (needed === 0) break;
  }
  return { buckets: next, charged: amount(cents(credits) - needed), uncovered: amount(needed) };
}

/** At a new cycle, discard the old plan bucket; rewards/purchases keep their own expiry. */
export function advanceCreditCycle(demo: CreditDemoState, now = new Date()): CreditDemoState {
  let next = demo;
  if (next.plan === "pro" && next.paidUntil && Date.parse(next.paidUntil) <= now.getTime()) {
    // Preview never invents an automatic payment. Only paid periods retain Pro rights.
    next = { ...next, plan: "free", cycleAnchor: next.paidUntil, cycleIndex: -1, paidUntil: null, autoRenew: false };
  }
  const cycle = creditCycleWindow(next, now);
  if (cycle.index !== next.cycleIndex) {
    next = { ...next, cycleIndex: cycle.index, buckets: [
      ...next.buckets.filter(bucket => bucket.source !== "plan"),
      planBucket(next.plan, next.cycleAnchor, cycle.index)
    ] };
  }
  return next;
}

/** Explicit scenario control, never used by the payment confirmation button. */
export function previewCreditPlan(demo: CreditDemoState, plan: CreditPlan, now = new Date()): CreditDemoState {
  const next = advanceCreditCycle(demo, now);
  const anchor = now.toISOString();
  return {
    ...next, plan, cycleAnchor: anchor, cycleIndex: 0, autoRenew: false,
    paidUntil: plan === "pro" ? creditAnniversary(anchor, 1).toISOString() : null,
    buckets: [...next.buckets.filter(bucket => bucket.source !== "plan"), planBucket(plan, anchor, 0)]
  };
}

export function grantPreviewCredits(demo: CreditDemoState, bucket: CreditBucket): CreditDemoState {
  if (demo.buckets.some(existing => existing.id === bucket.id)) return demo;
  return { ...demo, buckets: [...demo.buckets, bucket] };
}

/** Seed once, preserving existing plan usage and any user-driven preview changes. */
export function populateCreditDemo(demo: CreditDemoState): CreditDemoState {
  const date = (days: number) => {
    const value = new Date(demo.ledgerAnchor);
    value.setDate(value.getDate() + days);
    return value.toISOString();
  };
  const purchaseExamples: CreditBucket[] = import.meta.env.MEMMY_APP_EDITION === "intl" ? [] : [
    ...CREDIT_PACK_ORDERS.filter(order => order.status === "completed").map(order => ({
      id: order.id, source: "purchase" as const, granted: order.pack, remaining: order.remaining,
      grantedAt: date(-order.daysAgo), expiresAt: creditPurchaseExpiresAt(date(-order.daysAgo))
    })),
    ...Array.from({ length: 3 }, (_, index): CreditBucket => ({
      id: `sample-pack-expired-older-${index}`, source: "purchase", granted: 200, remaining: 20 * (index + 1),
      grantedAt: date(-100 - index * 30), expiresAt: creditPurchaseExpiresAt(date(-100 - index * 30))
    })),
  ];
  const examples: CreditBucket[] = [
    ...purchaseExamples,
    { id: "redeem:sample-expired", source: "reward", granted: 500, remaining: 180, grantedAt: date(-40), expiresAt: date(-10) },
    { id: "checkin:sample-expired-used", source: "reward", granted: 100, remaining: 0, grantedAt: date(-35), expiresAt: date(-5) },
    { id: "checkin:sample-recent", source: "reward", granted: 100, remaining: 32.25, grantedAt: date(-1), expiresAt: date(2) },
    { id: "redeem:sample", source: "reward", granted: 500, remaining: 500, grantedAt: date(-10), expiresAt: date(30) },
    { id: "history:sample", source: "reward", granted: 200, remaining: 200, grantedAt: date(-20), expiresAt: null },
    { id: "checkin:sample-used", source: "reward", granted: 100, remaining: 0, grantedAt: date(-6), expiresAt: date(1) }
  ];
  return examples.reduce(grantPreviewCredits, { ...demo, balanceSampleVersion: 4 as const });
}

function invitedPreviewBuckets(anchor: string): CreditBucket[] {
  return ([
    { id: "invite:sample-1", hour: 10, minute: 15, remaining: 200 },
    { id: "invite:sample-2", hour: 14, minute: 40, remaining: 135 }
  ] as const).map(sample => {
    const grantedAt = new Date(anchor);
    grantedAt.setDate(grantedAt.getDate() - 2);
    grantedAt.setHours(sample.hour, sample.minute, 0, 0);
    const expiresAt = new Date(grantedAt);
    expiresAt.setDate(expiresAt.getDate() + 30);
    return { id: sample.id, source: "reward" as const, granted: 200, remaining: sample.remaining,
      grantedAt: grantedAt.toISOString(), expiresAt: expiresAt.toISOString() };
  });
}

export function inviteTokensToCredits(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.round(tokens / (INVITE_TOKENS_PER_CREDIT / 100)) / 100;
}

export function formatInviteCredits(tokens: number, language: string): string {
  return inviteTokensToCredits(tokens).toLocaleString(language === "en-US" ? "en-US" : "zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

export function formatDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function shiftDayKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map((part) => Number(part));
  const date = new Date(year || 1970, (month || 1) - 1, day || 1);
  date.setDate(date.getDate() + days);
  return formatDayKey(date);
}

export function creditCycleKey(demo: CreditDemoState, now = new Date()): string {
  return creditCycleWindow(demo, now).start.toISOString();
}

export type CreditLedgerCall = {
  hoursAgo: number;
  credits: number;
  requestId: string;
};

export type CreditLedgerGroup = {
  id: string;
  kind: "request" | "memory";
  /** When the thing the user recognizes happened. */
  hoursAgo: number;
  titleKey:
    | "credits.ledger.sample.weekly"
    | "credits.ledger.sample.draft"
    | "credits.ledger.sample.memory"
    | "credits.ledger.sample.followup";
  calls: CreditLedgerCall[];
};

/** Two shapes: a user request is one row, a memory job is one row. Calls sit inside the row. */
export const CREDIT_LEDGER: CreditLedgerGroup[] = [
  {
    id: "weekly",
    kind: "request",
    hoursAgo: 2,
    titleKey: "credits.ledger.sample.weekly",
    calls: [
      { hoursAgo: 2, credits: 16.75, requestId: "preview-7f3a" },
      { hoursAgo: 2.1, credits: 12.4, requestId: "preview-7f3b" }
    ]
  },
  {
    id: "draft",
    kind: "request",
    hoursAgo: 8,
    titleKey: "credits.ledger.sample.draft",
    calls: [
      { hoursAgo: 8, credits: 60.68, requestId: "preview-91c2" }
    ]
  },
  {
    id: "memory",
    kind: "memory",
    hoursAgo: 26,
    titleKey: "credits.ledger.sample.memory",
    calls: [
      { hoursAgo: 26, credits: 18.4, requestId: "preview-mem-1" },
      { hoursAgo: 26.2, credits: 14.93, requestId: "preview-mem-2" },
      { hoursAgo: 26.4, credits: 8.12, requestId: "preview-mem-3" }
    ]
  },
  {
    id: "followup",
    kind: "request",
    hoursAgo: 146,
    titleKey: "credits.ledger.sample.followup",
    calls: [
      { hoursAgo: 146, credits: 24.47, requestId: "preview-44e0" },
      { hoursAgo: 146.3, credits: 19.5, requestId: "preview-44e1" }
    ]
  }
];

export function ledgerGroupCredits(group: CreditLedgerGroup): number {
  const total = group.calls.reduce((sum, call) => sum + call.credits, 0);
  return Math.round(total * 100) / 100;
}

export type CreditPool = {
  plan: CreditPlan;
  grant: number;
  planUsed: number;
  planRemaining: number;
  rewardGranted: number;
  rewardUsed: number;
  rewardRemaining: number;
  purchaseGranted: number;
  purchaseUsed: number;
  purchaseRemaining: number;
  totalRemaining: number;
  remainingPercent: number;
  buckets: CreditBucket[];
};

export function describeCreditPool(demo: CreditDemoState = readCreditDemo(), now = new Date()): CreditPool {
  const current = advanceCreditCycle(demo, now);
  const buckets = current.buckets.filter(bucket => activeBucket(bucket, now));
  const sum = (source: CreditSource, field: "granted" | "remaining") => amount(buckets
    .filter(bucket => bucket.source === source).reduce((total, bucket) => total + cents(bucket[field]), 0));
  const planRemaining = sum("plan", "remaining");
  const rewardGranted = sum("reward", "granted");
  const rewardRemaining = sum("reward", "remaining");
  const purchaseGranted = sum("purchase", "granted");
  const purchaseRemaining = sum("purchase", "remaining");
  const grant = CREDIT_GRANTS[current.plan];
  const totalRemaining = amount(cents(planRemaining) + cents(rewardRemaining) + cents(purchaseRemaining));
  const capacity = grant + rewardGranted + purchaseGranted;
  return {
    plan: current.plan, grant, planUsed: amount(cents(grant) - cents(planRemaining)), planRemaining,
    rewardGranted, rewardUsed: amount(cents(rewardGranted) - cents(rewardRemaining)), rewardRemaining,
    purchaseGranted, purchaseUsed: amount(cents(purchaseGranted) - cents(purchaseRemaining)), purchaseRemaining,
    totalRemaining, remainingPercent: capacity > 0 ? Math.round(totalRemaining / capacity * 100) : 0, buckets
  };
}

export type LedgerSpan = "today" | "7" | "30";
export function creditRangeStart(span: LedgerSpan, now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (span === "7" ? 6 : span === "30" ? 29 : 0));
  return start;
}

export function creditCallTime(hoursAgo: number, anchor: Date): Date {
  return new Date(anchor.getTime() - hoursAgo * 3600000);
}

/** Filter calls before grouping; the row and expanded detail share exactly the same calls. */
export function filterCreditLedger(groups: CreditLedgerGroup[], anchor: Date, start: Date, end: Date) {
  return groups.map(group => ({
    ...group,
    calls: group.calls.filter(call => {
      const time = creditCallTime(call.hoursAgo, anchor).getTime();
      return time >= start.getTime() && time <= end.getTime();
    })
  })).filter(group => group.calls.length > 0)
    .map(group => ({ group, at: new Date(Math.max(...group.calls.map(call => creditCallTime(call.hoursAgo, anchor).getTime()))) }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

export function isCreditLow(pool: CreditPool): boolean {
  return pool.grant > 0 && pool.totalRemaining < pool.grant * 0.1;
}

export type CheckinView = {
  claimedToday: boolean;
  filled: number;
  upcomingDay: number;
};

/** A missed day restarts the streak; seven days and month boundaries do not reset it. */
export function describeCheckin(demo: CreditDemoState, today: string): CheckinView {
  if (demo.lastClaimDate === today) {
    return {
      claimedToday: true,
      filled: demo.streak,
      upcomingDay: demo.streak
    };
  }
  const yesterday = shiftDayKey(today, -1);
  const continuing = demo.lastClaimDate === yesterday && demo.streak > 0;
  const upcomingDay = continuing ? demo.streak + 1 : 1;
  return {
    claimedToday: false,
    filled: continuing ? demo.streak : 0,
    upcomingDay
  };
}

/** Exactly 100 per day. The streak is informational and never changes the grant. */
export function claimCheckin(demo: CreditDemoState, today: string): CreditDemoState {
  if (demo.lastClaimDate === today) {
    return demo;
  }
  const yesterday = shiftDayKey(today, -1);
  const continuing = demo.lastClaimDate === yesterday && demo.streak > 0;
  const next = (continuing ? demo.streak : 0) + 1;
  return {
    ...demo,
    lastClaimDate: today,
    checkedIn: true,
    streak: next,
    bonus: Math.round((demo.bonus + CHECKIN_DAILY) * 100) / 100,
    buckets: [...demo.buckets, {
      id: `checkin:${today}`, source: "reward",
      granted: CHECKIN_DAILY,
      remaining: CHECKIN_DAILY,
      grantedAt: new Date(`${today}T00:00:00`).toISOString(), expiresAt: null
    }]
  };
}

function dayKeyOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function validBucket(value: unknown): value is CreditBucket {
  if (!value || typeof value !== "object") return false;
  const b = value as CreditBucket;
  return typeof b.id === "string" && ["plan", "reward", "purchase"].includes(b.source)
    && Number.isFinite(b.granted) && b.granted >= 0 && Number.isFinite(b.remaining)
    && b.remaining >= 0 && b.remaining <= b.granted && Number.isFinite(Date.parse(b.grantedAt))
    && (b.expiresAt === null || Number.isFinite(Date.parse(b.expiresAt)));
}

export function readCreditDemo(now: Date = new Date()): CreditDemoState {
  const base = createCreditDemo(now);
  if (typeof window === "undefined") return base;
  try {
    const key = demoStorageKey();
    let raw = window.sessionStorage.getItem(key);
    const errorScenario = creditErrorScenario();
    if (!raw && errorScenario) {
      const example = new URLSearchParams(window.location.search).get("credits-plan") === "pro"
        ? previewCreditPlan(createCreditDemo(now), "pro", now)
        : createCreditDemo(now);
      example.buckets[0]!.remaining = errorScenario === "knowledge" ? 825
        : errorScenario === "agent" && new URLSearchParams(window.location.search).get("credits-recovered") === "1"
          ? example.buckets[0]!.granted
          : 0;
      raw = JSON.stringify(example);
      window.sessionStorage.setItem(key, raw);
    }
    const scenario = creditRenewalScenario();
    if (!raw && scenario) {
      raw = JSON.stringify({
        ...createRenewalCreditDemo(now, scenario === "prepaid-next" || scenario === "renewal-success"),
        autoRenew: scenario === "auto-renew"
      });
      window.sessionStorage.setItem(key,raw);
    }
    const value = JSON.parse(raw ?? "null") as Partial<CreditDemoState> & { claims?: number } | null;
    let next: CreditDemoState;
    if (value?.version === 2 && Number.isFinite(Date.parse(value.cycleAnchor ?? ""))
      && Number.isFinite(Date.parse(value.ledgerAnchor ?? "")) && Array.isArray(value.buckets)
      && value.buckets.every(validBucket) && (value.plan === "free" || value.plan === "pro")
      && Number.isInteger(value.cycleIndex) && value.cycleIndex! >= 0
      && (value.plan === "free" || Number.isFinite(Date.parse(value.paidUntil ?? "")))) {
      next = { ...base, ...value } as CreditDemoState;
    } else {
      // Migrate the earlier preview without using its old 8,000-credit entitlement.
      next = value?.plan === "pro" ? previewCreditPlan(base, "pro", now) : base;
      const bonus = Number.isFinite(value?.bonus) ? Math.max(0, value!.bonus!) : 0;
      if (bonus > 0) next = grantPreviewCredits(next, {
        id: "legacy-preview-reward", source: "reward", granted: bonus, remaining: bonus,
        grantedAt: now.toISOString(), expiresAt: null
      });
      next = { ...next, bonus,
        lastClaimDate: dayKeyOrNull(value?.lastClaimDate) ?? (value?.checkedIn ? formatDayKey(now) : null),
        streak: Math.max(0, Number(value?.streak ?? value?.claims) || 0),
        cycles: Math.max(0, Number(value?.cycles) || 0), autoRenew: value?.autoRenew === true,
        buckets: consumeCreditBuckets(next.buckets, CREDIT_USED, now).buckets
      };
    }
    if (value?.balanceSampleVersion !== 4) {
      // Rebuild only the old display-only purchase samples so every batch follows the 90-day rule.
      next = { ...next, buckets: next.buckets.filter(bucket => !bucket.id.startsWith("sample-pack")) };
      next = populateCreditDemo(next);
    }
    next = { ...next, buckets: next.buckets.map(bucket => bucket.source === "purchase"
      ? { ...bucket, expiresAt: creditPurchaseExpiresAt(bucket.grantedAt) }
      : bucket) };
    const invitedPreview = new URLSearchParams(window.location.search).get("credits-invited") === "1";
    next = { ...next, buckets: next.buckets.filter(bucket => invitedPreview
      ? bucket.id !== "invite:sample" && !bucket.id.startsWith("invite:sample-expired-older")
      : !bucket.id.startsWith("invite:sample")) };
    if (invitedPreview) {
      next = { ...next, buckets: next.buckets.map(bucket => bucket.id.startsWith("invite:sample-") && bucket.granted !== 200
        ? { ...bucket, remaining: Math.max(0, 200 - (bucket.granted - bucket.remaining)), granted: 200 }
        : bucket) };
      next = invitedPreviewBuckets(next.ledgerAnchor).reduce(grantPreviewCredits, next);
    }
    // Keep the failed-renewal example consistent when loading older preview sessions.
    if (scenario === "renewal-failed") next = { ...next, autoRenew: false };
    next = advanceCreditCycle(next, now);
    if (import.meta.env.MEMMY_APP_EDITION === "intl") next = { ...next, buckets: next.buckets.filter(bucket => bucket.source !== "purchase") };
    next.checkedIn = next.lastClaimDate === formatDayKey(now);
    const serialized = JSON.stringify(next);
    if (raw !== serialized) window.sessionStorage.setItem(key, serialized);
    return next;
  } catch {
    return base;
  }
}

export function writeCreditDemo(next: CreditDemoState): void {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(demoStorageKey(), JSON.stringify(next));
    window.dispatchEvent(new Event(CREDIT_DEMO_EVENT));
  }
}

export function readCreditsQuota(): { plan: CreditPlan; grant: number; balance: number; remainingPercent: number } {
  const pool = describeCreditPool();
  return {
    plan: pool.plan,
    grant: pool.grant,
    balance: pool.totalRemaining,
    remainingPercent: pool.remainingPercent
  };
}
