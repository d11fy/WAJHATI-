import { Marketing, marketingDescription, marketingTitle } from "@/components/marketing";
import { marketingMetadata } from "@/lib/seo";
import { routeLocale } from "@/server/locale";

export async function generateMetadata({ params }: PageProps<"/[locale]/pricing">) {
  const locale = await routeLocale(params);
  return marketingMetadata(locale, "/pricing", marketingTitle(locale, "pricing"), marketingDescription(locale, "pricing"));
}

export default async function Pricing({ params, searchParams }: PageProps<"/[locale]/pricing">) {
  const [locale, search] = await Promise.all([routeLocale(params), searchParams]);
  return <Marketing locale={locale} section="pricing" search={search} />;
}
