import { notFound } from "next/navigation";
import { CatalogFrame, privateImagePath } from "@/components/catalog/catalog-ui";
import { ConfirmCatalog, ProductEditor } from "@/components/catalog/editor";
import { ImageManager } from "@/components/catalog/image-manager";
import { localizedValue, priceInput } from "@/lib/catalog";
import { catalogCopy } from "@/lib/catalog-copy";
import { aiFeatureEnabled } from "@/server/ai/provider";
import { requireUser } from "@/server/auth/session";
import { getProductForEdit } from "@/server/catalog/merchant";
import { routeLocale } from "@/server/locale";

export default async function EditProductPage({ params, searchParams }: PageProps<"/[locale]/dashboard/stores/[slug]/products/[productId]">) {
  const locale = await routeLocale(params);
  const { slug, productId } = await params;
  const user = await requireUser(locale);
  const data = await getProductForEdit(user.id, slug, productId);
  if (!data) notFound();
  const t = catalogCopy[locale];
  const { product, store } = data;

  return <CatalogFrame locale={locale} slug={slug} path={`/products/${productId}`} storeName={store.name} showBilling={store.role === "owner"}>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <span className="tag">{t[product.state]}</span>
        <h1 className="mt-1 text-4xl font-black">{t.editProduct}</h1>
        <p className="wrap-anywhere text-muted"><bdi>{localizedValue(locale, product.nameAr, product.nameEn)}</bdi></p>
      </div>
      {product.state !== "archived" && <ConfirmCatalog locale={locale} store={slug} id={productId} operation="archiveProduct" />}
    </div>
    {(await searchParams).saved === "1" && <p className="tag mb-4" role="status">{t.saved}</p>}
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <ProductEditor locale={locale} store={slug} id={productId} currency={store.currency} ai={aiFeatureEnabled()}
        categories={data.categories.map((category) => ({ id: category.id, label: localizedValue(locale, category.nameAr, category.nameEn) }))}
        initial={{
          nameAr: product.nameAr, nameEn: product.nameEn ?? "", slug: product.slug, position: String(product.position),
          descriptionAr: product.descriptionAr ?? "", descriptionEn: product.descriptionEn ?? "", sku: product.sku ?? "",
          price: priceInput(product.priceMinor, store.currency), compareAt: product.compareAtMinor === null ? "" : priceInput(product.compareAtMinor, store.currency),
          state: product.state === "archived" ? "draft" : product.state, featured: product.featured, available: product.available,
          categoryIds: data.categoryIds, options: data.options,
        }} />
      <ImageManager locale={locale} path={privateImagePath(slug, "product", productId)} images={data.imageRows} multiple />
    </div>
  </CatalogFrame>;
}
