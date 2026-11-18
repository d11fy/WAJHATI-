import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locale } from "@/lib/i18n";
import { registrationAvailable } from "@/lib/billing";
import { copy } from "@/lib/copy";
import { recipientAllowed } from "@/lib/mail-guard";
import { defaultPlatformWhatsapp, formatWhatsappPhone } from "@/lib/platform-contact";
import type { IdentityPurpose } from "./identity";
import { contactSettings, mailSecret, mailView, recordMailTest } from "@/server/platform/contact";
import type { PlatformResult } from "@/server/platform/repository";
import { openSmtpPassword, smtpKeyReady, smtpOutcome, smtpTransport } from "./smtp";

function origin() {
  try {
    const value = new URL(process.env.APP_ORIGIN ?? "");
    if (value.username || value.password || value.pathname !== "/" || value.search || value.hash) return null;
    if (value.protocol === "https:" || registrationAvailable(value.origin, "true")) return value.origin;
    return null;
  } catch {
    return null;
  }
}

export async function mailProvider() {
  const site = origin();
  if (!site) return null;
  if (smtpKeyReady()) {
    try {
      const smtp = await mailSecret();
      if (smtp?.enabled) return smtp.verified_at ? "smtp" : null;
    } catch {
      return null;
    }
  }
  const fixture = process.env.DAR_ENV !== "production" &&
    (process.env.DAR_LOCAL_SIGNUP === "true" || process.env.DAR_STAGING_LOCAL === "true");
  if (process.env.MAIL_PROVIDER === "local" && registrationAvailable(site, String(fixture)) && process.env.DAR_MAIL_DIR) return "local";
  if (process.env.MAIL_PROVIDER === "resend" && process.env.RESEND_API_KEY && process.env.MAIL_FROM && site.startsWith("https://")) return "resend";
  return null;
}

export async function publicSignupEnabled() {
  if (process.env.PUBLIC_SIGNUP_ENABLED !== "true" || !process.env.TRUSTED_CLIENT_IP_HEADER) return false;
  const provider = await mailProvider();
  return provider === "resend" || provider === "smtp";
}

const subjects = {
  en: {
    signup: "Complete your registration",
    verify: "Verify your email",
    reset: "Reset your password",
    change_old: "Authorize your email change",
    change_new: "Confirm your new email",
  },
  ar: {
    signup: "أكمل إنشاء الحساب",
    verify: "وثّق بريدك الإلكتروني",
    reset: "أعد تعيين كلمة المرور",
    change_old: "وافق على تغيير بريدك",
    change_new: "أكد بريدك الجديد",
  },
};

type Mail = { to: string; purpose: string; subject: string; text: string; url: string; id?: string };

async function deliver(message: Mail): Promise<"sent" | "terminal" | "retry"> {
  const provider = await mailProvider();
  if (!provider) throw new Error("Mail is unavailable.");
  if (!recipientAllowed(message.to, provider)) {
    // Staging safety: never reach a recipient outside the allow-list. Terminal, so the queue does not retry.
    console.error(JSON.stringify({ event: "mail_recipient_blocked", purpose: message.purpose }));
    return "terminal";
  }
  if (provider === "smtp") {
    const smtp = await mailSecret();
    if (!smtp?.enabled || !smtp.verified_at) throw new Error("Mail is unavailable.");
    const transport = await smtpTransport(smtp.config, openSmtpPassword(smtp.cipher));
    try {
      const result = await transport.sendMail({
        from: { name: smtp.config.name, address: smtp.config.from },
        replyTo: smtp.config.replyTo || undefined,
        to: message.to,
        subject: message.subject,
        text: message.text,
        messageId: message.id ? `<wajhati-${message.id}@${smtp.config.from.split("@")[1]}>` : undefined,
      });
      return result.accepted.length ? "sent" : "terminal";
    } catch (error) {
      return smtpOutcome(error);
    } finally {
      transport.close();
    }
  }
  if (provider === "local") {
    const directory = process.env.DAR_MAIL_DIR!;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(join(directory, `${message.id ?? randomUUID()}.json`), JSON.stringify(message), { mode: 0o600, flag: "wx" });
    } catch (error) {
      if (!(message.id && typeof error === "object" && error && "code" in error && error.code === "EEXIST")) throw error;
    }
    return "sent";
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(6_000),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      ...(message.id ? { "Idempotency-Key": `dar-ops/${message.id}` } : {}),
    },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
  });
  await response.body?.cancel();
  if (response.ok) return "sent";
  return response.status >= 500 || [408, 409, 429].includes(response.status) ? "retry" : "terminal";
}

export async function sendIdentityMail(locale: Locale, to: string, purpose: IdentityPurpose, token: string) {
  const url = `${origin()}/${locale}/identity/${purpose}#token=${token}`;
  const subject = subjects[locale][purpose];
  const message = locale === "ar"
    ? "استخدم هذا الرابط مرة واحدة قبل انتهاء صلاحيته. تجاهل الرسالة إن لم تطلب هذا الإجراء."
    : "Use this link once before it expires. Ignore this message if you did not request this action.";
  if ((await deliver({ to, purpose, subject: `${copy[locale].brand} · ${subject}`, text: `${subject}\n\n${message}\n\n${url}`, url })) !== "sent") {
    throw new Error("Mail delivery failed.");
  }
}

export type OperationMailKind = "billing_due" | "review_pending" | "subscription_active" | "subscription_expired" | "trial_started";

export async function sendOperationsMail(locale: Locale, to: string, kind: OperationMailKind, id: string, slug: string | null) {
  if (!/^[a-f0-9-]{36}$/.test(id) || (kind !== "review_pending" && (!slug || !/^[a-z0-9-]{3,48}$/.test(slug)))) {
    throw new Error("Invalid operational message.");
  }
  const url = `${origin()}/${locale}/${kind !== "review_pending" ? `dashboard/stores/${slug}/billing` : "payment-review"}`;
  const contact = await contactSettings();
  const phone = formatWhatsappPhone(contact?.whatsapp ?? defaultPlatformWhatsapp);
  const titles = {
    ar: {
      billing_due: "تذكير بتجديد الاشتراك عبر واتساب",
      review_pending: "دفعة بانتظار المراجعة",
      subscription_active: "تم تفعيل اشتراك متجرك",
      subscription_expired: "انتهت مدة المتجر — تواصل معنا للتجديد",
      trial_started: "بدأت تجربة واجهتي لمدة 3 أيام من إنشاء حسابك",
    },
    en: {
      billing_due: "Renew your subscription via WhatsApp",
      review_pending: "Payment awaiting review",
      subscription_active: "Your store subscription is activated",
      subscription_expired: "Your store access expired — contact us to renew",
      trial_started: "Your 3-day WAJHATI trial starts at account creation",
    },
  };
  const bodies = {
    ar: {
      trial_started: `بدأت الفترة التجريبية المجانية لحسابك (72 ساعة) على متجرك (${slug}). يمكنك تفعيل الاشتراك المدفوع في أي وقت عبر التواصل مع واجهتي على واتساب (${phone}).`,
      billing_due: `تقترب فترة متجرك (${slug}) من الانتهاء خلال 72 ساعة. تواصل معنا عبر واتساب (${phone}) لتجديد الاشتراك دون توقف.`,
      subscription_active: `تم تفعيل أو تمديد الاشتراك المدفوع لمتجرك (${slug}) بنجاح. يمكنك مراجعة تفاصيل الباقة وتاريخ الانتهاء من لوحة التحكم.`,
      subscription_expired: `انتهت الفترة النشطة لمتجرك (${slug}). جميع منتجاتك وإعداداتك وتصاميمك محفوظة بالكامل — تواصل معنا عبر واتساب (${phone}) لإعادة التفعيل.`,
      review_pending: "يوجد سجل مالي بانتظار المراجعة في لوحة عمليات المنصة.",
    },
    en: {
      trial_started: `Your 3-day (72-hour) account trial is active on store (${slug}). You can activate a paid plan anytime via official WAJHATI WhatsApp (${phone}).`,
      billing_due: `Your store (${slug}) access period is ending within 72 hours. Contact us on WhatsApp (${phone}) to renew without interruption.`,
      subscription_active: `Your paid subscription for store (${slug}) has been activated. Sign in to view your active plan and expiration date.`,
      subscription_expired: `Your active period for store (${slug}) has ended. All products, configurations, and published designs are safely preserved — contact us via WhatsApp (${phone}) to renew.`,
      review_pending: "A payment record is awaiting review in the platform operations panel.",
    },
  };
  const subject = titles[locale][kind];
  const message = bodies[locale][kind];
  return deliver({ id, to, purpose: kind, subject: `${copy[locale].brand} · ${subject}`, text: `${subject}\n\n${message}\n\n${url}`, url });
}

export async function sendTestSmtpMail(token: string | undefined, locale: Locale, to: string): Promise<PlatformResult> {
  if (!smtpKeyReady()) return "unavailable";
  const view = await mailView(token);
  if (!view) return "denied";
  // The owner test send honours the staging allow-list too.
  if (!recipientAllowed(to, "smtp")) return "invalid";
  const smtp = await mailSecret();
  if (!smtp) return "invalid";
  let ok = false;
  try {
    const password = openSmtpPassword(smtp.cipher);
    const transport = await smtpTransport(smtp.config, password);
    try {
      await transport.verify();
      const subject = locale === "ar"
        ? "واجهتي · رسالة اختبار إعدادات البريد الإلكتروني (SMTP)"
        : "WAJHATI · Central SMTP Configuration Test";
      const text = locale === "ar"
        ? `تم التحقق من اتصال خادم البريد الإلكتروني (SMTP) لمنصة واجهتي بنجاح.\n\nالخادم: ${smtp.config.host}:${smtp.config.port}\nالمرسل: ${smtp.config.name} <${smtp.config.from}>`
        : `Your WAJHATI central SMTP configuration was verified successfully.\n\nHost: ${smtp.config.host}:${smtp.config.port}\nSender: ${smtp.config.name} <${smtp.config.from}>`;
      const result = await transport.sendMail({
        from: { name: smtp.config.name, address: smtp.config.from },
        replyTo: smtp.config.replyTo || undefined,
        to,
        subject,
        text,
      });
      ok = result.accepted.length > 0;
    } finally {
      transport.close();
    }
  } catch {
    ok = false;
  }
  const recorded = await recordMailTest(token, smtp.revision, ok);
  if (recorded !== "ok") return recorded;
  return ok ? "ok" : "invalid";
}
