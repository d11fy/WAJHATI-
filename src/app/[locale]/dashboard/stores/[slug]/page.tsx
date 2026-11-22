import { BadgeCheck, Boxes, CheckCircle2, Circle, ExternalLink, LayoutGrid, LayoutList, MessageSquare, Palette, Store } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CreditsMeter } from "@/components/ai/credits-meter";
import { CatalogFrame, Price } from "@/components/catalog/catalog-ui";
import { ConfirmCatalog } from "@/components/catalog/editor";
import { StorefrontLink } from "@/components/storefront-link";
import { catalogCopy } from "@/lib/catalog-copy";
import { billingCopy } from "@/lib/billing-copy";
import { themeCopy } from "@/lib/theme-copy";
import { copy } from "@/lib/copy";
import { orderCopy } from "@/lib/order-copy";
import { readAiWallet } from "@/server/ai/wallet-view";
import { requireUser } from "@/server/auth/session";
import { routeLocale } from "@/server/locale";
import { getPausedStore, getPublicStore } from "@/server/stores/repository";
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
  const wallet = await readAiWallet(user.id, slug);
  const live = store.published && Boolean(await getPublicStore(store.slug));
  const paused = store.published && !live ? await getPausedStore(store.slug) : null;
  const operation = store.published ? "unpublishStore" : "publishStore";
  const metrics = [
    [ar ? "المنتجات المنشورة" : "Published products", data.publishedProducts, Boxes, "products"],
    [catalog.categories, data.categoryCount, LayoutGrid, "categories"],
    [orders.orders, data.orderCount, MessageSquare, "orders"],
    [ar ? "الطلبات المؤكدة" : "Confirmed orders", data.confirmed, BadgeCheck, "orders"],
  ] as const;

  const checklist = [
    {
      done: data.categoryCount > 0,
      label: ar ? "إضافة تصنيفات المنتجات" : "Add product categories",
      href: `${merchantPath}/categories`,
      cta: ar ? "إدارة التصنيفات" : "Categories",
    },
    {
      done: data.publishedProducts > 0,
      label: ar ? "نشر أول منتج في الكتالوج" : "Publish your first product",
      href: `${merchantPath}/products/new`,
      cta: catalog.addProduct,
    },
    {
      done: data.contactEnabled,
      label: ar ? "تفعيل استقبال الطلبات (واتساب / إنستغرام)" : "Enable WhatsApp or Instagram orders",
      href: `${merchantPath}/contact`,
      cta: orders.settingsLink,
    },
    {
      done: live,
      label: ar ? "نشر المتجر ومشاركة الرابط مع العملاء" : "Publish store and share link",
      href: `${merchantPath}/design`,
      cta: themeCopy[locale].design,
    },
  ];
  const completedSteps = checklist.filter((step) => step.done).length;
  const readinessPercent = Math.round((completedSteps / checklist.length) * 100);

  return (
    <CatalogFrame locale={locale} slug={slug} path="" storeName={store.name} showBilling={store.role === "owner"}>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <h1 className="min-w-0 wrap-anywhere text-3xl font-black sm:text-4xl"><bdi>{store.name}</bdi></h1>
        <Link className="button button-primary" href={`${merchantPath}/products/new`}>{catalog.addProduct}</Link>
      </header>
      {paused && <section className="panel mb-5 flex flex-wrap items-center justify-between gap-4 border-amber-300 bg-amber-50 p-5 sm:p-6" role="status" data-testid="store-paused-notice">
        <div className="min-w-0"><h2 className="text-lg font-black">{ar ? "متجرك متوقف مؤقتًا" : "Your store is temporarily paused"}</h2>
          <p className="mt-1 text-sm text-muted">{ar ? "انتهت التجربة أو الاشتراك، فلا يظهر المتجر للزوار الآن. منتجاتك وبياناتك محفوظة كلها، ويعود المتجر فور تفعيل الاشتراك." : "Your trial or subscription has ended, so visitors cannot see the store right now. Your products and data are all kept, and the store returns as soon as you subscribe."}</p></div>
        {store.role === "owner" ? <Link className="button button-primary" href={`${merchantPath}/billing`}>{ar ? "اشترك لإعادة تفعيل المتجر" : "Subscribe to bring it back"}</Link> : <p className="text-sm font-bold">{ar ? "تواصل مع مالك المتجر لتفعيل الاشتراك." : "Ask the store owner to subscribe."}</p>}
      </section>}
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
      <dl className="wajhati-metrics my-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metrics.map(([label, value, Icon, area]) => <div className="panel wajhati-metric min-w-0 p-4" key={label}>
          <dt className="flex items-center gap-2 text-sm font-semibold text-muted"><span className="wajhati-metric-icon" aria-hidden="true"><Icon size={17} /></span>{label}</dt>
          <dd className="mt-2 text-3xl font-black"><Link className="wajhati-metric-link" href={`${merchantPath}/${area}`}>{number.format(value)}</Link></dd>
        </div>)}
      </dl>
      {wallet && <CreditsMeter locale={locale} slug={slug} wallet={wallet} owner={store.role === "owner"} />}
      <section className="panel mb-5 grid gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-black">{ar ? "جاهزية المتجر للبيع" : "Store launch readiness"}</h2>
            <p className="text-sm text-muted">{ar ? "أكمل هذه الخطوات الأساسية لتستقبل طلبات العملاء بأفضل تجربة." : "Complete these core steps to start receiving customer orders seamlessly."}</p>
          </div>
          <span className="tag font-bold">{number.format(completedSteps)} / {number.format(checklist.length)} ({number.format(readinessPercent)}%)</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-canvas" aria-hidden="true">
          <div className="h-full rounded-full bg-teal-700 transition-all" style={{ width: `${readinessPercent}%` }} />
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {checklist.map((step) => (
            <li key={step.label} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-canvas p-3">
              <div className="flex min-w-0 items-center gap-2.5">
                {step.done
                  ? <CheckCircle2 size={19} className="shrink-0 text-teal-700" aria-hidden="true" />
                  : <Circle size={19} className="shrink-0 text-muted" aria-hidden="true" />}
                <span className={step.done ? "text-sm font-semibold text-muted line-through" : "text-sm font-bold"}>{step.label}</span>
              </div>
              {!step.done && <Link className="text-xs font-bold text-teal-700 underline underline-offset-4 shrink-0" href={step.href}>{step.cta}</Link>}
            </li>
          ))}
        </ul>
      </section>
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
          <div className="min-w-0 sm:col-span-2"><dt className="text-sm text-muted">{t.storeLink}</dt><dd><StorefrontLink path={publicPath} locale={locale} published={live} storeName={store.name} /></dd></div>
          <div><dt className="text-sm text-muted">{t.role}</dt><dd className="font-bold">{t[store.role]}</dd></div>
          <div><dt className="text-sm text-muted">{t.country}</dt><dd className="font-bold">{new Intl.DisplayNames(locale, { type: "region" }).of(store.country)}</dd></div>
          <div><dt className="text-sm text-muted">{t.currency}</dt><dd className="font-bold">{new Intl.DisplayNames(locale, { type: "currency" }).of(store.currency)} <bdi>{store.currency}</bdi></dd></div>
        </dl>
        <div className="wajhati-workspace-quick-links flex-wrap gap-2">
          <Link className="button button-secondary" href={`${merchantPath}/categories`}><LayoutList size={18} aria-hidden="true" />{catalog.categories}</Link>
          <Link className="button button-secondary" href={`${merchantPath}/design`}><Palette size={18} aria-hidden="true" />{themeCopy[locale].design}</Link>
          <Link className="button button-secondary" href={`${merchantPath}/contact`}><MessageSquare size={18} aria-hidden="true" />{orders.settingsLink}</Link>
          {store.role === "owner" && <Link className="button button-secondary" href={`${merchantPath}/billing`}>{billingCopy[locale].title}</Link>}
        </div>
        {!live && <p className="text-sm text-muted">{catalog.storeHidden}</p>}
        {store.role === "owner" && <ConfirmCatalog key={operation} locale={locale} store={slug} operation={operation} />}
      </section>
    </CatalogFrame>
  );
}
