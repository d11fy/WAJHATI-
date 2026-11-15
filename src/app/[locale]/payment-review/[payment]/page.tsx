import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminWorkspace } from "@/components/admin-workspace";
import { ReviewControls } from "@/components/billing/forms";
import { billingCopy, billingPlans, paymentLabels, setupLabels } from "@/lib/billing-copy";
import { formatPrice } from "@/lib/catalog";
import { readSessionToken } from "@/server/auth/session";
import { listPaymentReviews } from "@/server/billing/repository";
import { routeLocale } from "@/server/locale";
import { paymentStage, platformAccess } from "@/server/platform/repository";
import { platformCopy } from "@/lib/platform-copy";

export default async function PaymentReview({ params }: PageProps<"/[locale]/payment-review/[payment]">) {
  const locale = await routeLocale(params);
  const { payment } = await params;
  const token = await readSessionToken();
  const [rows, stage, access] = await Promise.all([listPaymentReviews(token, payment, false, 1), paymentStage(token, payment), platformAccess(token)]);
  const [row] = rows;
  if (!row) notFound();
  const t = billingCopy[locale];
  const regions = new Intl.DisplayNames(locale, { type: "region" });
  return <AdminWorkspace locale={locale} path={`/payment-review/${payment}`} roles={access?.roles ?? []}>
    <Link className="mb-4 block text-sm font-bold text-brand" href={`/${locale}/payment-review`}>{t.review}</Link>
    <section className="panel mb-5 grid gap-4 p-5 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-black sm:text-4xl"><bdi>{row.reference}</bdi></h1>
        <span className="tag">{paymentLabels[locale][row.status]}</span></header>
      <dl className="grid gap-3 sm:grid-cols-2">{[
        [t.merchant, `${row.store} · ${row.merchant}`], [t.plan, `${billingPlans[locale][row.plan]} · ${t[row.interval]} · ${t.version} ${row.version}`],
        [t.total, formatPrice(row.planMinor + row.setupMinor, row.currency, locale)], [t.method, `${row.method} · ${regions.of(row.country)}`],
        [t.transfer, row.transactionRef], [t.independent, row.reconciliation], [t.reason, row.reason],
        [t.setup, row.setupLabel], [t.setupStatus, row.setupStatus ? setupLabels[locale][row.setupStatus] : null], [t.notes, row.setupNotes],
      ].map(([label, value]) => value && <div className="min-w-0" key={label}><dt className="text-sm text-muted">{label}</dt><dd className="wrap-anywhere whitespace-pre-wrap font-bold"><bdi>{value}</bdi></dd></div>)}</dl>
      {row.hasProof && access?.fresh && row.mayReview && <div className="flex flex-wrap gap-2">
        <a className="button button-secondary w-fit" href={`/api/payment-review/${row.id}/proof`} download>{t.download}</a>
        {stage?.source && <a className="button button-secondary w-fit" href={`/api/payment-review/${row.id}/proof?source=original`} download>{t.originalProof}</a>}
        {stage?.source && <p className="basis-full text-sm text-muted">{t.proofOriginalHelp}</p>}
      </div>}
    </section>
    {stage?.waiting && row.status === "under_review" && <p className="panel mb-4 p-4 text-sm font-bold">{t.secondReview}</p>}
    {access?.fresh ? <ReviewControls locale={locale} payment={row} maySecond={!stage?.initiatedHere} />
      : <Link className="button button-primary" href={`/${locale}/platform/mfa?to=review`}>{platformCopy[locale].fresh}</Link>}
  </AdminWorkspace>;
}
