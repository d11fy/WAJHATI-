import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ThemedHome } from "@/components/store-theme/storefront";
import { catalogFilters } from "@/lib/catalog";
import { requireUser } from "@/server/auth/session";
import { routeLocale } from "@/server/locale";
import { getDesignPreview } from "@/server/themes/public";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function DesignPreview({ params }: PageProps<"/[locale]/dashboard/stores/[slug]/design/preview">) {
  const locale = await routeLocale(params);
  const { slug } = await params;
  const user = await requireUser(locale);
  const data = await getDesignPreview(user.id, slug);
  if (!data) notFound();
  const { config, ...catalog } = data;
  return <ThemedHome locale={locale} design={config} filters={catalogFilters({})} hasNext={false} preview {...catalog} />;
}
