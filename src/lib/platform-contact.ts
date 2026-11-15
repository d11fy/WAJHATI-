import { z } from "zod";
import type { Locale } from "./i18n";

export const defaultPlatformWhatsapp = "972567508786";

export const smtpInput = z.object({
  host: z.string().trim().toLowerCase().max(253).regex(/^(?=.{4,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/),
  port: z.coerce.number().pipe(z.union([z.literal(465), z.literal(587)])),
  user: z.string().trim().min(1).max(254).regex(/^[^\r\n]+$/),
  from: z.email().max(254),
  name: z.string().trim().min(1).max(80).regex(/^[^\r\n]+$/),
  replyTo: z.union([z.email().max(254), z.literal("")]).default(""),
});

export type SmtpConfig = z.infer<typeof smtpInput>;
export type ContactSettings = { enabled: boolean; whatsapp: string };
export const subscriptionMonths = [1, 3, 6, 12] as const;
export type SubscriptionMonths = (typeof subscriptionMonths)[number];

export type SubscriptionContactDetails = {
  store?: string;
  email?: string;
  plan?: "starter" | "pro";
  interval?: "monthly" | "yearly";
  mode?: "activate" | "renew";
};

export function normalizeWhatsappPhone(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s()-]+/g, "").replace(/^(?:\+|00)/, "");
  return /^[1-9][0-9]{7,14}$/.test(cleaned) ? cleaned : null;
}

export function formatWhatsappPhone(phone: string): string {
  const normalized = normalizeWhatsappPhone(phone) ?? defaultPlatformWhatsapp;
  return `+${normalized}`;
}

export function subscriptionContact(
  phone: string,
  locale: Locale,
  storeOrDetails?: string | SubscriptionContactDetails,
  intervalArg?: "monthly" | "yearly",
) {
  const normalized = normalizeWhatsappPhone(phone);
  if (!normalized) return null;
  const details: SubscriptionContactDetails = typeof storeOrDetails === "string"
    ? { store: storeOrDetails, interval: intervalArg }
    : (storeOrDetails ?? {});
  const store = details.store?.trim();
  const email = details.email?.trim();
  const plan = details.plan;
  const interval = details.interval ?? intervalArg;
  const isRenew = details.mode === "renew";

  if (locale === "ar") {
    const planLabel = plan === "starter" ? "Starter (الأساسية)" : plan === "pro" ? "Pro (الاحترافية)" : "";
    const intervalLabel = interval === "monthly" ? "شهري" : interval === "yearly" ? "سنوي" : "";
    const parts = [
      isRenew
        ? `مرحبًا فريق واجهتي، أرغب في تجديد اشتراك متجري${store ? ` (${store})` : ""}.`
        : `مرحبًا فريق واجهتي، أرغب في تفعيل اشتراك متجري${store ? ` (${store})` : ""}.`,
      email ? `البريد الإلكتروني للحساب: ${email}` : "",
      planLabel ? `الباقة المطلوبة: ${planLabel}` : "",
      intervalLabel ? `خيار الفوترة: ${intervalLabel}` : "",
    ].filter(Boolean);
    return `https://wa.me/${normalized}?text=${encodeURIComponent(parts.join("\n"))}`;
  }

  const planLabel = plan === "starter" ? "Starter" : plan === "pro" ? "Pro" : "";
  const intervalLabel = interval === "monthly" ? "Monthly" : interval === "yearly" ? "Yearly" : "";
  const parts = [
    isRenew
      ? `Hello WAJHATI team, I would like to renew my store subscription${store ? ` (${store})` : ""}.`
      : `Hello WAJHATI team, I would like to activate my store subscription${store ? ` (${store})` : ""}.`,
    email ? `Account email: ${email}` : "",
    planLabel ? `Requested plan: ${planLabel}` : "",
    intervalLabel ? `Billing option: ${intervalLabel}` : "",
  ].filter(Boolean);
  return `https://wa.me/${normalized}?text=${encodeURIComponent(parts.join("\n"))}`;
}

export function previewSubscriptionDates(currentPeriodEnd: string | null | undefined, months: SubscriptionMonths, now = new Date()) {
  const currentEnd = currentPeriodEnd ? new Date(currentPeriodEnd) : null;
  const start = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now;
  const end = addUtcCalendarMonths(start, months);
  return { startsAt: start.toISOString(), endsAt: end.toISOString(), appendsToActive: Boolean(currentEnd && currentEnd.getTime() > now.getTime()) };
}

export function addUtcCalendarMonths(start: Date, months: number): Date {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const day = start.getUTCDate();
  const targetMonthIndex = month + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return new Date(Date.UTC(
    targetYear,
    normalizedMonth,
    clampedDay,
    start.getUTCHours(),
    start.getUTCMinutes(),
    start.getUTCSeconds(),
    start.getUTCMilliseconds(),
  ));
}

export type EmailTemplateMeta = {
  id: string;
  category: "security" | "trial" | "subscription" | "admin";
  triggerAr: string;
  triggerEn: string;
  subjectAr: string;
  subjectEn: string;
  summaryAr: string;
  summaryEn: string;
};

export const transactionalEmailCatalog: EmailTemplateMeta[] = [
  {
    id: "signup",
    category: "security",
    triggerAr: "بدء إنشاء حساب جديد عبر البريد الإلكتروني",
    triggerEn: "New account registration request",
    subjectAr: "واجهتي · أكمل إنشاء الحساب",
    subjectEn: "WAJHATI · Complete your registration",
    summaryAr: "يرسل رابط تحقق أحادي الاستخدام لإكمال التسجيل بأمان.",
    summaryEn: "Sends a single-use verification link to complete account registration.",
  },
  {
    id: "verify",
    category: "security",
    triggerAr: "طلب توثيق البريد الإلكتروني للحساب",
    triggerEn: "Account email verification request",
    subjectAr: "واجهتي · وثّق بريدك الإلكتروني",
    subjectEn: "WAJHATI · Verify your email",
    summaryAr: "يوثّق عنوان البريد الإلكتروني للتاجر لاستلام الإشعارات التشغيلية.",
    summaryEn: "Verifies the merchant email address for operational and billing notifications.",
  },
  {
    id: "reset",
    category: "security",
    triggerAr: "طلب استعادة كلمة المرور",
    triggerEn: "Password reset request",
    subjectAr: "واجهتي · أعد تعيين كلمة المرور",
    subjectEn: "WAJHATI · Reset your password",
    summaryAr: "يرسل رابطًا مؤقتًا (20 دقيقة) لإعادة تعيين كلمة المرور وإلغاء الجلسات السابقة.",
    summaryEn: "Sends a 20-minute single-use link to reset the password and revoke old sessions.",
  },
  {
    id: "change_email",
    category: "security",
    triggerAr: "طلب تغيير البريد الإلكتروني (تأكيد مزدوج)",
    triggerEn: "Dual-confirmation email change request",
    subjectAr: "واجهتي · وافق على تغيير بريدك / أكد بريدك الجديد",
    subjectEn: "WAJHATI · Authorize your email change / Confirm your new email",
    summaryAr: "يتطلب موافقة البريد الحالي والجديد قبل نقل ملكية الحساب.",
    summaryEn: "Requires confirmation from both old and new email addresses before switching.",
  },
  {
    id: "trial_started",
    category: "trial",
    triggerAr: "بدء التجربة المجانية (3 أيام / 72 ساعة) عند إنشاء الحساب والمتجر الأول",
    triggerEn: "3-day (72-hour) free trial started upon account & first store creation",
    subjectAr: "واجهتي · بدأت تجربة واجهتي لمدة 3 أيام من إنشاء حسابك",
    subjectEn: "WAJHATI · Your 3-day WAJHATI trial starts at account creation",
    summaryAr: "يوضح مدة التجربة (72 ساعة) ورابط الترقية المباشرة عبر واتساب في أي وقت.",
    summaryEn: "Confirms the 72-hour trial window and provides the WhatsApp activation link.",
  },
  {
    id: "billing_due",
    category: "subscription",
    triggerAr: "اقتراب انتهاء التجربة أو الاشتراك المدفوع (خلال 72 ساعة)",
    triggerEn: "Trial or paid subscription ending soon (within 72 hours)",
    subjectAr: "واجهتي · تذكير بتجديد الاشتراك عبر واتساب",
    subjectEn: "WAJHATI · Renew your subscription via WhatsApp",
    summaryAr: "ينبّه التاجر قبل انتهاء الصلاحية لتجديد اشتراك المتجر دون توقف.",
    summaryEn: "Reminds the merchant before expiration so they can renew via WhatsApp without interruption.",
  },
  {
    id: "subscription_active",
    category: "subscription",
    triggerAr: "تفعيل أو تجديد اشتراك متجر من لوحة الإدارة العليا (1 / 3 / 6 / 12 شهرًا)",
    triggerEn: "Store subscription activated or renewed by Super Admin (1 / 3 / 6 / 12 months)",
    subjectAr: "واجهتي · تم تفعيل اشتراك متجرك",
    subjectEn: "WAJHATI · Your store subscription is activated",
    summaryAr: "يؤكد تفعيل أو تمديد الاشتراك للمتجر المحدد مع رابط مراجعة حالة الاشتراك.",
    summaryEn: "Confirms store-specific subscription activation or renewal with direct dashboard link.",
  },
  {
    id: "subscription_expired",
    category: "subscription",
    triggerAr: "انتهاء التجربة المجانية أو الفترة المدفوعة للمتجر",
    triggerEn: "Free trial or paid subscription period expired",
    subjectAr: "واجهتي · انتهت مدة المتجر — تواصل معنا للتجديد",
    subjectEn: "WAJHATI · Your store access expired — contact us to renew",
    summaryAr: "يؤكد حفظ جميع المنتجات والتصاميم مع خطوات إعادة التفعيل عبر واتساب.",
    summaryEn: "Assures that all products and designs are preserved and explains how to renew via WhatsApp.",
  },
  {
    id: "review_pending",
    category: "admin",
    triggerAr: "إشعار تشغيلي لمراجعي المنصة عند وجود سجل بانتظار المراجعة",
    triggerEn: "Operational notice to platform reviewers when a record awaits review",
    subjectAr: "واجهتي · دفعة بانتظار المراجعة",
    subjectEn: "WAJHATI · Payment awaiting review",
    summaryAr: "ينبّه مراجعي المنصة المعتمدين دون تضمين أي بيانات سرية في البريد.",
    summaryEn: "Alerts authorized platform reviewers without exposing sensitive data in email.",
  },
];
