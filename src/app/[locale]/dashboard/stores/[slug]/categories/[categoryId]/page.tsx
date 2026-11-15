import { notFound } from "next/navigation";
import { CatalogFrame, privateImagePath } from "@/components/catalog/catalog-ui";
import { CategoryEditor, ConfirmCatalog } from "@/components/catalog/editor";
import { ImageManager } from "@/components/catalog/image-manager";
import { catalogCopy } from "@/lib/catalog-copy";
import { requireUser } from "@/server/auth/session";
import { listCategories } from "@/server/catalog/merchant";
import { routeLocale } from "@/server/locale";

export default async function EditCategoryPage({ params, searchParams }: PageProps<"/[locale]/dashboard/stores/[slug]/categories/[categoryId]">) {
  const locale = await routeLocale(params);
  const { slug, categoryId } = await params;
  const user = await requireUser(locale);
  const data = await listCategories(user.id, slug);
  const category = data?.categories.find((item) => item.id === categoryId);
  if (!category) notFound();
  const t = catalogCopy[locale];
  return <CatalogFrame locale={locale} slug={slug} path={`/categories/${categoryId}`}>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-4xl font-black">{t.editCategory}</h1>
      <ConfirmCatalog locale={locale} store={slug} id={categoryId} operation="deleteCategory" />
    </div>
    {(await searchParams).saved === "1" && <p className="tag mb-4" role="status">{t.saved}</p>}
    <div className="grid gap-4">
      <CategoryEditor locale={locale} store={slug} id={categoryId}
        initial={{ nameAr: category.nameAr, nameEn: category.nameEn ?? "", slug: category.slug, position: String(category.position), visible: category.visible }} />
      <ImageManager locale={locale} path={privateImagePath(slug, "category", categoryId)} images={category.imageId ? [{ id: category.imageId, primary: false }] : []} multiple={false} />
    </div>
  </CatalogFrame>;
}
