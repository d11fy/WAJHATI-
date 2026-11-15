import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogFrame, CatalogImage, privateImagePath } from "@/components/catalog/catalog-ui";
import { CategoryEditor } from "@/components/catalog/editor";
import { localizedValue } from "@/lib/catalog";
import { catalogCopy } from "@/lib/catalog-copy";
import { requireUser } from "@/server/auth/session";
import { listCategories } from "@/server/catalog/merchant";
import { routeLocale } from "@/server/locale";

export default async function CategoriesPage({ params }: PageProps<"/[locale]/dashboard/stores/[slug]/categories">) {
  const locale = await routeLocale(params);
  const { slug } = await params;
  const user = await requireUser(locale);
  const data = await listCategories(user.id, slug);
  if (!data) notFound();
  const t = catalogCopy[locale];
  return <CatalogFrame locale={locale} slug={slug} path="/categories" storeName={data.store.name} showBilling={data.store.role === "owner"}>
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3"><div>
      <h1 className="text-3xl font-black sm:text-4xl">{t.categories}</h1><p className="mt-1 text-muted">{t.categoriesIntro}</p></div>
      <a className="button button-primary" href="#create-category">{t.addCategory}</a>
    </header>
    <div className="grid gap-5">
      {data.categories.length ? <ul className="grid gap-4 sm:grid-cols-2">
        {data.categories.map((category) => {
          const name = localizedValue(locale, category.nameAr, category.nameEn);
          const src = category.imageId ? `${privateImagePath(slug, "category", category.id)}/${category.imageId}` : null;
          return <li key={category.id} className="panel wajhati-category-card grid gap-3 p-3">
            <CatalogImage src={src} alt={name} className="wajhati-category-image rounded-lg" />
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="min-w-0 grow"><h2 className="wrap-anywhere font-extrabold"><bdi>{name}</bdi></h2><p className="text-xs text-muted"><bdi>{category.slug}</bdi></p></div>
              <span className="tag">{category.visible ? t.visible : t.hidden}</span>
              <Link className="button button-secondary" href={`/${locale}/dashboard/stores/${slug}/categories/${category.id}`}>{t.edit}</Link>
            </div>
          </li>;
        })}
      </ul> : <p className="panel border-dashed p-6 text-muted">{t.noCategories}</p>}
      <section id="create-category" className="grid gap-3">
        <h2 className="text-xl font-black">{t.addCategory}</h2>
        <CategoryEditor locale={locale} store={slug} id={null} />
      </section>
    </div>
  </CatalogFrame>;
}
