import { notFound } from "next/navigation";
import { routeLocale } from "@/server/locale";
import { demoCatalog, isDemoTheme } from "@/lib/demo-catalog";
import { FamilyCart } from "@/components/store-theme/family-pages";
import { DemoCart } from "@/components/demo-cart";

export default async function DemoCartPage({ params }: PageProps<"/[locale]/demo/[theme]/cart">) {
  const { theme } = await params;
  if (!isDemoTheme(theme)) notFound();
  const locale = await routeLocale(params);
  return <FamilyCart family={theme} base={{ ...demoCatalog(theme, locale), locale }}><DemoCart theme={theme} locale={locale} /></FamilyCart>;
}
