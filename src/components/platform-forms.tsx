"use client";

import { useActionState, useState, type ReactNode } from "react";
import Link from "next/link";
import { formatPrice, type Currency } from "@/lib/catalog";
import { subscriptionLabels } from "@/lib/billing-copy";
import type { Subscription } from "@/lib/billing";
import { previewSubscriptionDates, subscriptionMonths } from "@/lib/platform-contact";
import { platformCopy } from "@/lib/platform-copy";
import type { Locale } from "@/lib/i18n";
import { currencies } from "@/lib/validation";
import {
  confirmManualSubscriptionAction,
  manualSubscriptionAction,
  mfaAction,
  smtpSaveAction,
  smtpTestAction,
  type AdminState,
} from "@/server/platform/actions";
import type { MailView } from "@/server/platform/contact";

export type ManualTermRecord = {
  id: string;
  plan: "starter" | "pro";
  months: number;
  amount?: number;
  amountMinor?: number;
  currency: Currency;
  reference: string;
  note: string;
  actor: string;
  reviewer?: string | null;
  approvedBy?: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
};

export type ManagedStoreRecord = {
  id: string;
  name: string;
  slug: string;
  country: string;
  currency: Currency;
  published: boolean;
  suspended: boolean;
  hold: boolean;
  state: Subscription;
  manual: ManualTermRecord[];
};

function formatUtc(locale: Locale, value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return `${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(parsed)} UTC`;
}

function formatTrialRemaining(locale: Locale, trialEndsAt: string | null | undefined) {
  if (!trialEndsAt) return locale === "ar" ? "غير متاحة" : "Not granted";
  const endMs = new Date(trialEndsAt).getTime();
  if (Number.isNaN(endMs)) return "—";
  const diffMs = endMs - Date.now();
  if (diffMs <= 0) return `${locale === "ar" ? "منتهية منذ" : "Ended"} (${formatUtc(locale, trialEndsAt)})`;
  const hours = Math.ceil(diffMs / 3_600_000);
  return locale === "ar"
    ? `متبقٍ حوالي ${hours} ساعة (حتى ${formatUtc(locale, trialEndsAt)})`
    : `${hours}h remaining (until ${formatUtc(locale, trialEndsAt)})`;
}

export function MfaForm({ locale, enrolled, target }: { locale: Locale; enrolled: boolean; target: string }) {
  const t = platformCopy[locale];
  const [state, action, busy] = useActionState(mfaAction.bind(null, locale), null);
  const [mode, setMode] = useState<"verify" | "enroll" | "recover">(enrolled ? "verify" : "enroll");
  const step = state?.seed ? "verify" : mode;
  return <section className="panel grid gap-4 p-5 sm:p-7">
    <h1 className="text-3xl font-black">{t.mfa}</h1>
    {state?.ok ? <>
      <p role="status" className="font-bold text-brand">{t.verified}</p>
      {state.recovery && <div className="rounded-xl bg-leaf p-4"><p className="mb-3 text-sm font-bold">{t.codes}</p>
        <ul className="grid gap-2 font-mono text-sm" dir="ltr">{state.recovery.map((code) => <li className="break-all" key={code}>{code}</li>)}</ul></div>}
      <Link className="button button-primary w-fit" href={target}>{t.continue}</Link>
    </> : <>
      {state?.seed && <div className="rounded-xl bg-leaf p-4"><p className="text-sm">{t.seed}</p>
        <code className="mt-2 block break-all font-bold" dir="ltr">{state.seed}</code></div>}
      <form action={action} className="grid gap-3">
        <input type="hidden" name="mode" value={step} />
        {step !== "verify" && <label className="field">{t.password}<input className="control" type="password" name="password" autoComplete="current-password" required /></label>}
        <label className="field">{step === "verify" ? t.code : step === "enroll" ? t.enrollment : t.recovery}
          <input key={step} className="control" name="code" type={step === "verify" ? "text" : "password"} dir="ltr"
            inputMode={step === "verify" ? "numeric" : "text"} autoComplete={step === "verify" ? "one-time-code" : "off"} maxLength={step === "verify" ? 6 : 43} required />
        </label>
        {state?.error && <p role="alert" className="text-sm font-bold text-red-800">{t[state.error]}</p>}
        <button className="button button-primary justify-self-start" disabled={busy}>{busy ? t.wait : t[step]}</button>
      </form>
      {enrolled && !state?.seed && <button type="button" className="button button-secondary justify-self-start"
        onClick={() => setMode(mode === "recover" ? "verify" : "recover")}>{mode === "recover" ? t.verify : t.recover}</button>}
    </>}
  </section>;
}

export function AdminMutation({ locale, submitAction, button, confirmLabel, children }: {
  locale: Locale;
  submitAction: (state: AdminState, form: FormData) => Promise<AdminState>;
  button: string;
  confirmLabel?: string;
  children: ReactNode;
}) {
  const [state, action, busy] = useActionState(submitAction, null);
  const t = platformCopy[locale];
  return <form action={action} className="grid gap-3">
    {children}
    <label className="flex items-center gap-2 text-sm font-semibold"><input className="accent-brand" type="checkbox" name="confirm" required />{confirmLabel ?? t.confirm}</label>
    {state && <p className={`text-sm font-bold ${state === "ok" ? "text-brand" : "text-red-800"}`} role={state === "ok" ? "status" : "alert"}>{t[state]}</p>}
    <button className="button button-primary w-fit" disabled={busy}>{busy ? t.wait : button}</button>
  </form>;
}

function SecondReviewerConfirmForm({ locale, id }: { locale: Locale; id: string }) {
  const t = platformCopy[locale];
  const [state, action, busy] = useActionState(confirmManualSubscriptionAction.bind(null, locale, id), null);
  return <form action={action} className="mt-2 grid gap-2 rounded-lg border border-line bg-surface p-3">
    <label className="flex items-center gap-2 text-xs font-semibold">
      <input className="accent-brand" type="checkbox" name="confirm" required />
      {t.confirmSecondCheck}
    </label>
    {state && <p className={`text-xs font-bold ${state === "ok" ? "text-brand" : "text-red-800"}`} role={state === "ok" ? "status" : "alert"}>{t[state]}</p>}
    <button className="button button-secondary w-fit text-xs" disabled={busy}>{busy ? t.wait : t.confirmSecondAdmin}</button>
  </form>;
}

export function ManualSubscriptionForm({
  locale,
  merchantId,
  merchantEmail,
  stores,
  trialEndsAt,
  canActivate,
  actorId,
  initialStoreId,
}: {
  locale: Locale;
  merchantId: string;
  merchantEmail: string;
  stores: ManagedStoreRecord[];
  trialEndsAt: string | null;
  canActivate: boolean;
  actorId: string;
  initialStoreId?: string;
}) {
  const t = platformCopy[locale];
  const [state, action, busy] = useActionState(manualSubscriptionAction.bind(null, locale), null);
  const [selectedStoreId, setSelectedStoreId] = useState<string>(initialStoreId ?? stores[0]?.id ?? "");
  const selectedStore = stores.find((item) => item.id === selectedStoreId) ?? stores[0];
  const [plan, setPlan] = useState<"starter" | "pro">(selectedStore?.state.plan === "starter" ? "starter" : "pro");
  const [months, setMonths] = useState<(typeof subscriptionMonths)[number]>(1);
  const [currency, setCurrency] = useState<Currency>(selectedStore?.currency ?? "ILS");

  if (!selectedStore) {
    return <p className="rounded-xl border border-line p-4 text-sm text-muted">{t.noOwnedStores}</p>;
  }

  const paidExpiration =
    selectedStore.state.paidUntil ??
    (selectedStore.state.status === "active" || selectedStore.state.status === "grace_period" ? selectedStore.state.periodEnd : null);
  const effectiveTrialEnd = trialEndsAt ?? selectedStore.state.accountTrialEnd ?? (selectedStore.state.status === "trialing" ? selectedStore.state.periodEnd : null);
  const preview = previewSubscriptionDates(paidExpiration, months);
  const manualHistory = selectedStore.manual ?? [];

  const durationLabels: Record<(typeof subscriptionMonths)[number], string> = {
    1: t.months1,
    3: t.months3,
    6: t.months6,
    12: t.months12,
  };

  return <div className="grid gap-4 rounded-xl border border-line bg-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
      <div>
        <h3 className="text-base font-black">{t.activationTitle}</h3>
        <p className="text-xs text-muted"><bdi>{merchantEmail}</bdi></p>
      </div>
      <span className="tag"><bdi>{selectedStore.slug}</bdi></span>
    </div>

    <dl className="grid grid-cols-1 gap-3 rounded-xl bg-leaf p-3 text-xs sm:grid-cols-3">
      <div>
        <dt className="font-semibold text-muted">{t.currentPlan}</dt>
        <dd className="mt-1 font-black">
          {selectedStore.state.legacy ? t.legacy : subscriptionLabels[locale][selectedStore.state.status]}{" "}
          {selectedStore.state.plan ? `(${selectedStore.state.plan.toUpperCase()})` : ""}
        </dd>
      </div>
      <div>
        <dt className="font-semibold text-muted">{t.trialRemaining}</dt>
        <dd className="mt-1 font-bold">{formatTrialRemaining(locale, effectiveTrialEnd)}</dd>
      </div>
      <div>
        <dt className="font-semibold text-muted">{t.currentPaidEnd}</dt>
        <dd className="mt-1 font-bold"><bdi>{formatUtc(locale, paidExpiration)}</bdi></dd>
      </div>
    </dl>

    {canActivate && <form action={action} className="grid gap-3">
      <input type="hidden" name="user" value={merchantId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="field">
          {t.selectStore}
          <select
            className="control"
            name="store"
            value={selectedStore.id}
            onChange={(event) => {
              const nextStore = stores.find((item) => item.id === event.target.value);
              setSelectedStoreId(event.target.value);
              if (nextStore) {
                setCurrency(nextStore.currency);
                if (nextStore.state.plan === "starter" || nextStore.state.plan === "pro") setPlan(nextStore.state.plan);
              }
            }}
          >
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name} ({store.slug})</option>)}
          </select>
        </label>
        <label className="field">
          {t.plan}
          <select className="control" name="plan" value={plan} onChange={(event) => setPlan(event.target.value === "starter" ? "starter" : "pro")}>
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
          </select>
        </label>
        <label className="field">
          {t.durationMonths}
          <select className="control" name="months" value={String(months)} onChange={(event) => setMonths(Number(event.target.value) as (typeof subscriptionMonths)[number])}>
            {subscriptionMonths.map((item) => <option key={item} value={String(item)}>{durationLabels[item]}</option>)}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="field">
          {t.receivedAmount}
          <input className="control" name="amount" dir="ltr" inputMode="decimal" required defaultValue="100.00" />
        </label>
        <label className="field">
          {t.currency}
          <select className="control" name="currency" value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}>
            {currencies.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="field">
          {t.paymentReference}
          <input className="control" name="reference" dir="ltr" required minLength={3} maxLength={120} placeholder="WA-2026-0001" />
        </label>
      </div>

      <label className="field">
        {t.adminNote}
        <input className="control" name="note" maxLength={500} placeholder={locale === "ar" ? "تفعيل اشتراك المتجر بعد تأكيد الحوالة عبر واتساب" : "Activated after external WhatsApp payment confirmation"} />
      </label>

      <div className="rounded-xl border border-line bg-leaf p-3 text-xs">
        <p className="font-black text-brand">{t.previewDates}</p>
        <p className="mt-1 font-semibold">{preview.appendsToActive ? t.modeAppend : t.modeImmediate}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <p><span className="text-muted">{t.effectiveStart}:</span> <strong dir="ltr">{formatUtc(locale, preview.startsAt)}</strong></p>
          <p><span className="text-muted">{t.effectiveEnd}:</span> <strong dir="ltr">{formatUtc(locale, preview.endsAt)}</strong></p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm font-semibold">
        <input className="accent-brand" type="checkbox" name="confirm" required />
        {t.confirmActivation}
      </label>
      {state && <p className={`text-sm font-bold ${state === "ok" ? "text-brand" : "text-red-800"}`} role={state === "ok" ? "status" : "alert"}>{t[state]}</p>}
      <button className="button button-primary w-fit" disabled={busy}>{busy ? t.wait : t.activateStore}</button>
    </form>}

    <div className="grid gap-2 border-t border-line pt-3">
      <h4 className="text-sm font-black">{t.manualHistoryTitle}</h4>
      {!manualHistory.length ? <p className="text-xs text-muted">{t.empty}</p> : <ul className="grid gap-2 text-xs">
        {manualHistory.map((item) => <li key={item.id} className="rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold">
              {item.plan.toUpperCase()} · {item.months} {locale === "ar" ? "أشهر" : "mo"} · <bdi>{formatPrice(item.amount ?? item.amountMinor ?? 0, item.currency ?? "ILS", locale)}</bdi> · <bdi>{item.reference}</bdi>
            </span>
            <span className="tag">{item.endsAt ? t.active : t.dualPending}</span>
          </div>
          <p className="mt-1 text-muted">
            {item.startsAt && item.endsAt
              ? <bdi>{formatUtc(locale, item.startsAt)} → {formatUtc(locale, item.endsAt)}</bdi>
              : <bdi>{formatUtc(locale, item.createdAt)}</bdi>}
          </p>
          {item.note && <p className="mt-1"><bdi>{item.note}</bdi></p>}
          {!item.endsAt && canActivate && item.actor !== actorId && <SecondReviewerConfirmForm locale={locale} id={item.id} />}
        </li>)}
      </ul>}
    </div>
  </div>;
}

export function SmtpSettingsForm({
  locale,
  mail,
  canEdit,
  defaultRecipient,
}: {
  locale: Locale;
  mail: MailView | null;
  canEdit: boolean;
  defaultRecipient: string;
}) {
  const t = platformCopy[locale];
  const [saveState, saveFormAction, saveBusy] = useActionState(smtpSaveAction.bind(null, locale), null);
  const [testState, testFormAction, testBusy] = useActionState(smtpTestAction.bind(null, locale), null);

  return <div className="grid gap-5">
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-leaf p-4 text-sm">
      <div>
        <p className="font-black">{t.smtpStatus}</p>
        <p className="text-xs text-muted">
          {mail?.verifiedAt ? `${t.smtpVerifiedAt}: ${formatUtc(locale, mail.verifiedAt)}` : t.smtpNotVerified}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="tag">{mail?.enabled ? t.active : t.inactive}</span>
        {mail?.hasPassword && <span className="tag">AES-256-GCM</span>}
      </div>
    </div>

    {canEdit && <>
      <form action={saveFormAction} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            {t.smtpHost}
            <input className="control" name="host" dir="ltr" required defaultValue={mail?.config?.host ?? ""} placeholder="smtp.example.com" />
          </label>
          <label className="field">
            {t.smtpPortMode}
            <select className="control" name="port" defaultValue={String(mail?.config?.port ?? 587)}>
              <option value="587">587 — STARTTLS</option>
              <option value="465">465 — SSL/TLS</option>
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            {t.smtpUser}
            <input className="control" name="user" dir="ltr" required defaultValue={mail?.config?.user ?? ""} placeholder="mailer@example.com" />
          </label>
          <label className="field">
            {t.smtpPassword}
            <input
              className="control"
              name="password"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              required={!mail?.hasPassword}
              placeholder={mail?.hasPassword ? t.smtpPasswordSaved : ""}
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="field">
            {t.smtpFromEmail}
            <input className="control" name="fromEmail" type="email" dir="ltr" required defaultValue={mail?.config?.from ?? ""} placeholder="no-reply@example.com" />
          </label>
          <label className="field">
            {t.smtpFromName}
            <input className="control" name="fromName" required maxLength={120} defaultValue={mail?.config?.name ?? (locale === "ar" ? "واجهتي | WAJHATI" : "WAJHATI")} />
          </label>
          <label className="field">
            {t.smtpReplyTo}
            <input className="control" name="replyTo" type="email" dir="ltr" defaultValue={mail?.config?.replyTo ?? ""} placeholder="support@example.com" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input className="accent-brand" type="checkbox" name="enabled" defaultChecked={mail?.enabled ?? false} />
          {t.smtpEnabled}
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input className="accent-brand" type="checkbox" name="confirm" required />
          {t.confirmSmtp}
        </label>
        {saveState && <p className={`text-sm font-bold ${saveState === "ok" ? "text-brand" : "text-red-800"}`} role={saveState === "ok" ? "status" : "alert"}>{t[saveState]}</p>}
        <button className="button button-primary w-fit" disabled={saveBusy}>{saveBusy ? t.wait : t.saveSmtp}</button>
      </form>

      <form action={testFormAction} className="grid gap-3 border-t border-line pt-4">
        <h3 className="text-base font-black">{t.smtpTestTitle}</h3>
        <label className="field">
          {t.smtpTestRecipient}
          <input className="control" name="to" type="email" dir="ltr" required defaultValue={defaultRecipient} />
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input className="accent-brand" type="checkbox" name="confirm" required />
          {t.confirmSmtpTest}
        </label>
        {testState && <p className={`text-sm font-bold ${testState === "ok" ? "text-brand" : "text-red-800"}`} role={testState === "ok" ? "status" : "alert"}>{t[testState]}</p>}
        <button className="button button-secondary w-fit" disabled={testBusy}>{testBusy ? t.wait : t.sendTestEmail}</button>
      </form>
    </>}
  </div>;
}
