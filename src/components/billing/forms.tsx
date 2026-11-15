"use client";

import { useActionState, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { BillingOptions, PlanCode, ReviewRow } from "@/lib/billing";
import { billingCopy, billingPlans } from "@/lib/billing-copy";
import { formatPrice, priceInput, type Currency } from "@/lib/catalog";
import type { Locale } from "@/lib/i18n";
import { formatWhatsappPhone, subscriptionContact } from "@/lib/platform-contact";
import { requestPaymentAction, reviewPaymentAction, subscriptionAction, type BillingActionState } from "@/server/billing/actions";

function Feedback({ state, locale }: { state: BillingActionState; locale: Locale }) {
  if (!state) return null;
  const t = billingCopy[locale];
  return "error" in state ? <p role="alert" className="text-sm font-bold text-red-800">{t.errors[state.error]}</p>
    : <p role="status" className="text-sm font-bold text-brand">{state.pendingReview ? t.secondReview : t.saved}</p>;
}

export function PlanSelector({ locale, slug, requestKey, options, initialCountry, locked }: {
  locale: Locale; slug: string; requestKey: string; options: BillingOptions; initialCountry: string; locked: boolean;
}) {
  const t = billingCopy[locale];
  const regions = new Intl.DisplayNames(locale, { type: "region" });
  const countries = [...new Set(options.prices.map(({ country }) => country))];
  const [country, setCountry] = useState(countries.find((candidate) => candidate === initialCountry) ?? countries[0]);
  const [selectedPrice, setPrice] = useState("");
  const [selectedMethod, setMethod] = useState("");
  const [selectedSetup, setSetup] = useState("");
  const prices = options.prices.filter((item) => item.country === country);
  const price = prices.find((item) => item.id === selectedPrice) ?? prices[0];
  const methods = options.methods.filter((item) => item.country === country && item.currency === price?.currency);
  const method = methods.find((item) => item.id === selectedMethod) ?? methods[0];
  const setups = options.packages.filter((item) => item.country === country && item.currency === price?.currency);
  const setup = setups.find((item) => item.id === selectedSetup);
  const [state, submit, busy] = useActionState(requestPaymentAction.bind(null, locale, slug), null);
  if (!price || !method) return <p className="text-sm text-muted">{t.noPlans}</p>;
  if (locked || (state && "ok" in state)) return <p role="status" className="text-sm text-muted">{t.pendingRequest}</p>;
  const expected = price.amount + (setup?.amount ?? 0);
  const plans = [...new Set(prices.map((item) => item.plan))].map((plan) =>
    prices.find((item) => item.plan === plan && item.interval === price.interval && item.currency === price.currency) ?? prices.find((item) => item.plan === plan)!,
  );
  return <form action={submit} className="grid gap-4">
    <input type="hidden" name="key" value={requestKey} /><input type="hidden" name="expected" value={expected} />
    <div className="wajhati-billing-plans">
      {plans.map((item) => <button key={item.plan} type="button" aria-pressed={item.plan === price.plan}
        className={`wajhati-billing-plan${item.plan === "pro" ? " wajhati-billing-plan-pro" : ""}`}
        onClick={() => { setPrice(item.id); setMethod(""); setSetup(""); }}>
        <strong>{billingPlans[locale][item.plan]}</strong><span><bdi>{formatPrice(item.amount, item.currency, locale)}</bdi> · {t[item.interval]}</span>
        <span>{new Intl.NumberFormat(locale).format(item.maxProducts)} {locale === "ar" ? "منتجًا" : "products"}</span>
      </button>)}
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="field">{t.country}<select className="control" value={country} onChange={(event) => {
        setCountry(event.target.value as typeof country); setPrice(""); setMethod(""); setSetup("");
      }}>{countries.map((item) => <option key={item} value={item}>{regions.of(item)}</option>)}</select></label>
      <label className="field">{t.plan}<select className="control" name="price" value={price.id} onChange={(event) => {
        setPrice(event.target.value); setMethod(""); setSetup("");
      }}>{prices.map((item) => <option key={item.id} value={item.id}>{billingPlans[locale][item.plan]} · {t[item.interval]} · {formatPrice(item.amount, item.currency, locale)} · {t.version} {item.version}</option>)}</select></label>
      <label className="field">{t.method}<select className="control" name="method" value={method.id} onChange={(event) => setMethod(event.target.value)}>
        {methods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      {setups.length > 0 && <label className="field">{t.setup}<select className="control" name="setup" value={setup?.id ?? ""} onChange={(event) => setSetup(event.target.value)}>
        <option value="">{t.noSetup}</option>
        {setups.map((item) => <option key={item.id} value={item.id}>{item.label} · {formatPrice(item.amount, item.currency, locale)}</option>)}
      </select></label>}
    </div>
    {setup && <label className="field">{t.notes}<textarea className="control" name="notes" maxLength={1600} rows={3} /></label>}
    <details className="rounded-xl border border-line p-3 text-sm">
      <summary className="cursor-pointer font-bold">{t.instructions}</summary>
      <p className="mt-2 wrap-anywhere whitespace-pre-wrap" dir="auto">{method.instructions}</p>
      <p className="mt-2 text-muted">{t.waitForReference}</p>
    </details>
    <dl className="grid gap-2 rounded-xl bg-leaf/60 p-4 text-sm">
      <div className="flex justify-between gap-3"><dt>{t.planLine}</dt><dd><bdi>{formatPrice(price.amount, price.currency, locale)}</bdi></dd></div>
      {setup && <div className="flex justify-between gap-3"><dt>{t.setupLine}</dt><dd><bdi>{formatPrice(setup.amount, price.currency, locale)}</bdi></dd></div>}
      <div className="flex justify-between gap-3 border-t border-line pt-2 font-black"><dt>{t.total}</dt><dd><bdi>{formatPrice(expected, price.currency, locale)}</bdi></dd></div>
    </dl>
    <Feedback locale={locale} state={state} />
    <button className="button button-primary justify-self-start" disabled={busy}>{busy ? t.progress : t.request}</button>
  </form>;
}

export function WhatsAppSubscriptionCard({
  locale,
  whatsapp,
  storeName,
  userEmail,
  currentPlan,
  isActive,
  prices,
}: {
  locale: Locale;
  whatsapp: string;
  storeName: string;
  userEmail: string;
  currentPlan: PlanCode | null;
  isActive: boolean;
  prices: Array<{ plan: PlanCode; interval: "monthly" | "yearly"; amount: number; currency: Currency; maxProducts: number }>;
}) {
  const t = billingCopy[locale];
  const [plan, setPlan] = useState<PlanCode>(currentPlan ?? "pro");
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");
  const numbers = new Intl.NumberFormat(locale);
  const activateHref = subscriptionContact(whatsapp, locale, { store: storeName, email: userEmail, plan, interval, mode: "activate" }) ?? "#";
  const renewHref = subscriptionContact(whatsapp, locale, { store: storeName, email: userEmail, plan, interval, mode: "renew" }) ?? "#";
  const formattedPhone = formatWhatsappPhone(whatsapp);

  const planCards: Array<{ code: PlanCode; fallbackMonthly: number; fallbackYearly: number; currency: Currency; maxProducts: number; storageGiB: string }> = [
    { code: "starter", fallbackMonthly: 3500, fallbackYearly: 24500, currency: "ILS", maxProducts: 30, storageGiB: "1.5 GiB" },
    { code: "pro", fallbackMonthly: 3500, fallbackYearly: 24500, currency: "ILS", maxProducts: 200, storageGiB: "12 GiB" },
  ];

  return <div className="grid gap-4" data-testid="whatsapp-subscription-card">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-leaf/60 p-4 text-sm">
      <div>
        <p className="font-bold text-ink">{t.whatsappNumberLabel}: <bdi dir="ltr">{formattedPhone}</bdi></p>
        <p className="mt-1 text-muted">{t.perStoreNotice}</p>
      </div>
      <div className="inline-flex rounded-xl border border-line bg-surface p-1" role="group" aria-label={t.plan}>
        {(["monthly", "yearly"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={interval === item}
            onClick={() => setInterval(item)}
            className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${interval === item ? "bg-brand text-white" : "text-ink"}`}
          >
            {t[item]}
          </button>
        ))}
      </div>
    </div>

    <div className="wajhati-billing-plans">
      {planCards.map((item) => {
        const match = prices.find((candidate) => candidate.plan === item.code && candidate.interval === interval);
        const amount = match?.amount ?? (interval === "monthly" ? item.fallbackMonthly : item.fallbackYearly);
        const currency = match?.currency ?? item.currency;
        const maxProducts = match?.maxProducts ?? item.maxProducts;
        return (
          <button
            key={item.code}
            type="button"
            aria-pressed={plan === item.code}
            onClick={() => setPlan(item.code)}
            className={`wajhati-billing-plan${item.code === "pro" ? " wajhati-billing-plan-pro" : ""}`}
          >
            <strong>{billingPlans[locale][item.code]} ({item.code === "starter" ? "Starter" : "Pro"})</strong>
            <span><bdi>{formatPrice(amount, currency, locale)}</bdi> · {t[interval]}</span>
            <span>{numbers.format(maxProducts)} {locale === "ar" ? "منتجًا" : "products"} · <bdi>{item.storageGiB}</bdi></span>
          </button>
        );
      })}
    </div>

    <div className="grid gap-2 rounded-xl border border-line p-4 text-sm text-muted">
      <p>{t.trialRuleNotice}</p>
      <p>{t.manualActivationNotice}</p>
    </div>

    <div className="flex flex-wrap items-center gap-3">
      <a
        href={isActive ? renewHref : activateHref}
        target="_blank"
        rel="noopener noreferrer"
        className="button button-primary"
      >
        {isActive ? t.contactRenew : t.contactActivate}
      </a>
      <a
        href={isActive ? activateHref : renewHref}
        target="_blank"
        rel="noopener noreferrer"
        className="button button-secondary"
      >
        {isActive ? t.contactActivate : t.contactRenew}
      </a>
    </div>
  </div>;
}

export function SubscriptionControl({ locale, slug, operation }: { locale: Locale; slug: string; operation: "trial" | "cancel" | "keep" }) {
  const t = billingCopy[locale];
  const [state, action, busy] = useActionState(subscriptionAction.bind(null, locale, slug, operation), null);
  return <form action={action} className="grid gap-2">
    {operation === "cancel" && <label className="flex items-start gap-2 text-sm"><input className="mt-1 accent-brand" type="checkbox" name="confirm" required />{t.cancelHelp}</label>}
    <Feedback locale={locale} state={state} />
    <button className="button button-secondary justify-self-start" disabled={busy}>{busy ? t.progress : operation === "trial" ? t.startTrial : operation === "cancel" ? t.cancel : t.undoCancel}</button>
  </form>;
}

export function ProofForm({ locale, slug, id }: { locale: Locale; slug: string; id: string }) {
  const t = billingCopy[locale];
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [fileName, setFileName] = useState("");
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const proof = fields.get("proof");
    if (!(proof instanceof File) || !proof.size) { setStatus(t.invalidProof); return; }
    if (proof.size > 5 * 1024 * 1024) { setStatus(t.tooLarge); return; }
    setBusy(true); setStatus("");
    try {
      const response = await fetch(`/api/billing/${slug}/${id}/proof`, {
        method: "POST", body: proof, headers: { "Content-Type": proof.type, "x-payment-reference": encodeURIComponent(String(fields.get("transfer"))) },
      });
      const { code } = await response.json() as { code: string };
      if (response.ok) { setSuccess(true); setStatus(t.proofSaved); router.refresh(); }
      else setStatus(code === "invalidProof" ? t.invalidProof : code === "tooLarge" ? t.tooLarge : code === "rateLimit" ? t.rateLimit
        : code === "duplicate" ? t.errors.duplicate : code === "invalid" ? t.errors.invalid : code === "closed" ? t.errors.closed : t.errors.unavailable);
    } catch { setStatus(t.errors.unavailable); }
    finally { setBusy(false); }
  }
  return <form onSubmit={upload} className="grid gap-3 border-t border-line pt-3">
    <label className="field">{t.transfer}<input name="transfer" className="control" dir="auto" required minLength={3} maxLength={100} /></label>
    <label className="field">{t.proof}
      <span className="control wajhati-billing-proof flex cursor-pointer flex-wrap items-center gap-3 focus-within:outline-2 focus-within:outline-brand">
        <span className="font-bold text-brand">{t.chooseFile}</span>
        <bdi className="wrap-anywhere text-sm text-muted" aria-live="polite">{fileName || t.noFile}</bdi>
        <input className="sr-only" name="proof" type="file" accept="image/png,image/jpeg,image/webp,application/pdf"
          required onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")} />
      </span>
    </label>
    <p className="text-sm text-muted">{t.proofHelp}</p>
    {status && <p role={success ? "status" : "alert"} className="text-sm font-bold">{status}</p>}
    <button className="button button-secondary justify-self-start" disabled={busy || success}>{busy ? t.uploading : t.upload}</button>
  </form>;
}

export function ReviewControls({ locale, payment, maySecond }: { locale: Locale; payment: ReviewRow; maySecond: boolean }) {
  const t = billingCopy[locale];
  const [state, action, busy] = useActionState(reviewPaymentAction.bind(null, locale, payment.id), null);
  if (!payment.mayReview) return <p className="text-sm text-muted">{t.selfReview}</p>;
  const reviewable = payment.status === "submitted" || payment.status === "under_review";
  return <div className="grid gap-4">
    <Feedback locale={locale} state={state} />
    {payment.status === "submitted" && <form action={action}>
      <button className="button button-secondary" name="operation" value="review" disabled={busy}>{t.reviewStart}</button>
    </form>}
    {reviewable && <>
      {maySecond && <form action={action} className="panel grid gap-3 p-4">
        <p className="text-sm text-muted">{t.reviewHelp}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">{t.total}<input name="amount" className="control" inputMode="decimal" dir="ltr" required placeholder={priceInput(payment.planMinor + payment.setupMinor, payment.currency)} /></label>
          <label className="field">{locale === "ar" ? "العملة" : "Currency"}<input name="currency" className="control" dir="ltr" required placeholder={payment.currency} maxLength={3} /></label>
          <label className="field">{t.transfer}<input name="transfer" className="control" dir="auto" required maxLength={100} /></label>
          <label className="field">{t.independent}<input name="independent" className="control" dir="auto" required minLength={3} maxLength={120} /></label>
        </div>
        <label className="flex items-start gap-2 text-sm"><input className="mt-1 accent-brand" type="checkbox" name="verified" required />{t.verified}</label>
        <button className="button button-primary justify-self-start" name="operation" value="approve" disabled={busy}>{t.approve}</button>
      </form>}
      <form action={action} className="panel grid gap-3 p-4">
        <label className="field">{t.reason}<textarea className="control" name="reason" rows={2} required minLength={3} maxLength={800} /></label>
        <button className="button button-secondary justify-self-start" name="operation" value="reject" disabled={busy}>{t.reject}</button>
      </form>
    </>}
    {payment.setupStatus === "paid" && <form action={action} className="panel grid gap-3 p-4">
      <label className="flex gap-2 text-sm"><input className="accent-brand" type="checkbox" name="verified" required />{t.setupDone}</label>
      <button className="button button-secondary justify-self-start" name="operation" value="complete_setup" disabled={busy}>{t.closeSetup}</button>
    </form>}
  </div>;
}
