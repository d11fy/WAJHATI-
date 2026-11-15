import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogFrame, Price } from "@/components/catalog/catalog-ui";
import { localizedValue } from "@/lib/catalog";
import { statuses } from "@/lib/checkout";
import { orderCopy } from "@/lib/order-copy";
import { requireUser } from "@/server/auth/session";
import { routeLocale } from "@/server/locale";
import { listOrders, type OrderFilter } from "@/server/orders/merchant";

const filters = ["active", ...statuses, "archived"] as const;

export default async function OrdersPage({ params, searchParams }: PageProps<"/[locale]/dashboard/stores/[slug]/orders">) {
  const locale = await routeLocale(params);
  const { slug } = await params;
  const user = await requireUser(locale);
  const values = await searchParams;
  const state = filters.find((item) => item === values.state) ?? "active";
  const q = typeof values.q === "string" && /^[A-Za-z0-9-]{1,23}$/.test(values.q.trim()) ? values.q.trim() : "";
  const page = typeof values.page === "string" && /^\d{1,4}$/.test(values.page) ? Math.max(1, Number(values.page)) : 1;
  const data = await listOrders(user.id, slug, state satisfies OrderFilter, q, page);
  if (!data) notFound();
  const t = orderCopy[locale];
  const path = `/${locale}/dashboard/stores/${slug}/orders`;
  const href = (next: number) => `${path}?${new URLSearchParams({ state, q, page: String(next) })}`;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  return <CatalogFrame locale={locale} slug={slug} path="/orders">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h1 className="text-3xl font-black">{t.orders}</h1><Link className="button button-secondary" href={`/${locale}/dashboard/stores/${slug}/contact`}>{t.settingsLink}</Link></div>
    <p className="mb-4 text-sm text-muted">{t.eventNote}</p>
    <form method="get" className="panel wajhati-order-filters mb-5 p-4">
      <label className="field min-w-0 grow">{t.search}<input name="q" className="control" dir="ltr" maxLength={23} defaultValue={q} /></label>
      <label className="field">{t.state}<select name="state" className="control" defaultValue={state}>{filters.map((value) => <option key={value} value={value}>{t[value]}</option>)}</select></label>
      <button className="button button-primary">{t.filter}</button>
    </form>
    {!data.rows.length ? <section className="panel wajhati-workspace-empty"><span className="icon-tile"><MessageSquare size={22} aria-hidden="true" /></span>
      <h2>{t.noOrders}</h2><p>{t.eventNote}</p></section> : <div className="wajhati-product-list">
      <div className="wajhati-product-labels" aria-hidden="true"><span>{t.orders}</span><span>{t.state}</span>
        <span>{locale === "ar" ? "الإجمالي" : "Total"}</span><span>{t.details}</span></div>
      <ul>
      {data.rows.map((order) => <li key={order.id} className="wajhati-product-row">
        <div className="wajhati-order-name grid min-w-0 gap-1"><bdi className="wrap-anywhere font-bold">{order.reference}</bdi><p className="text-sm text-muted">{date.format(order.createdAt)} · {t[order.channel]}</p>
          <p className="wrap-anywhere text-sm">{order.items.slice(0, 3).map((item) => `${localizedValue(locale, item.nameAr, item.nameEn)} × ${item.quantity}`).join(" · ")}{order.items.length > 3 ? ` +${order.items.length - 3}` : ""}</p></div>
        <div className="flex flex-wrap gap-1"><span className="tag">{t[order.status]}</span>{order.archivedAt && <span className="tag">{t.archived}</span>}</div>
        <div className="wajhati-product-price"><Price value={order.total} currency={order.currency} locale={locale} /></div>
        <Link className="button button-secondary wajhati-product-edit" href={`${path}/${order.reference}`}>{t.details}</Link>
      </li>)}
      </ul>
    </div>}
    <nav className="mt-4 flex gap-2" aria-label={t.orders}>
      {page > 1 && <Link className="button button-secondary" href={href(page - 1)}>{t.previous}</Link>}
      {data.hasNext && <Link className="button button-secondary" href={href(page + 1)}>{t.next}</Link>}
    </nav>
  </CatalogFrame>;
}
