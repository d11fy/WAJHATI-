import { connection } from "next/server";
import { Marketing, marketingDescription, marketingTitle } from "@/components/marketing";
import { marketingMetadata } from "@/lib/seo";
import { routeLocale } from "@/server/locale";

export async function generateMetadata({ params }: PageProps<"/[locale]/features">) {
  const locale = await routeLocale(params);
  return marketingMetadata(locale, "/features", marketingTitle(locale, "features"), marketingDescription(locale, "features"));
}

export default async function Features({ params }: PageProps<"/[locale]/features">) {
  await connection();
  return <Marketing locale={await routeLocale(params)} section="features" />;
}
