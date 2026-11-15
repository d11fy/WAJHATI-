import { Package, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogFrame, CatalogImage, Pagination, Price, privateImagePath } from "@/components/catalog/catalog-ui";
import { MerchantFilters } from "@/components/catalog/merchant-filters";
import { catalogFilters, localizedValue } from "@/lib/catalog";
import { catalogCopy } from "@/lib/catalog-copy";
import { requireUser } from "@/server/auth/session";
import { listProducts } from "@/server/catalog/merchant";
import { routeLocale } from "@/server/locale";

export default async function ProductsPage({ params, searchParams }: PageProps<"/[locale]/dashboard/stores/[slug]/products">) {
  const locale = await routeLocale(params);
  const { slug } = await params;
  const user = await requireUser(locale);
  const filters = catalogFilters(await searchParams, true);
  const data = await listProducts(user.id, slug, filters);
  if (!data) notFound();
  const t = catalogCopy[locale];
  const path = `/${locale}/dashboard/stores/${slug}/products`;
  const filtered = filters.q || filters.state || filters.category || filters.availableOnly || filters.page > 1;
  const categories = data.categories.map((category) => ({ value: category.id, name: localizedValue(locale, category.nameAr, category.nameEn) }));

  return <CatalogFrame locale={locale} slug={slug} path="/products" storeName={data.store.name} showBilling={data.store.role === "owner"}>
    <div className="wajhati-product-heading flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-3xl font-extrabold sm:text-4xl">{t.products}</h1><p className="mt-1 text-sm text-muted">{t.catalogIntro}</p></div>
      <Link className="button button-primary" href={`${path}/new`}><Plus size={18} aria-hidden="true" />{t.addProduct}</Link>
    </div>
    <MerchantFilters key={JSON.stringify(filters)} path={path} locale={locale} filters={filters} categories={categories} />
    {data.products.length ? <div className="wajhati-product-list"><div className="wajhati-product-labels" aria-hidden="true"><span>{t.products}</span><span>{t.price}</span><span>{t.status}</span><span /></div><ul>
      {data.products.map((product) => {
        const name = localizedValue(locale, product.nameAr, product.nameEn);
        const source = product.imageId ? `${privateImagePath(slug, "product", product.id)}/${product.imageId}` : null;
        return <li key={product.id} className="wajhati-product-row">
          <div className="wajhati-product-name"><CatalogImage src={source} alt="" /><h2 className="wrap-anywhere font-bold"><bdi>{name}</bdi></h2></div>
          <div className="wajhati-product-price"><Price value={product.priceMinor} currency={data.store.currency} locale={locale} /></div>
          <div className="wajhati-product-state flex flex-wrap gap-2">
            <span className="tag" data-product-state={product.state}>{t[product.state]}</span>
            {product.featured && <span className="tag">{t.featured}</span>}
            {!product.available && <span className="tag bg-sand">{t.unavailableItem}</span>}
          </div>
          <Link className="button button-secondary wajhati-product-edit" href={`${path}/${product.id}`}>{t.edit}</Link>
        </li>;
      })}
    </ul></div> : <section className="wajhati-workspace-empty panel">
      <span className="icon-tile"><Package size={22} aria-hidden="true" /></span>
      <h2>{filtered ? t.noResults : t.noProducts}</h2>
      <p>{filtered ? (locale === "ar" ? "جرّب عبارة بحث أخرى أو وسّع نطاق الفلاتر." : "Try a different search or broaden the filters.") : t.catalogIntro}</p>
      {filtered && <Link className="button button-secondary" href={path}>{locale === "ar" ? "عرض كل المنتجات" : "View all products"}</Link>}
    </section>}
    <Pagination path={path} locale={locale} filters={filters} hasNext={data.hasNext} />
  </CatalogFrame>;
}
