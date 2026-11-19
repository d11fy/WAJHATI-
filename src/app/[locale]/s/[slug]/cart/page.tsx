import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CartReview } from "@/components/orders/cart";
import { ThemedCartFrame } from "@/components/store-theme/storefront";
import { routeLocale } from "@/server/locale";
import { storefrontContact } from "@/server/orders/public";
import { PausedStore } from "@/components/paused-store";
import { getPausedStore, getPublicStore } from "@/server/stores/repository";
import { getPublishedDesign } from "@/server/themes/public";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function CartPage({ params }: PageProps<"/[locale]/s/[slug]/cart">) {
  await connection();
  const locale = await routeLocale(params);
  const { slug } = await params;
  const [store, contact, design] = await Promise.all([getPublicStore(slug), storefrontContact(slug), getPublishedDesign(slug)]);
  if (!store || !contact) {
    const paused = await getPausedStore(slug);
    if (paused) return <PausedStore locale={locale} name={paused.name} />;
    notFound();
  }
  return <ThemedCartFrame base={{ locale, store, contact, design }}><CartReview storeId={contact.storeId} slug={slug} locale={locale} /></ThemedCartFrame>;
}
