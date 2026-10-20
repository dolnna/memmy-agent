/** App-integrated purchase destinations. Checkout remains a local preview. */
import { useState, type ReactNode } from "react";
import { AlertCircle, BookOpen, Brain, Check, HardDrive, LoaderCircle, Minus, Plus, Sparkles, Users } from "lucide-react";
import { Button } from "../components/button.js";
import { ConfirmDialog } from "../components/confirm-dialog.js";
import { communityLinks } from "../community/community-links.js";
import { useTranslation } from "../i18n/use-translation.js";
import { CREDIT_GRANTS, CREDIT_PACKS, CREDIT_PACK_ORDERS, CREDIT_PURCHASE_VALIDITY_DAYS, creditCycleWindow, describeCreditPool } from "../app/credits-preview-quota.js";
import { SUBSCRIPTION_CNY, SUBSCRIPTION_USD_MONTH, previewSubscriptionTerm, type SubscriptionMode } from "../app/credit-purchase.js";
import paymentExampleQr from "../assets/credits-payment-example.svg";
import { creditRenewalScenario } from "../app/credits-preview-mode.js";
import { useCreditDemo } from "../app/use-credit-demo.js";
import { CreditsSettingsShell } from "./credits-in-app.js";
import { CreditInfo } from "./credits-info.js";
import { CreditsRedeemForm } from "./credits-redeem-form.js";
import { SubscriptionAgreementDialog } from "./subscription-agreement.js";
import styles from "./settings-token-usage.module.css";

type Purchase = "plan" | 200 | 1000 | 5000;
const PURCHASE_KEY = "memmy.creditsPreview.purchase";
export function readPreviewPurchase(): Purchase | null {
  if (typeof window === "undefined") return null;
  const value = window.sessionStorage.getItem(PURCHASE_KEY);
  return value === "plan" ? "plan" : value && CREDIT_PACKS.some(pack => String(pack.credits) === value) ? Number(value) as Purchase : null;
}
export function selectPreviewPurchase(value: Purchase) {
  window.sessionStorage.setItem(PURCHASE_KEY, String(value));
}
function localPrice(cny: number, usd: number) {
  return import.meta.env.MEMMY_APP_EDITION === "intl" ? `$${usd.toFixed(2)}` : `¥${cny}`;
}
function CommerceHeader(props: { title: string; extra?: ReactNode }) {
  return <header className={styles.commerceHeader}>
    <div><h1>{props.title}</h1>{props.extra}</div>
  </header>;
}
function Benefit(props: { icon: ReactNode; children: ReactNode }) {
  return <li><span className={styles.benefitIcon}>{props.icon}</span><span>{props.children}</span></li>;
}

export function CreditsPlansPage() {
  const { t, language } = useTranslation();
  const { demo } = useCreditDemo();
  const [selected, setSelected] = useState<"free" | "pro">("pro");
  if (demo.plan === "pro") return <CreditsPlanManagement />;
  return <CreditsSettingsShell><div className={`${styles.detailContent} ${styles.commercePage}`}>
    <CommerceHeader title={t("credits.plans.title")} extra={<p>{t("credits.plans.currentLabel", { plan: t("plan.free.name") })}</p>} />
    <div className={styles.entitlementGrid} role="group" aria-label={t("credits.plans.title")}>
      {(["free", "pro"] as const).map(plan => {
        const pro = plan === "pro";
        return <article key={plan} className={`${styles.entitlementCard} ${selected === plan ? styles.entitlementSelected : ""}`}>
          <button type="button" className={styles.planSelection} aria-pressed={selected === plan} onClick={() => setSelected(plan)}>
            <span className={styles.planName}>{t(pro ? "plan.pro.name" : "plan.free.name")}</span>
            <span className={styles.planSummary}>{t(pro ? "credits.plan.proSummary" : "credits.plan.freeSummary")}</span>
            <span className={styles.selectionDot} aria-hidden="true" />
          </button>
          <ul className={styles.benefitList}>
            <Benefit icon={<Sparkles size={16} />}>{t("credits.plan.monthlyCredits", { count: CREDIT_GRANTS[plan].toLocaleString(language) })}<span className={styles.benefitValidity}>{t("credits.plan.validityMonth")}</span></Benefit>
            <Benefit icon={<Brain size={16} />}>{t("credits.plans.allModels")}</Benefit>
            <Benefit icon={<BookOpen size={16} />}>{t("credits.plan.bases", { count: pro ? 50 : 10 })}</Benefit>
            <Benefit icon={<HardDrive size={16} />}>{t("credits.plan.storage", { count: pro ? 50 : 10 })}</Benefit>
            <Benefit icon={<Users size={16} />}>{t("credits.plan.people", { count: pro ? 10 : 5 })}</Benefit>
          </ul>
        </article>;
      })}
    </div>
    {selected === "pro" ? <div className={styles.planCheckout}><PurchaseConfirmation /></div> : (
      <div className={styles.purchaseBar}>
        <div><span>{t("plan.free.name")}</span><strong>{localPrice(0, 0)}</strong></div>
        <span>{t(demo.plan === "free" ? "credits.plans.current" : "credits.plan.freeAfterTerm")}</span>
      </div>
    )}

  </div></CreditsSettingsShell>;
}

function CreditsPlanManagement() {
  const { t, language } = useTranslation();
  const { demo, now, update } = useCreditDemo();
  const [cancelOpen, setCancelOpen] = useState(false);
  const intl = import.meta.env.MEMMY_APP_EDITION === "intl";
  const scenario = creditRenewalScenario();
  const success = scenario === "renewal-success";
  const paymentPending = scenario === "payment-pending";
  const renewalFailed = scenario === "renewal-failed";
  const date = (value: string) => new Date(value).toLocaleDateString(language, { year:"numeric",month:"2-digit",day:"2-digit" });
  const cycle = creditCycleWindow(demo, now);
  const end = date(demo.paidUntil ?? cycle.end.toISOString());
  const currentTerm = `${date(cycle.start.toISOString())} – ${date(cycle.end.toISOString())}`;
  const prepaidNext = demo.paidUntil !== null && new Date(demo.paidUntil).getTime() > cycle.end.getTime();
  const nextTerm = prepaidNext ? `${date(cycle.end.toISOString())} – ${end}` : null;
  const pendingTerm = paymentPending ? previewSubscriptionTerm(demo, now) : null;
  const nextCharge = new Date(demo.paidUntil ?? cycle.end.toISOString());
  nextCharge.setDate(nextCharge.getDate() - 1);
  const pool = describeCreditPool(demo, now);
  return <CreditsSettingsShell><div className={`${styles.detailContent} ${styles.commercePage}`}>
    <CommerceHeader title={t("credits.balance.managePlan")} />
    {success && <div className={styles.renewalSuccess} role="status"><Check size={18}/><div><strong>{t("credits.renewal.success")}</strong><p>{t("credits.renewal.extended",{date:end})}</p></div></div>}
    <section className={styles.renewalAccount} aria-label={t("credits.balance.managePlan")}>
      <div className={styles.renewalAccountHead}><div><h2>{t("plan.pro.name")}</h2><p>{t("credits.plan.monthlyCredits",{count:"5,000"})}</p></div></div>
      {renewalFailed && <div className={styles.renewalFailure} role="status">
        <AlertCircle size={16} aria-hidden="true" />
        <div><strong>{t("credits.renewal.failed")}</strong><p>{t("credits.renewal.failedBody", {date:end})}</p></div>
      </div>}
      <dl className={styles.renewalFacts}>
        <div><dt>{t("credits.renewal.validUntil")}</dt><dd>{currentTerm}</dd></div>
        <div><dt>{t("credits.renewal.planBalance")}</dt><dd>{pool.planRemaining.toLocaleString(language,{minimumFractionDigits:2,maximumFractionDigits:2})}</dd></div>
        <div><dt>{t("credits.renewal.mode")}</dt><dd>{t(demo.autoRenew&&!intl?"credits.subscription.recurring":"credits.renewal.manual")}</dd></div>
      </dl>
    </section>
    {pendingTerm && <section className={styles.renewalPending} aria-label={t("credits.payment.pending")} role="status">
      <div className={styles.renewalPendingHead}>
        <LoaderCircle size={20} className={styles.renewalPendingIcon} aria-hidden="true" />
        <div><h2>{t("credits.payment.pending")}</h2><p>{t("credits.payment.confirming")}</p></div>
        <strong>{localPrice(intl ? 50 : SUBSCRIPTION_CNY.recurring, SUBSCRIPTION_USD_MONTH)}</strong>
      </div>
      <div className={styles.renewalPendingDetails}>
        <span>{t("plan.pro.name")} · {t(intl ? "credits.subscription.month" : "credits.subscription.recurring")} · {t(intl ? "credits.plans.paypal" : "credits.plans.alipay")}</span>
        <span>{t("credits.payment.pendingTerm",{start:date(pendingTerm.start.toISOString()),end:date(pendingTerm.end.toISOString())})}</span>
      </div>
    </section>}
    {nextTerm && <section className={`${styles.renewalSuccess} ${styles.renewalPrepaid}`} aria-label={t("credits.renewal.nextPurchased")}><Check size={18}/><div><strong>{t("credits.renewal.nextPurchased")}</strong><p>{t("plan.pro.name")} · {nextTerm}</p></div></section>}
    {!intl && demo.autoRenew && <section className={styles.renewalRow}>
      <div><strong>{t("credits.plans.renewTitle")}</strong><p>{t("credits.plans.renewNext",{time:date(nextCharge.toISOString())})}</p></div>
      <Button type="button" size="sm" variant="secondary" onClick={()=>setCancelOpen(true)}>{t("credits.plans.renewCancel")}</Button>
    </section>}
    {!demo.autoRenew && !prepaidNext && !paymentPending && <section className={styles.planCheckout}><PurchaseConfirmation /></section>}
    <div className={styles.renewalRefund}><span>{t("credits.support.emailLabel")}</span><a className={styles.renewalEmail} href={communityLinks.emailUrl} onClick={event => {
      if (typeof window.memmy?.openMailto === "function") {
        event.preventDefault();
        void window.memmy.openMailto(communityLinks.emailUrl);
      }
    }}>{communityLinks.email}</a></div>
    <ConfirmDialog open={cancelOpen} title={t("credits.plans.renewCancelTitle")} message={t("credits.plans.renewCancelBody",{time:end})} cancelLabel={t("credits.plans.renewKeep")} closeLabel={t("common.close")} confirmLabel={t("credits.plans.renewConfirm")} onCancel={()=>setCancelOpen(false)} onConfirm={()=>{update({autoRenew:false});setCancelOpen(false);}} />
  </div></CreditsSettingsShell>;
}

export function CreditsPacksPage() {
  if (import.meta.env.MEMMY_APP_EDITION === "intl") return <CreditsPlansPage />;
  return <DomesticCreditsPacksPage />;
}

function DomesticCreditsPacksPage() {
  const { t, language } = useTranslation();
  const [selected, setSelected] = useState<200 | 1000 | 5000>(1000);
  return <CreditsSettingsShell><div className={`${styles.detailContent} ${styles.commercePage}`}>
    <CommerceHeader title={t("credits.packs.buy")} />
    <div className={styles.packChoices} role="group" aria-label={t("credits.packs.title")}>
      {CREDIT_PACKS.map(item => <button type="button" key={item.credits} aria-pressed={item.credits === selected} className={`${styles.packChoice} ${item.credits === selected ? styles.entitlementSelected : ""}`} onClick={() => setSelected(item.credits)}>
        <strong><Sparkles size={16} className={styles.packCreditIcon} aria-hidden="true" />{item.credits.toLocaleString(language)} <small>{t("credits.unit")}</small></strong><span>{localPrice(item.cny, item.usd)}</span>
      </button>)}
    </div>
    <div className={styles.planCheckout}><PackPurchaseConfirmation key={selected} purchase={selected} /></div>
    <PackPurchaseHistory />
  </div></CreditsSettingsShell>;
}

function PackPurchaseHistory() {
  const { t, language } = useTranslation();
  const { demo } = useCreditDemo();
  const [expanded, setExpanded] = useState(false);
  const intl = import.meta.env.MEMMY_APP_EDITION === "intl";
  return <section className={styles.purchaseHistory} aria-labelledby="pack-history-heading">
    <h2 id="pack-history-heading">{t("credits.orders.title")}</h2>
    <div className={styles.purchaseHistoryScroll}>
      <table className={styles.purchaseHistoryTable}>
        <thead><tr>
          <th scope="col">{t("credits.orders.time")}</th><th scope="col">{t("credits.orders.credits")}</th>
          <th scope="col">{t("credits.orders.amount")}</th>
          {!intl && <th scope="col">{t("credits.checkout.method")}</th>}
          <th scope="col">{t("credits.orders.status")}</th>
        </tr></thead>
        <tbody>{(expanded ? CREDIT_PACK_ORDERS : CREDIT_PACK_ORDERS.slice(0, 3)).map(order => {
          const pack = CREDIT_PACKS.find(item => item.credits === order.pack)!;
          const date = new Date(demo.ledgerAnchor);
          date.setDate(date.getDate() - order.daysAgo);
          return <tr key={order.id}>
            <td><time dateTime={date.toISOString()}>{date.toLocaleString(language, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</time></td>
            <td>{pack.credits.toLocaleString(language)}</td><td>{localPrice(pack.cny, pack.usd)}</td>
            {!intl && <td>{t(order.channel === "alipay" ? "credits.plans.alipay" : "credits.plans.wechat")}</td>}
            <td><span className={order.status === "completed" ? styles.orderCompleted : styles.orderClosed}>{t(order.status === "completed" ? "credits.orders.completed" : "credits.orders.closed")}</span></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <Button type="button" variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t(expanded ? "credits.detail.collapse" : "credits.orders.showAll", { count: CREDIT_PACK_ORDERS.length })}</Button>
  </section>;
}

export function CreditsRedeemPage() {
  const { t } = useTranslation();
  return <CreditsSettingsShell><div className={`${styles.detailContent} ${styles.commercePage}`}>
    <CommerceHeader title={t("credits.redeem.title")} extra={<CreditInfo label={t("credits.info.redeemLabel")} content={t("credits.redeem.lead")} />} />
    <CreditsRedeemForm />
  </div></CreditsSettingsShell>;
}

function PackPurchaseConfirmation(props: { purchase: 200 | 1000 | 5000 }) {
  const { t, language } = useTranslation();
  const intl = import.meta.env.MEMMY_APP_EDITION === "intl";
  const [quantity, setQuantity] = useState(1);
  const [channel, setChannel] = useState<"wechat" | "alipay">("alipay");
  const [confirmed, setConfirmed] = useState(false);
  const pack = CREDIT_PACKS.find(item => item.credits === props.purchase)!;
  const totalCredits = pack.credits * quantity;
  const price = localPrice(pack.cny * quantity, pack.usd * quantity);
  function chooseQuantity(next: number) {
    setQuantity(Math.min(99, Math.max(1, next)));
    setConfirmed(false);
  }
  return <section className={styles.checkoutPanel} aria-label={t("credits.checkout.title")}>
    {!intl && <div className={styles.payMethods} role="group" aria-label={t("credits.checkout.method")}>
      {(["alipay", "wechat"] as const).map(method => <button key={method} type="button" aria-pressed={channel === method} className={`${styles.payMethod} ${channel === method ? styles.payMethodOn : ""}`} onClick={() => { setChannel(method); setConfirmed(false); }}>{t(method === "wechat" ? "credits.plans.wechat" : "credits.plans.alipay")}</button>)}
    </div>}
    <div className={styles.scanPayment}>
      {!intl && <div className={styles.scanCode}>
        <img src={paymentExampleQr} alt={t("credits.payment.qrAlt")} className={!confirmed ? styles.scanCodeLocked : undefined} />
        {!confirmed && <div className={styles.scanCodeCover}>
          <span>{t("credits.packs.buyThenScan")}</span>
          <Button type="button" size="sm" variant="primary" onClick={() => setConfirmed(true)}>{t("credits.packs.buyNow")}</Button>
        </div>}
        <span className={styles.scanCodeCaption}>{t("credits.payment.exampleCode")}</span>
      </div>}
      <div className={`${styles.scanPaymentDetails} ${styles.packCheckoutDetails}`}>
        <div className={styles.packCheckoutRow}>
          <span>{t("credits.packs.quantity")}</span>
          <div className={styles.packQuantity}>
            <button type="button" aria-label={t("credits.packs.decrease")} disabled={quantity === 1} onClick={() => chooseQuantity(quantity - 1)}><Minus size={14} aria-hidden="true" /></button>
            <output aria-live="polite">{quantity}</output>
            <button type="button" aria-label={t("credits.packs.increase")} disabled={quantity === 99} onClick={() => chooseQuantity(quantity + 1)}><Plus size={14} aria-hidden="true" /></button>
          </div>
        </div>
        <div className={styles.packCheckoutRow}><span>{t("credits.packs.totalCredits")}</span><strong>{totalCredits.toLocaleString(language)}</strong></div>
        <p className={styles.packValidityNote}>{t("credits.packs.validityDays", { days: String(CREDIT_PURCHASE_VALIDITY_DAYS) })}</p>
        <div className={styles.packCheckoutTotal}><span>{t(intl ? "credits.checkout.title" : channel === "alipay" ? "credits.payment.alipayScan" : "credits.payment.wechatScan")}</span><strong>{price}</strong></div>
        {intl && <Button type="button" variant="primary" onClick={() => setConfirmed(true)}>{t("credits.packs.buyNow")}</Button>}
        {intl && confirmed && <p role="status" className={styles.payNote}>{t("credits.packs.intlUnavailable")}</p>}
      </div>
    </div>
  </section>;
}

function PurchaseConfirmation() {
  const { t, language } = useTranslation();
  const { demo, now } = useCreditDemo();
  const intl = import.meta.env.MEMMY_APP_EDITION === "intl";
  const scenario = creditRenewalScenario();
  const initialPaymentState = scenario === "payment-failed" ? "failed" : scenario === "qr-expired" ? "expired" : scenario === "payment-confirming" ? "confirming" : "ready";
  const [paymentState, setPaymentState] = useState<"ready" | "failed" | "expired" | "confirming">(initialPaymentState);
  const confirming = paymentState === "confirming";
  const [mode, setMode] = useState<SubscriptionMode>("month");
  const [channel, setChannel] = useState<"wechat" | "alipay">("alipay");
  const [agreed, setAgreed] = useState(initialPaymentState !== "ready");
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const price = localPrice(SUBSCRIPTION_CNY[mode], SUBSCRIPTION_USD_MONTH);
  const term = previewSubscriptionTerm(demo, now);
  const termDate = (value: Date) => value.toLocaleDateString(language, { year:"numeric", month:"2-digit", day:"2-digit" });
  const summary = t(intl ? "credits.subscription.monthSummaryIntl" : mode === "recurring" ? "credits.subscription.recurringSummary" : "credits.subscription.monthSummary", {start:termDate(term.start),end:termDate(term.end)});
  const agreementName = t(intl ? "credits.plans.agreementNameIntl" : "credits.plans.agreementName");
  function chooseMode(next: SubscriptionMode) {
    setMode(next);setAgreed(false);setSubmitted(false);setPaymentState("ready");
  }
  return <>
    <div className={styles.subscriptionOptions} role="group" aria-label={t("credits.subscription.choose")}>
      {!intl && <button type="button" disabled={confirming} aria-pressed={mode === "recurring"} className={`${styles.subscriptionOption} ${mode === "recurring" ? styles.entitlementSelected : ""}`} onClick={() => chooseMode("recurring")}>
        <span>{t("credits.subscription.recurring")} <em>{t("credits.subscription.discount")}</em></span><strong>¥40<small>{t("credits.plan.perMonth")}</small></strong>
      </button>}
      <button type="button" disabled={confirming} aria-pressed={mode === "month"} className={`${styles.subscriptionOption} ${mode === "month" ? styles.entitlementSelected : ""}`} onClick={() => chooseMode("month")}>
        <span>{t("credits.subscription.month")}</span><strong>{localPrice(50, SUBSCRIPTION_USD_MONTH)}{!intl && <small>{t("credits.plan.perMonth")}</small>}</strong>
      </button>
    </div>
    <section className={styles.checkoutPanel} aria-label={t("credits.checkout.title")}>
      {!intl && <div className={styles.payMethods} role="group" aria-label={t("credits.checkout.method")}>
        {(["alipay","wechat"] as const).map(method => <button key={method} type="button" disabled={confirming} aria-pressed={channel === method} className={`${styles.payMethod} ${channel === method ? styles.payMethodOn : ""}`} onClick={() => {setChannel(method);setAgreed(false);setSubmitted(false);setPaymentState("ready");}}>{t(method === "wechat" ? "credits.plans.wechat" : "credits.plans.alipay")}</button>)}
      </div>}
      <div className={styles.scanPayment}>
        {!intl && <div className={styles.scanCode}>
          <img src={paymentExampleQr} alt={t("credits.payment.qrAlt")} className={!agreed || paymentState !== "ready" ? styles.scanCodeLocked : undefined} />
          {paymentState !== "ready" ? <div className={styles.scanCodeCover} role="status">
            {confirming ? <LoaderCircle size={22} className={styles.renewalPendingIcon} aria-hidden="true" /> : <AlertCircle size={20} className={paymentState === "failed" ? styles.paymentFailureIcon : undefined} aria-hidden="true" />}
            <span>{t(paymentState === "failed" ? "credits.payment.failed" : paymentState === "expired" ? "credits.payment.expired" : "credits.payment.confirming")}</span>
            {!confirming && <Button type="button" size="sm" variant="primary" onClick={() => {setPaymentState("ready");}}>{t(paymentState === "failed" ? "credits.payment.retry" : "credits.payment.refreshQr")}</Button>}
          </div> : !agreed && <div className={styles.scanCodeCover}>
            <span>{t("credits.payment.agreeToScan")}</span>
            <Button type="button" size="sm" variant="primary" onClick={() => setAgreed(true)}>{t("credits.plans.scanAgree")}</Button>
          </div>}
          <span className={styles.scanCodeCaption}>{t("credits.payment.exampleCode")}</span>
        </div>}
        <div className={styles.scanPaymentDetails}>
          <p className={styles.scanMethod}>{t(confirming ? "credits.payment.confirming" : intl ? "credits.plans.paypal" : channel === "alipay" ? "credits.payment.alipayScan" : "credits.payment.wechatScan")}</p>
          <div className={styles.scanAmount}><strong>{price}</strong>{!intl && <span>{t("credits.plan.perMonth")}</span>}</div>
          <p className={styles.scanSummary}>{summary}</p>
          <div className={styles.checkoutAgreement}>
            <label><input type="checkbox" disabled={confirming} checked={agreed} onChange={event => {setAgreed(event.target.checked);setSubmitted(false);}} />{t("credits.plans.agreeLead")}</label>
            <button type="button" onClick={() => setAgreementOpen(true)}>{agreementName}</button>
          </div>
          {intl && <Button type="button" variant="primary" disabled={!agreed || confirming} onClick={() => setSubmitted(true)}>{t("credits.plans.continuePaypal")}</Button>}
          {submitted && <p role="status" className={styles.payNote}>{t(intl ? "credits.plans.paypalUnavailable" : "credits.plans.unavailable")}</p>}
        </div>
      </div>
    </section>
    {agreementOpen && <SubscriptionAgreementDialog kind="subscription" onClose={() => setAgreementOpen(false)} onAccept={() => {setAgreed(true);setAgreementOpen(false);}} />}
  </>;
}

export function CreditsCheckoutPage() {
  const { t } = useTranslation();
  const [purchase] = useState(readPreviewPurchase);
  const pack = CREDIT_PACKS.find(item => item.credits === purchase);
  if (import.meta.env.MEMMY_APP_EDITION === "intl" && pack) return <CreditsPlansPage />;
  return <CreditsSettingsShell backRoute={pack ? "/credit-packs" : "/plans"} backLabel={t(pack ? "credits.packs.buy" : "credits.plans.title")}><div className={`${styles.detailContent} ${styles.commercePage}`}>
    <CommerceHeader title={t("credits.checkout.title")} />
    {purchase === null ? <p>{t("credits.checkout.empty")}</p> : pack ? <PackPurchaseConfirmation purchase={pack.credits} /> : <PurchaseConfirmation />}
  </div></CreditsSettingsShell>;
}
