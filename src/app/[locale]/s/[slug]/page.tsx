import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ThemedHome } from "@/components/store-theme/storefront";
import { catalogFilters } from "@/lib/catalog";
import { getPublicCatalog } from "@/server/catalog/public";
import { routeLocale } from "@/server/locale";
import { getPublishedDesign, getThemeHighlights } from "@/server/themes/public";
import { storefrontContact } from "@/server/orders/public";

export default async function PublicStore({ params, searchParams }: PageProps<"/[locale]/s/[slug]">) {
  await connection();
  const locale = await routeLocale(params);
  const { slug } = await params;
  const filters = catalogFilters(await searchParams);
  const data = await getPublicCatalog(slug, filters);
  if (!data) notFound();
  const [design, contact] = await Promise.all([getPublishedDesign(slug), storefrontContact(slug)]);
  const unfiltered = !filters.q && !filters.category && !filters.availableOnly && filters.page === 1;
  const highlights = unfiltered && design.sections.some(({ id, visible }) => visible && (id === "categories" || id === "featured"))
    ? getThemeHighlights(slug, design) : { products: [], categories: [] };
  return <ThemedHome locale={locale} design={design} contact={contact} filters={filters} highlights={highlights} {...data} />;
}
