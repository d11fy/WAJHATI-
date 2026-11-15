import { ExternalLink, LayoutList, Palette, Store } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogFrame, Price } from "@/components/catalog/catalog-ui";
import { ConfirmCatalog } from "@/components/catalog/editor";
import { StorefrontLink } from "@/components/storefront-link";
import { catalogCopy } from "@/lib/catalog-copy";
import { billingCopy } from "@/lib/billing-copy";
import { themeCopy } from "@/lib/theme-copy";
import { copy } from "@/lib/copy";
import { orderCopy } from "@/lib/order-copy";
import { requireUser } from "@/server/auth/session";
import { routeLocale } from "@/server/locale";
import { getPublicStore } from "@/server/stores/repository";
import { readStoreOverview } from "@/server/stores/overview";

export default async function StoreDashboard({ params }: PageProps<"/[locale]/dashboard/stores/[slug]">) {
  const locale = await routeLocale(params);
  const { slug } = await params;
  const t = copy[locale];
  const user = await requireUser(locale);
  const data = await readStoreOverview(user.id, slug);
  if (!data) notFound();
  const { store } = data;

  const catalog = catalogCopy[locale];
  const orders = orderCopy[locale];
  const ar = locale === "ar";
  const number = new Intl.NumberFormat(locale);
  const publicPath = `/${locale}/s/${store.slug}`;
  const merchantPath = `/${locale}/dashboard/stores/${store.slug}`;
  const live = store.published && Boolean(await getPublicStore(store.slug));
  const operation = store.published ? "unpublishStore" : "publishStore";
  const metrics = [
    [ar ? "المنتجات المنشورة" : "Published products", data.publishedProducts],
    [catalog.categories, data.categoryCount],
    [orders.orders, data.orderCount],
    [ar ? "الطلبات المؤكدة" : "Confirmed orders", data.confirmed],
  ] as const;
  return (
    <CatalogFrame locale={locale} slug={slug} path="" storeName={store.name} showBilling={store.role === "owner"}>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <h1 className="min-w-0 wrap-anywhere text-3xl font-black sm:text-4xl"><bdi>{store.name}</bdi></h1>
        <Link className="button button-primary" href={`${merchantPath}/products/new`}>{catalog.addProduct}</Link>
      </header>
      <section className="panel wajhati-workspace-highlight p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span className="icon-tile size-13"><Store size={24} aria-hidden="true" /></span>
            <div className="min-w-0"><p className="tag">{live ? t.published : t.draft}</p>
              <p className="mt-1 text-sm text-muted">{catalog.storePublishHelp}</p></div>
          </div>
          {live && <Link className="button button-secondary" href={publicPath}>{t.publicView}<ExternalLink size={17} aria-hidden="true" /></Link>}
        </div>
      </section>
      <dl className="my-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metrics.map(([label, value]) => <div className="panel min-w-0 p-4" key={label}>
          <dt className="text-sm font-semibold text-muted">{label}</dt><dd className="mt-1 text-3xl font-black">{number.format(value)}</dd>
        </div>)}
      </dl>
      <section className="panel mb-5 grid gap-3 p-5 sm:p-6">
        <h2 className="text-xl font-black">{ar ? "أحدث الطلبات" : "Recent orders"}</h2>
        {!data.recentOrders.length ? <p className="text-sm text-muted">{orders.noOrders}</p> : <ul className="grid gap-2">
          {data.recentOrders.map((row) => <li key={row.reference}>
            <Link className="wajhati-workspace-list-row" href={`${merchantPath}/orders/${row.reference}`}>
              <bdi className="font-bold">{row.reference}</bdi><span className="text-muted">{orders[row.channel]} · {orders[row.status]}</span>
              <Price value={row.total} currency={row.currency} locale={locale} />
            </Link>
          </li>)}
        </ul>}
      </section>
      <section className="panel grid gap-4 p-5 sm:p-6">
        <h2 className="text-xl font-black">{ar ? "تفاصيل المتجر" : "Store details"}</h2>
        <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="min-w-0 sm:col-span-2"><dt className="text-sm text-muted">{t.storeLink}</dt><dd><StorefrontLink path={publicPath} locale={locale} published={live} /></dd></div>
          <div><dt className="text-sm text-muted">{t.role}</dt><dd className="font-bold">{t[store.role]}</dd></div>
          <div><dt className="text-sm text-muted">{t.country}</dt><dd className="font-bold">{new Intl.DisplayNames(locale, { type: "region" }).of(store.country)}</dd></div>
          <div><dt className="text-sm text-muted">{t.currency}</dt><dd className="font-bold">{new Intl.DisplayNames(locale, { type: "currency" }).of(store.currency)} <bdi>{store.currency}</bdi></dd></div>
        </dl>
        <div className="wajhati-workspace-quick-links flex-wrap gap-2">
          <Link className="button button-secondary" href={`${merchantPath}/categories`}><LayoutList size={18} aria-hidden="true" />{catalog.categories}</Link>
          <Link className="button button-secondary" href={`${merchantPath}/design`}><Palette size={18} aria-hidden="true" />{themeCopy[locale].design}</Link>
          {store.role === "owner" && <Link className="button button-secondary" href={`${merchantPath}/billing`}>{billingCopy[locale].title}</Link>}
        </div>
        {!live && <p className="text-sm text-muted">{catalog.storeHidden}</p>}
        {store.role === "owner" && <ConfirmCatalog key={operation} locale={locale} store={slug} operation={operation} />}
      </section>
    </CatalogFrame>
  );
}
