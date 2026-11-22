import { notFound } from "next/navigation";
import { CatalogFrame } from "@/components/catalog/catalog-ui";
import { Designer } from "@/components/store-theme/designer";
import { localizedValue } from "@/lib/catalog";
import { themeCopy } from "@/lib/theme-copy";
import { aiFeatureEnabled } from "@/server/ai/provider";
import { requireUser } from "@/server/auth/session";
import { routeLocale } from "@/server/locale";
import { getDesigner } from "@/server/themes/design";

export default async function DesignPage({ params, searchParams }: PageProps<"/[locale]/dashboard/stores/[slug]/design">) {
  const locale = await routeLocale(params);
  const { slug } = await params;
  const user = await requireUser(locale);
  const data = await getDesigner(user.id, slug);
  if (!data) notFound();
  const t = themeCopy[locale];
  const status = (await searchParams).status;
  const notice = status === "saved" ? t.saved : status === "published" ? t.publishedNotice
    : status === "restored" ? t.restored : status === "previousRestored" ? t.previousRestored : null;
  const labels = (rows: typeof data.products) => rows.map(({ id, nameAr, nameEn }) => ({ id, name: localizedValue(locale, nameAr, nameEn) }));

  return <CatalogFrame locale={locale} slug={slug} path="/design" storeName={data.store.name} showBilling={data.store.role === "owner"}>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-sm font-bold text-muted"><bdi>{data.store.name}</bdi></p><h1 className="text-balance text-4xl font-black">{t.design}</h1></div>
      <span className="tag tabular-nums">{data.revision === data.publishedRevision ? t.published : t.draft} · {new Intl.NumberFormat(locale).format(data.revision)}</span>
    </div>
    {notice && <p role="status" className="tag mb-4">{notice}</p>}
    <Designer key={`${data.revision}-${data.publishedRevision}`} locale={locale} slug={slug} initial={data.draft} revision={data.revision}
      publishedRevision={data.publishedRevision} hasPrevious={data.hasPrevious} owner={data.store.role === "owner"} ai={aiFeatureEnabled()} allowed={data.allowed} premium={data.premium} assets={data.assets}
      products={labels(data.products)} categories={labels(data.categories)} />
  </CatalogFrame>;
}
