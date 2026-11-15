import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogFrame } from "@/components/catalog/catalog-ui";
import { PlanSelector, ProofForm, SubscriptionControl, WhatsAppSubscriptionCard } from "@/components/billing/forms";
import { billingCopy, billingPlans, paymentLabels, setupLabels, subscriptionLabels } from "@/lib/billing-copy";
import { formatPrice } from "@/lib/catalog";
import { defaultPlatformWhatsapp } from "@/lib/platform-contact";
import { requireUser } from "@/server/auth/session";
import { marketingBilling } from "@/server/billing/marketing";
import { merchantBilling } from "@/server/billing/repository";
import { routeLocale } from "@/server/locale";

export default async function BillingPage({ params, searchParams }: PageProps<"/[locale]/dashboard/stores/[slug]/billing">) {
  const locale = await routeLocale(params);
  const { slug } = await params;
  const query = (await searchParams).page;
  const page = typeof query === "string" && /^[0-9]{1,4}$/.test(query) ? Math.min(1000, Math.max(1, Number(query))) : 1;
  const user = await requireUser(locale);
  const [data, marketing] = await Promise.all([
    merchantBilling(user.id, slug, page),
    marketingBilling(),
  ]);
  if (!data) notFound();
  const { state, options, usage, rights, history, manualHistory, contact, store } = data;
  const contactMode = contact?.enabled ?? true;
  const whatsapp = contact?.whatsapp ?? defaultPlatformWhatsapp;
  const t = billingCopy[locale];
  const numbers = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const status = state.legacy ? t.legacy : state.onboarding && !state.pending ? t.onboarding : subscriptionLabels[locale][state.status];
  const heading = state.plan ? billingPlans[locale][state.plan] : status;
  const inactive = !state.onboarding && !rights.publish;
  const path = `/${locale}/dashboard/stores/${slug}/billing`;
  const dates = [
    [t.legacy, state.legacyUntil],
    [t.trialEnds, state.trialEnd ?? state.accountTrialEnd ?? null],
    [t.periodStart, state.periodStart],
    [t.periodEnd, state.periodEnd],
    [t.graceUntil, state.cancelAt ? null : state.graceUntil],
    [t.cancelOn, state.cancelAt],
    [t.nextOn, state.nextPeriod],
  ] as const;

  const catalogPrices = (marketing?.catalog ?? [])
    .filter((item) => item.country === store.country && item.currency === store.currency)
    .map((item) => ({ plan: item.plan, interval: item.interval, amount: item.amount, currency: item.currency, maxProducts: item.maxProducts }));
  const fallbackPrices = (marketing?.catalog ?? [])
    .map((item) => ({ plan: item.plan, interval: item.interval, amount: item.amount, currency: item.currency, maxProducts: item.maxProducts }));

  return <CatalogFrame locale={locale} slug={slug} path="/billing" storeName={store.name} showBilling>
    <header className="mb-6"><p className="text-sm font-bold text-brand"><bdi>{store.name}</bdi></p><h1 className="text-4xl font-black">{t.title}</h1></header>
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="panel wajhati-workspace-highlight grid content-start gap-3 p-5">
        <h2 className="text-sm font-bold text-muted">{t.current}</h2>
        <div>
          <p className="text-2xl font-black">{heading}</p>
          {state.plan && <p className="text-sm text-muted">
            {t.version} {numbers.format(state.version ?? 1)}
            {" · "}
            {state.manualMonths ? `${numbers.format(state.manualMonths)} ${state.manualMonths === 1 ? t.monthSingle : t.monthsLabel}` : state.interval ? t[state.interval] : null}
            {" · "}
            <bdi>{state.currency}</bdi>
          </p>}
        </div>
        {state.plan && <span className="tag w-fit">{status}</span>}
        {state.status === "trialing" && <span className="tag w-fit">{locale === "ar" ? "تجربة مجانية · 3 أيام (72 ساعة)" : "Free trial · 3 days (72 hours)"}</span>}
        {state.legacy && <p className="text-sm text-muted">{t.legacyHelp}</p>}
        {state.onboarding && <p className="text-sm text-muted">{contactMode ? t.accountTrialUsedHelp : t.onboardingHelp}</p>}
        {inactive && <p className="text-sm text-muted">{t.inactiveHelp}</p>}
        <p className="text-sm font-semibold">{t.noRenew}</p>
      </section>
      <section className="panel grid content-start gap-3 p-5">
        <h2 className="text-sm font-bold text-muted">{t.usage}</h2>
        <p className="text-2xl font-black tabular-nums"><bdi>{numbers.format(usage.products)} / {numbers.format(rights.maxProducts)}</bdi></p>
        <progress className="h-2 w-full accent-brand" aria-label={t.usage} value={usage.products} max={Math.max(1, rights.maxProducts)} />
        <p className="text-sm font-semibold">{numbers.format(Math.max(0, rights.maxProducts - usage.products))} {t.remaining}</p>
        <p className="text-sm text-muted">{t.storage} <bdi>{numbers.format(usage.storageBytes / 1048576)} / {numbers.format(rights.storageMiB)} MiB</bdi></p>
        <div className="border-t border-line pt-3 text-sm"><p className="font-bold">{t.analytics}</p>
          <p>{t.confirmed} <bdi>{numbers.format(usage.confirmed)}</bdi></p>
          {rights.analytics === "enhanced" && <p className="text-muted">{t.wa} {numbers.format(usage.byChannel?.whatsapp ?? 0)} · {t.ig} {numbers.format(usage.byChannel?.instagram ?? 0)}</p>}
        </div>
      </section>
      <section className="panel grid content-start gap-3 p-5">
        <h2 className="text-sm font-bold text-muted">{t.deadlines}</h2>
        <dl className="grid gap-2 text-sm">{dates.map(([label, value]) => value && <div key={label}><dt className="text-muted">{label}</dt>
          <dd className="font-bold"><time dateTime={value}><bdi>{date.format(new Date(value))} UTC</bdi></time></dd></div>)}</dl>
        {state.nextPlan && <p className="text-sm text-muted"><strong>{billingPlans[locale][state.nextPlan]}</strong> · {t.nextHelp}</p>}
        {(state.status === "trialing" || state.status === "grace_period" || (state.plan && state.status === "active" && !state.nextPeriod && !state.cancelAt)) && <p className="text-sm text-muted">{t.reminder}</p>}
        {!contactMode && state.onboarding && (options.eligible ? <SubscriptionControl locale={locale} slug={slug} operation="trial" /> : <p className="text-sm text-muted">{t.verifyRequired}</p>)}
        {state.plan && state.status === "active" && !state.nextPeriod && !state.pending && <SubscriptionControl key={String(state.cancelAt)} locale={locale} slug={slug} operation={state.cancelAt ? "keep" : "cancel"} />}
      </section>
    </div>

    <section className="panel my-5 grid gap-4 p-5 sm:p-6">
      <h2 className="text-xl font-black">{t.plans}</h2>
      {contactMode ? (
        <WhatsAppSubscriptionCard
          locale={locale}
          whatsapp={whatsapp}
          storeName={store.name}
          userEmail={user.email}
          currentPlan={state.plan}
          isActive={state.status === "active" || state.status === "grace_period"}
          prices={catalogPrices.length ? catalogPrices : fallbackPrices.length ? fallbackPrices : options.prices}
        />
      ) : (
        <PlanSelector locale={locale} slug={slug} requestKey={randomUUID()} options={options} initialCountry={store.country} locked={state.pending || Boolean(state.nextPeriod)} />
      )}
    </section>

    {manualHistory.length > 0 && (
      <section aria-labelledby="manual-subscription-history" className="mb-5 grid gap-3">
        <h2 id="manual-subscription-history" className="text-xl font-black">{t.manualHistoryTitle}</h2>
        {manualHistory.map((term) => (
          <article className="panel grid gap-2 p-5" key={term.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-black">
                  {billingPlans[locale][term.plan]} · {numbers.format(term.months)} {term.months === 1 ? t.monthSingle : t.monthsLabel}
                </h3>
                <p className="text-sm text-muted">
                  {t.reference}: <bdi>{term.reference}</bdi> · <time dateTime={term.createdAt.toISOString()}><bdi>{date.format(term.createdAt)} UTC</bdi></time>
                </p>
              </div>
              <span className="tag">{term.endsAt ? subscriptionLabels[locale].active : paymentLabels[locale].under_review}</span>
            </div>
            <p className="text-lg font-black"><bdi>{formatPrice(term.amountMinor, term.currency, locale)}</bdi></p>
            {term.startsAt && term.endsAt && (
              <p className="text-sm text-muted">
                {t.periodStart}: <time dateTime={term.startsAt.toISOString()}><bdi>{date.format(term.startsAt)} UTC</bdi></time>
                {" — "}
                {t.periodEnd}: <time dateTime={term.endsAt.toISOString()}><bdi>{date.format(term.endsAt)} UTC</bdi></time>
              </p>
            )}
            {term.note && <p className="text-sm text-muted"><bdi>{term.note}</bdi></p>}
          </article>
        ))}
      </section>
    )}

    <section aria-labelledby="payment-history" className="grid gap-3">
      <h2 id="payment-history" className="text-xl font-black">{t.history}</h2>
      {!history.length && <p className="panel p-5 text-sm text-muted">{t.noHistory}</p>}
      {history.map((payment) => <article className="panel grid gap-3 p-5" key={payment.id}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="font-black"><bdi>{payment.reference}</bdi></h3>
            <p className="text-sm text-muted"><time dateTime={payment.createdAt.toISOString()}><bdi>{date.format(payment.createdAt)} UTC</bdi></time> · <bdi>{payment.method}</bdi></p></div>
          <span className="tag">{paymentLabels[locale][payment.status]}</span>
        </div>
        <p className="text-lg font-black"><bdi>{formatPrice(payment.planMinor + payment.setupMinor, payment.currency, locale)}</bdi></p>
        {payment.setupLabel && <p className="text-sm">{t.setupLine} <bdi>{formatPrice(payment.setupMinor, payment.currency, locale)}</bdi> · <bdi>{payment.setupLabel}</bdi> · {payment.setupStatus && setupLabels[locale][payment.setupStatus]}</p>}
        {payment.reason && <p className="text-sm">{t.reason} <bdi>{payment.reason}</bdi></p>}
        {!contactMode && payment.status === "awaiting_payment" && <>
          <p className="text-sm">{t.payBy} <time dateTime={payment.expiresAt.toISOString()}><bdi>{date.format(payment.expiresAt)} UTC</bdi></time></p>
          <div className="rounded-xl bg-leaf/60 p-4"><h4 className="text-sm font-black">{t.instructions}</h4><p className="wrap-anywhere whitespace-pre-wrap text-sm" dir="auto">{payment.instructions}</p></div>
          <ProofForm locale={locale} slug={slug} id={payment.id} />
        </>}
      </article>)}
      <nav className="flex gap-2">
        {page > 1 && <Link className="button button-secondary" href={`${path}?page=${page - 1}`}>{t.previous}</Link>}
        {data.hasNext && page < 1000 && <Link className="button button-secondary" href={`${path}?page=${page + 1}`}>{t.next}</Link>}
      </nav>
    </section>
  </CatalogFrame>;
}
