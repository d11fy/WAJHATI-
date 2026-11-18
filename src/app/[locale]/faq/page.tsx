import { connection } from "next/server";
import { Marketing, marketingDescription, marketingTitle } from "@/components/marketing";
import { marketingMetadata } from "@/lib/seo";
import { routeLocale } from "@/server/locale";

export async function generateMetadata({ params }: PageProps<"/[locale]/faq">) {
  const locale = await routeLocale(params);
  return marketingMetadata(locale, "/faq", marketingTitle(locale, "faq"), marketingDescription(locale, "faq"));
}

export default async function FAQ({ params }: PageProps<"/[locale]/faq">) {
  await connection();
  return <Marketing locale={await routeLocale(params)} section="faq" />;
}
