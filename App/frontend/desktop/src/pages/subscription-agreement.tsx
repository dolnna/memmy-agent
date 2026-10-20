/** Purchase information for the in-app preview; final commercial terms are pending. */
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "../components/button.js";
import { Modal } from "../components/modal.js";
import { useTranslation } from "../i18n/use-translation.js";

const UPDATED = "2026-10-16";
const COPY = {
  "zh-CN": [
    [
      "一、服务范围",
      "本协议为记忆张量（上海）科技有限公司向 Memmy 个人用户提供订阅服务的补充约定，与《Memmy 服务协议》《Memmy 数据使用与隐私说明》共同适用。订阅权益属于购买时登录的账号。正式开通前，用户应核对套餐、价格、订阅方式和有效期；未成年人应在监护人同意及指导下使用。"
    ],
    [
      "二、套餐与订购",
      "免费版每月 1,000 套餐积分。进阶版每月 5,000 套餐积分，可创建 50 个知识库，容量共 50G，每库共享 10 人，两档均可使用全部平台模型。国内进阶版可选“连续包月”或“1个月”：连续包月为 ¥40/月，是单月 ¥50 的八折；1个月为一次性支付 ¥50，不自动续费。两种方式权益相同。海外单月售价为 $8.99，通过 PayPal 购买并手动续费。"
    ],
    [
      "三、开通、有效期与积分",
      "正式支付确认并开通后开始计算订阅周期。周期为一个日历月，按开通日期每月更新；短月没有对应日期时取月末，后续月份仍按原日期计算。有效期以订单确认结果为准。免费版升级时套餐积分重置为 5,000，未过期的奖励和购买积分保留。每周期结束时套餐剩余积分清零、不结转，新周期开始后发放对应套餐积分。提前续费从已购有效期末尾延长，不提前重置本周期积分。"
    ],
    [
      "四、积分消耗",
      "Agent 任务、记忆服务及知识库相关处理调用平台模型时，按该模型实际输入、缓存和输出 token 用量计费，具体单价以产品展示为准。多来源积分按过期时间从近到远扣除，长期有效的最后使用；自己的 API Key 不消耗 Memmy 积分。任务中断前的实际用量仍计费，已生成内容与进度保留。平台奖励的数量、条件和有效期按活动规则执行。"
    ],
    [
      "五、自动续费服务规则",
      "仅选择连续包月并完成订阅及支付渠道授权的用户开通自动续费。连续包月在当前已购有效期到期日前一天，按 ¥40 为下一周期续费；扣款前会通过应用或支付渠道提醒。续费支付与新周期积分发放分别处理，提前扣款不提前清空本周期积分。用户可在 Memmy 套餐页或支付渠道的自动扣款管理中随时取消；取消后已付费权益保留至全部已购有效期结束。若下一期费用已经成功扣除，取消仅停止后续自动扣款，已扣费用按退款规则处理。价格或扣款条件变更须提前告知并取得相应同意。"
    ],
    [
      "六、单月购买、到期与异常",
      "选择“1个月”只购买一期，不开启自动续费；已有自动续费设置需要单独管理。全部已购权益到期且未续费时转为免费版；已有知识库、文件与共享关系保留，超出免费版上限时限制相应新增操作。支付结果未确认时处理原订单，同一订单不重复开通或发放；续费失败、重复支付及迟到支付结果按确认后的订单处理规则核对。"
    ],
    [
      "七、退款与权益变更",
      "关闭自动续费与申请退款是两项独立操作。退款资格、部分消耗后的退款金额、处理时限及权益回收方式尚需在正式支付上线前确定并展示，当前草案不将其他产品的退款政策自动用于 Memmy。用户可通过应用内反馈或 memmy@memtensor.cn 联系我们。服务或已购权益发生变更时，应告知受影响用户并说明剩余权益的处理方式。"
    ],
    [
      "八、账号与本草案状态",
      "请妥善保管账号和支付授权，不通过非官方渠道购买或利用重复订单、活动漏洞获取积分。本文件为本地评审草案，正式生效日期及退款等未确认条款在支付上线前补齐。当前界面的二维码为不含收款地址的示意码，勾选、扫码或确认均不会建立真实订单、扣款授权或订阅。"
    ]
  ],
  "en-US": [
    [
      "1. Scope",
      "This draft covers personal subscriptions provided by Memory Tensor (Shanghai) Technology Co., Ltd., together with the Memmy service and privacy terms. Benefits belong to the purchasing account. Review the plan, price, term and renewal option before purchase."
    ],
    [
      "2. Plans and prices",
      "Free includes 1,000 monthly credits. Plus includes 5,000 credits, 50 knowledge bases, 50 GB total storage and sharing with 10 people per base. Both plans support all platform models. In mainland China, a recurring monthly subscription costs ¥40 per month (20% off ¥50); a one-month purchase costs ¥50 without enabling auto-renewal. Benefits are identical. International one-month pricing is $8.99 through PayPal, with manual renewal."
    ],
    [
      "3. Term and grants",
      "The calendar-month term starts when the purchase is confirmed and activated. Months without the anniversary day use their last day and retain the original anniversary thereafter. Confirmed order dates take precedence. Upgrading resets plan credits to 5,000 and preserves other valid credits. Unused plan credits expire each cycle. Early renewal extends the paid term without resetting current credits."
    ],
    [
      "4. Usage",
      "Platform calls made by Agent tasks, memory services or knowledge processing consume credits based on actual token usage and published model prices. Credits expiring soonest are used first. Your own API key does not consume Memmy credits. Usage incurred before interruption is charged and existing work is retained. Rewards follow their activity terms."
    ],
    [
      "5. Automatic renewal",
      "Auto-renewal applies only after a recurring plan is selected and the subscription and payment authorization are completed. Renewal occurs one day before the paid term ends, at ¥40 for the next cycle, with a prior notice in the app or from the payment provider. An early renewal payment does not reset current credits. Cancel anytime in Memmy or the payment provider; purchased benefits remain through expiry. An already completed charge is handled separately under the refund policy. Changes to price or payment conditions require notice and appropriate consent."
    ],
    [
      "6. One-month purchases and expiry",
      "A one-month purchase does not enable auto-renewal; existing renewal settings are managed separately. When all paid benefits expire without renewal, the account returns to Free. Existing files, bases and shared members are retained; additions exceeding the Free limits are restricted. Pending or duplicate payment results must be reconciled against the original order."
    ],
    [
      "7. Refunds and changes",
      "Cancellation and refunds are separate actions. Refund eligibility, amounts after partial use, timelines and benefit removal must be finalized before live payments launch. Another product’s refund policy does not automatically apply. Contact in-app support or memmy@memtensor.cn. Changes affecting purchased benefits require notice and an explanation of remaining benefits."
    ],
    [
      "8. Draft status",
      "Protect your account and payment authorization. This is a local review draft; the effective date and unresolved provisions will be finalized before launch. The current illustrative QR contains no payment address. The interface does not create an order, subscription or payment authorization."
    ]
  ]
};
const INTL_COPY = {
  "zh-CN": [
    ["购买内容", "通过 PayPal 一次性购买进阶版 1 个月，价格为 $8.99。每月提供 5,000 套餐积分、50 个知识库、50G 总容量和每库 10 人共享；可使用全部平台模型。"],
    ["有效期与续费", "购买成功后从开通时间起算一个月。不会自动续费；如需继续使用，可手动再购买 1 个月。提前续费从已购有效期末尾延长，当前周期积分不重置。"],
    ["退款与问题处理", "实际支付后 24 小时内，且该订单积分完全未使用，可通过 memmy@memtensor.cn 申请全额退款。重复扣款、错误扣款及其他支付问题通过邮件核实处理，适用的法定退款权利保留。"],
    ["当前状态", "本页面为本地购买流程演示。PayPal 尚未接入，确认操作不会创建订单、扣款或开通套餐。"]
  ],
  "en-US": [
    ["Purchase", "A one-time, one-month Plus purchase through PayPal costs $8.99. Plus includes 5,000 monthly credits, 50 knowledge bases, 50 GB total storage, sharing with 10 people per base, and access to all platform models."],
    ["Term and renewal", "The one-month term begins on activation. It does not renew automatically. You can buy another month manually; an early renewal extends the paid term without resetting credits in the current cycle."],
    ["Refunds and payment issues", "You may request a full refund at memmy@memtensor.cn within 24 hours of payment if none of that order's credits have been used. Duplicate or incorrect charges are reviewed by email. Applicable statutory refund rights remain available."],
    ["Current status", "This is a local purchase-flow preview. PayPal is not connected; confirmation does not create an order, charge you, or activate Plus."]
  ]
};
const PACK_COPY = {
  "zh-CN": [
    [
      "积分包",
      "国内版可购买 200 积分 ¥5、1,000 积分 ¥25 或 5,000 积分 ¥125。积分到账后 90 天有效，到期未用完自动失效；不改变套餐或发放周期，不开启自动续费。退款细则将在正式购买前展示。"
    ],
    [
      "使用",
      "积分按过期时间从近到远扣除，平台模型按实际用量计费。"
    ],
    [
      "当前状态",
      "当前为本地界面演示，不会创建真实订单、扣款或到账。"
    ]
  ],
  "en-US": [
    [
      "Credit packs",
      "Credit packs are available in mainland China at ¥5 for 200 credits, ¥25 for 1,000, or ¥125 for 5,000. Credits expire 90 days after they are granted. Packs do not change your plan or cycle and do not enable auto-renewal. Refund rules will be displayed before live purchase."
    ],
    [
      "Usage",
      "Credits expiring soonest are used first; platform calls are charged by actual usage."
    ],
    [
      "Current status",
      "This local interface does not create orders, charges or credit grants."
    ]
  ]
};

export function SubscriptionAgreementDialog(props: { kind?: "subscription" | "pack"; onClose: () => void; onAccept: () => void }) {
  const { t, language } = useTranslation();
  const intlSubscription = props.kind !== "pack" && import.meta.env.MEMMY_APP_EDITION === "intl";
  if (typeof document === "undefined") return null;
  return createPortal(
    <Modal
      open title={t(props.kind === "pack" ? "credits.packs.agreementTitle" : intlSubscription ? "credits.plans.agreementTitleIntl" : "credits.plans.agreementTitle")}
      subtitle={t("credits.plans.agreementMeta", { date: UPDATED })}
      closeLabel={t("common.close")} closeContent={<X size={16} aria-hidden="true" />}
      className="confirm-dialog confirm-dialog--titled subscription-agreement-dialog"
      bodyClassName="confirm-dialog__body" footerClassName="confirm-dialog__footer"
      onClose={props.onClose}
      footer={<>
        <Button variant="ghost" size="sm" type="button" onClick={props.onClose}>{t("common.close")}</Button>
        <Button variant="primary" size="sm" type="button" onClick={props.onAccept}>{t("credits.plans.scanAgree")}</Button>
      </>}
    >
      <div className="confirm-dialog__message subscription-agreement-dialog__copy">
        <p className="subscription-agreement-dialog__note">{t("credits.plans.agreementNote")}</p>
        {(props.kind === "pack" ? PACK_COPY : intlSubscription ? INTL_COPY : COPY)[language === "en-US" ? "en-US" : "zh-CN"].map(([heading, text]) => (
          <section key={heading}><h3>{heading}</h3><p>{text}</p></section>
        ))}
      </div>
    </Modal>, document.body
  );
}
