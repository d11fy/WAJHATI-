import Link from "next/link";
import { AdminWorkspace } from "@/components/admin-workspace";
import { billingCopy, billingPlans, paymentLabels } from "@/lib/billing-copy";
import { formatPrice } from "@/lib/catalog";
import { readSessionToken } from "@/server/auth/session";
import { listPaymentReviews } from "@/server/billing/repository";
import { routeLocale } from "@/server/locale";
import { platformAccess } from "@/server/platform/repository";

export default async function ReviewQueue({ params, searchParams }: PageProps<"/[locale]/payment-review">) {
  const locale = await routeLocale(params);
  const t = billingCopy[locale];
  const query = await searchParams;
  const pending = query.queue !== "history";
  const page = typeof query.page === "string" && /^[0-9]{1,4}$/.test(query.page) ? Math.min(1000, Math.max(1, Number(query.page))) : 1;
  const token = await readSessionToken();
  const [rows, access] = await Promise.all([listPaymentReviews(token, null, pending, page), platformAccess(token)]);
  const path = `/${locale}/payment-review`;
  const queryPath = (number: number) => `${path}?queue=${pending ? "pending" : "history"}&page=${number}`;
  return <AdminWorkspace locale={locale} path="/payment-review" roles={access?.roles ?? []}>
    <h1 className="mb-5 text-4xl font-black">{t.review}</h1>
    <nav className="mb-4 flex flex-wrap gap-2">
      <Link className={`button ${pending ? "button-primary" : "button-secondary"}`} href={path}>{t.pending}</Link>
      <Link className={`button ${pending ? "button-secondary" : "button-primary"}`} href={`${path}?queue=history`}>{t.reviewed}</Link>
    </nav>
    <div className="grid gap-3">{!rows.length && <p className="panel p-5 text-sm text-muted">{t.emptyReview}</p>}
      {rows.slice(0, 20).map((row) => <article key={row.id} className="panel flex flex-wrap justify-between gap-4 p-5">
        <div className="min-w-0"><h2 className="font-black"><bdi>{row.reference}</bdi></h2><p className="wrap-anywhere text-sm text-muted"><bdi>{row.store}</bdi> · <bdi>{row.merchant}</bdi></p>
          <p className="text-sm font-bold">{billingPlans[locale][row.plan]} · <bdi>{formatPrice(row.planMinor + row.setupMinor, row.currency, locale)}</bdi></p></div>
        <div className="flex flex-wrap items-center gap-2"><span className="tag">{paymentLabels[locale][row.status]}</span>
          <Link className="button button-secondary" href={`${path}/${row.id}`}>{t.details}</Link></div>
      </article>)}
    </div>
    <nav className="mt-4 flex gap-2">{page > 1 && <Link className="button button-secondary" href={queryPath(page - 1)}>{t.previous}</Link>}
      {rows.length > 20 && page < 1000 && <Link className="button button-secondary" href={queryPath(page + 1)}>{t.next}</Link>}</nav>
  </AdminWorkspace>;
}
