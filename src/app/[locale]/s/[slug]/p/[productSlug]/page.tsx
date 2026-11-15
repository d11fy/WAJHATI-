import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { publicImagePath } from "@/components/catalog/catalog-ui";
import { ThemedProduct } from "@/components/store-theme/storefront";
import { formatPrice, localizedValue } from "@/lib/catalog";
import { getPublicProduct } from "@/server/catalog/public";
import { routeLocale } from "@/server/locale";
import { getPublishedDesign } from "@/server/themes/public";
import { storefrontContact } from "@/server/orders/public";

const getProduct = cache(getPublicProduct);

export async function generateMetadata({ params }: PageProps<"/[locale]/s/[slug]/p/[productSlug]">): Promise<Metadata> {
  const locale = await routeLocale(params);
  const { slug, productSlug } = await params;
  const product = await getProduct(slug, productSlug);
  if (!product) return { robots: { index: false, follow: false } };
  const title = localizedValue(locale, product.nameAr, product.nameEn);
  const price = formatPrice(product.priceMinor, product.currency, locale);
  const ogTitle = `${title} · ${price} | ${product.storeName}`;
  const description = Array.from(localizedValue(locale, product.descriptionAr ?? "", product.descriptionEn) || ogTitle).slice(0, 180).join("");
  const metadataBase = new URL(process.env.APP_ORIGIN ?? "http://localhost:3000");
  const path = `/s/${slug}/p/${productSlug}`;
  return {
    title, description, metadataBase,
    alternates: { canonical: `/${locale}${path}`, languages: { ar: `/ar${path}`, en: `/en${path}` } },
    openGraph: {
      type: "website", title: ogTitle, description, url: `/${locale}${path}`, locale,
      images: product.images[0] ? [{ url: publicImagePath(slug, product.images[0]), alt: title }] : undefined,
    },
  };
}

export default async function ProductPage({ params }: PageProps<"/[locale]/s/[slug]/p/[productSlug]">) {
  await connection();
  const locale = await routeLocale(params);
  const { slug, productSlug } = await params;
  const product = await getProduct(slug, productSlug);
  if (!product) notFound();
  const [design, contact] = await Promise.all([getPublishedDesign(slug), storefrontContact(slug)]);
  return <ThemedProduct locale={locale} design={design} contact={contact} product={product}
    store={{ slug, name: product.storeName, country: product.country, currency: product.currency }} />;
}
