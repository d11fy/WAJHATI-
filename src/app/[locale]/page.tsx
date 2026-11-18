import { connection } from "next/server";
import { Marketing, marketingDescription } from "@/components/marketing";
import { marketingMetadata } from "@/lib/seo";
import { routeLocale } from "@/server/locale";

export async function generateMetadata({ params }: PageProps<"/[locale]">) {
  const locale = await routeLocale(params);
  return marketingMetadata(locale, "", undefined, marketingDescription(locale, "home"));
}

export default async function Home({ params }: PageProps<"/[locale]">) {
  await connection();
  return <Marketing locale={await routeLocale(params)} section="home" />;
}
