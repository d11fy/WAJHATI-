import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogFrame, Price } from "@/components/catalog/catalog-ui";
import { OrderCommand } from "@/components/orders/merchant-forms";
import { localizedValue } from "@/lib/catalog";
import { lineTotal } from "@/lib/checkout";
import { orderCopy } from "@/lib/order-copy";
import { requireUser } from "@/server/auth/session";
import { routeLocale } from "@/server/locale";
import { getOrder } from "@/server/orders/merchant";

export default async function OrderPage({ params, searchParams }: PageProps<"/[locale]/dashboard/stores/[slug]/orders/[reference]">) {
  const locale = await routeLocale(params);
  const { slug, reference } = await params;
  const user = await requireUser(locale);
  const order = /^DM-[A-F0-9]{20}$/.test(reference) ? await getOrder(user.id, slug, reference) : null;
  if (!order) notFound();
  const t = orderCopy[locale];
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const canChange = order.status === "initiated" || order.status === "contact_opened";
  return <CatalogFrame locale={locale} slug={slug} path={`/orders/${reference}`}>
    <Link className="button button-secondary mb-4" href={`/${locale}/dashboard/stores/${slug}/orders`}>{t.orders}</Link>
    <section className="panel grid gap-4 p-4 sm:p-6">
      <h1 className="wrap-anywhere text-3xl font-black"><bdi>{order.reference}</bdi></h1>
      {(await searchParams).changed === "1" && <p className="tag" role="status">{t.changed}</p>}
      <div className="flex flex-wrap gap-2"><span className="tag">{t[order.status]}</span><span className="tag">{t[order.channel]}</span>{order.archivedAt && <span className="tag">{t.archived}</span>}</div>
      <p>{date.format(order.createdAt)}</p>{order.openedAt && <p>{t.openedAt} · {date.format(order.openedAt)}</p>}
      <p className="text-sm text-muted">{t.eventNote}</p>
      <ul className="divide-y divide-line">
        {order.lines.map((line) => <li key={line.position} className="flex flex-wrap justify-between gap-2 py-3">
          <div><p className="font-bold"><bdi>{localizedValue(locale, line.nameAr, line.nameEn)}</bdi> × {line.quantity}</p>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">{line.options.map(({ group, value }) => <bdi key={group}>{group} · {value}</bdi>)}</p></div>
          <div>{t.unitPrice} <Price value={line.unitMinor} currency={order.currency} locale={locale} /> · {t.lineTotal} <Price value={lineTotal(line)} currency={order.currency} locale={locale} /></div>
        </li>)}
      </ul>
      <p className="font-bold">{t.total} <Price value={order.total} currency={order.currency} locale={locale} /></p>
      {!order.archivedAt && <div className="grid gap-2 sm:grid-cols-3">
        {canChange && <><OrderCommand locale={locale} slug={slug} reference={reference} operation="confirm" /><OrderCommand locale={locale} slug={slug} reference={reference} operation="cancel" /></>}
        <OrderCommand locale={locale} slug={slug} reference={reference} operation="archive" />
      </div>}
    </section>
  </CatalogFrame>;
}
