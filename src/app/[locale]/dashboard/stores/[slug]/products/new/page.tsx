import { notFound } from "next/navigation";
import { CatalogFrame } from "@/components/catalog/catalog-ui";
import { ProductEditor } from "@/components/catalog/editor";
import { localizedValue } from "@/lib/catalog";
import { catalogCopy } from "@/lib/catalog-copy";
import { requireUser } from "@/server/auth/session";
import { listCategories } from "@/server/catalog/merchant";
import { routeLocale } from "@/server/locale";

export default async function NewProductPage({ params }: PageProps<"/[locale]/dashboard/stores/[slug]/products/new">) {
  const locale = await routeLocale(params);
  const { slug } = await params;
  const user = await requireUser(locale);
  const data = await listCategories(user.id, slug);
  if (!data) notFound();
  const t = catalogCopy[locale];
  return <CatalogFrame locale={locale} slug={slug} path="/products/new" storeName={data.store.name} showBilling={data.store.role === "owner"}>
    <h1 className="mb-2 text-4xl font-black">{t.addProduct}</h1>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <ProductEditor locale={locale} store={slug} id={null} currency={data.store.currency}
        categories={data.categories.map((category) => ({ id: category.id, label: localizedValue(locale, category.nameAr, category.nameEn) }))} />
      <aside className="panel grid gap-2 p-5">
        <h2 className="font-extrabold">{locale === "ar" ? "صور المنتج" : "Product images"}</h2>
        <p className="text-sm text-muted">{t.saveForImages}</p>
      </aside>
    </div>
  </CatalogFrame>;
}
