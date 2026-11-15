import { Marketing, marketingTitle } from "@/components/marketing";
import { routeLocale } from "@/server/locale";

export async function generateMetadata({ params }: PageProps<"/[locale]/pricing">) {
  return { title: marketingTitle(await routeLocale(params), "pricing") };
}

export default async function Pricing({ params, searchParams }: PageProps<"/[locale]/pricing">) {
  const [locale, search] = await Promise.all([routeLocale(params), searchParams]);
  return <Marketing locale={locale} section="pricing" search={search} />;
}
