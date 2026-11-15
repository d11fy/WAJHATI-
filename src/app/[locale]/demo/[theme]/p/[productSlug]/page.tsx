import { notFound } from "next/navigation";
import { routeLocale } from "@/server/locale";
import { demoCatalog, isDemoTheme } from "@/lib/demo-catalog";
import { FamilyProduct } from "@/components/store-theme/family-pages";

export default async function DemoProduct({ params }: PageProps<"/[locale]/demo/[theme]/p/[productSlug]">) {
  const { theme, productSlug } = await params;
  if (!isDemoTheme(theme)) notFound();
  const locale = await routeLocale(params);
  const catalog = demoCatalog(theme, locale);
  const product = catalog.products.find((item) => item.slug === productSlug);
  if (!product) notFound();
  return <FamilyProduct family={theme} data={{ ...catalog, locale, product }} />;
}
