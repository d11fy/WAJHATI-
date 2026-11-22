import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ThemedHome } from "@/components/store-theme/storefront";
import { catalogFilters, localizedValue } from "@/lib/catalog";
import { designAssetPath } from "@/lib/theme-config";
import { publicImagePath } from "@/components/catalog/catalog-ui";
import { getPublicCatalog } from "@/server/catalog/public";
import { routeLocale } from "@/server/locale";
import { PausedStore } from "@/components/paused-store";
import { getPausedStore, getPublicStore } from "@/server/stores/repository";
import { getPublishedDesign, getThemeHighlights } from "@/server/themes/public";
import { storefrontContact } from "@/server/orders/public";

export async function generateMetadata({ params }: PageProps<"/[locale]/s/[slug]">): Promise<Metadata> {
  const locale = await routeLocale(params);
  const { slug } = await params;
  const store = await getPublicStore(slug);
  if (!store) return { robots: { index: false, follow: false } };
  const design = await getPublishedDesign(slug);
  const heroTitle = localizedValue(locale, design.hero.titleAr, design.hero.titleEn);
  const heroDesc = localizedValue(locale, design.hero.descriptionAr, design.hero.descriptionEn);
  const title = heroTitle ? `${store.name} · ${heroTitle}` : store.name;
  const description = Array.from(heroDesc || heroTitle || store.name).slice(0, 180).join("");
  const metadataBase = new URL(process.env.APP_ORIGIN ?? "http://localhost:3000");
  const path = `/s/${slug}`;
  const ogAsset = design.assets.banner ?? design.assets.logo;
  // Shared links need a picture: the banner or logo, else the first product photo, else the platform card.
  const productImage = ogAsset ? null : (await getPublicCatalog(slug, catalogFilters({})))?.products.find((product) => product.imageId)?.imageId ?? null;
  const image = ogAsset ? { url: designAssetPath(slug, ogAsset), alt: store.name }
    : productImage ? { url: publicImagePath(slug, productImage), alt: store.name }
    : { url: `/og/wajhati-${locale}.jpg`, width: 1200, height: 630, alt: store.name };
  return {
    title: store.name,
    description,
    metadataBase,
    alternates: { canonical: `/${locale}${path}`, languages: { ar: `/ar${path}`, en: `/en${path}` } },
    openGraph: {
      type: "website",
      title,
      description,
      url: `/${locale}${path}`,
      locale,
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export default async function PublicStore({ params, searchParams }: PageProps<"/[locale]/s/[slug]">) {
  await connection();
  const locale = await routeLocale(params);
  const { slug } = await params;
  const filters = catalogFilters(await searchParams);
  const data = await getPublicCatalog(slug, filters);
  if (!data) {
    const paused = await getPausedStore(slug);
    if (paused) return <PausedStore locale={locale} name={paused.name} />;
    notFound();
  }
  const [design, contact] = await Promise.all([getPublishedDesign(slug), storefrontContact(slug)]);
  const unfiltered = !filters.q && !filters.category && !filters.availableOnly && filters.page === 1;
  const highlights = unfiltered && design.sections.some(({ id, visible }) => visible && (id === "categories" || id === "featured"))
    ? getThemeHighlights(slug, design) : { products: [], categories: [] };
  return <ThemedHome locale={locale} design={design} contact={contact} filters={filters} highlights={highlights} {...data} />;
}
