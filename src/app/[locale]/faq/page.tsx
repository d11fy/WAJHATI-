import { connection } from "next/server";
import { Marketing, marketingTitle } from "@/components/marketing";
import { routeLocale } from "@/server/locale";

export async function generateMetadata({ params }: PageProps<"/[locale]/faq">) {
  return { title: marketingTitle(await routeLocale(params), "faq") };
}

export default async function FAQ({ params }: PageProps<"/[locale]/faq">) {
  await connection();
  return <Marketing locale={await routeLocale(params)} section="faq" />;
}
