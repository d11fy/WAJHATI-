import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routeLocale } from "@/server/locale";
import { catalogFilters } from "@/lib/catalog";
import { demoCatalog, filterDemoProducts, isDemoTheme } from "@/lib/demo-catalog";
import { FamilyHome } from "@/components/store-theme/family-pages";
import { themeRegistry } from "@/lib/theme-config";

export async function generateMetadata({ params }: PageProps<"/[locale]/demo/[theme]">): Promise<Metadata> {
  const { theme } = await params;
  return { title: isDemoTheme(theme) ? `${themeRegistry[theme].title} · Demo` : "Demo" };
}
export default async function DemoHome({ params, searchParams }: PageProps<"/[locale]/demo/[theme]">) {
  const { theme } = await params;
  if (!isDemoTheme(theme)) notFound();
  const locale = await routeLocale(params);
  const catalog = demoCatalog(theme, locale);
  const filters = catalogFilters(await searchParams);
  return <FamilyHome family={theme} data={{ ...catalog, ...filterDemoProducts(catalog.products, filters), locale, filters }} />;
}
