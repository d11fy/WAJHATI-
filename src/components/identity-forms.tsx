"use client";

import { useActionState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { changeEmail, confirmIdentity, requestIdentity, type IdentityState } from "@/server/auth/identity-actions";
import type { IdentityPurpose } from "@/server/auth/identity";

const copy = {
  en: { email: "Email address", newEmail: "New email address", password: "Password", newPassword: "New password", name: "Name",
    signup: "Create a verified account", reset: "Reset password", verify: "Verify email", change_old: "Authorize email change",
    change_new: "Confirm new email", change: "Change email address", send: "Send a link", confirm: "Confirm", wait: "Working…",
    signIn: "Sign in", sent: "If the request is eligible, a link will arrive by email. An email change requires confirmation from both addresses.",
    ok: "Confirmed. Sign in again if your credentials changed.", pending: "Confirmed. Open the link at the other address to finish.",
    invalid: "This request or link is invalid, expired or already used.", unavailable: "This action is temporarily unavailable." },
  ar: { email: "البريد الإلكتروني", newEmail: "البريد الإلكتروني الجديد", password: "كلمة المرور", newPassword: "كلمة المرور الجديدة", name: "الاسم",
    signup: "إنشاء حساب موثّق", reset: "استعادة كلمة المرور", verify: "توثيق البريد", change_old: "الموافقة على تغيير البريد",
    change_new: "تأكيد البريد الجديد", change: "تغيير البريد الإلكتروني", send: "إرسال الرابط", confirm: "تأكيد", wait: "جارٍ التنفيذ…",
    signIn: "تسجيل الدخول", sent: "إذا كان الطلب مؤهّلًا فسيصل رابط إلى البريد. يتطلب تغيير البريد التأكيد من العنوانين.",
    ok: "تم التأكيد. سجّل الدخول مجددًا إذا تغيرت بيانات الدخول.", pending: "تم التأكيد. افتح الرابط في العنوان الآخر لإتمام التغيير.",
    invalid: "الطلب أو الرابط غير صالح أو منتهي أو استُخدم مسبقًا.", unavailable: "هذا الإجراء غير متاح مؤقتًا." },
};
const listen = () => () => {};
const getToken = () => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
const serverToken = () => "";

function Notice({ locale, state }: { locale: Locale; state: IdentityState }) {
  return state && <p role={state === "invalid" || state === "unavailable" ? "alert" : "status"} className="text-sm font-semibold">{copy[locale][state]}</p>;
}

export function IdentityRequest({ locale, purpose, children }: { locale: Locale; purpose: "signup" | "reset" | "verify"; children?: ReactNode }) {
  const t = copy[locale];
  const [state, action, busy] = useActionState(requestIdentity.bind(null, locale, purpose), null);
  return <section className="panel grid gap-4 p-5 sm:p-7"><h1 className="text-2xl font-black">{t[purpose]}</h1>
    {children}
    <form action={action} className="grid gap-3">
      {purpose !== "verify" && <label className="field">{t.email}<input className="control" type="email" name="email" maxLength={254} required autoComplete="email" dir="ltr" /></label>}
      <Notice locale={locale} state={state} />
      <button className="button button-primary justify-self-start" disabled={busy}>{busy ? t.wait : t.send}</button>
    </form>
  </section>;
}

export function IdentityConfirm({ locale, purpose, children }: { locale: Locale; purpose: IdentityPurpose; children?: ReactNode }) {
  const t = copy[locale];
  const token = useSyncExternalStore(listen, getToken, serverToken);
  const [state, action, busy] = useActionState(confirmIdentity.bind(null, locale, purpose), null);
  return <section className="panel grid gap-4 p-5 sm:p-7"><h1 className="text-2xl font-black">{t[purpose]}</h1>
    {children}
    {state !== "ok" && state !== "pending" && <form action={action} className="grid gap-3">
      <input type="hidden" name="token" value={token} />
      {purpose === "signup" && <label className="field">{t.name}<input className="control" name="name" required autoComplete="name" maxLength={80} /></label>}
      {(purpose === "signup" || purpose === "reset") && <label className="field">{t.newPassword}<input className="control" type="password" name="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>}
      <button className="button button-primary justify-self-start" disabled={busy || !token}>{busy ? t.wait : t.confirm}</button>
    </form>}
    <Notice locale={locale} state={state} />
    {(state === "ok" || state === "pending") && <Link className="button button-secondary w-fit" href={`/${locale}/sign-in`}>{t.signIn}</Link>}
  </section>;
}

export function EmailChange({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const [state, action, busy] = useActionState(changeEmail.bind(null, locale), null);
  return <section className="panel grid gap-4 p-5 sm:p-7"><h2 className="text-2xl font-black">{t.change}</h2>
    <form action={action} className="grid gap-3">
      <label className="field">{t.newEmail}<input className="control" type="email" name="email" required maxLength={254} autoComplete="email" dir="ltr" /></label>
      <label className="field">{t.password}<input className="control" type="password" name="password" required minLength={12} maxLength={128} autoComplete="current-password" /></label>
      <Notice locale={locale} state={state} />
      <button className="button button-primary justify-self-start" disabled={busy}>{busy ? t.wait : t.send}</button>
    </form>
  </section>;
}
