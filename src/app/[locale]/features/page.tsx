import { connection } from "next/server";
import { Marketing, marketingTitle } from "@/components/marketing";
import { routeLocale } from "@/server/locale";

export async function generateMetadata({ params }: PageProps<"/[locale]/features">) {
  return { title: marketingTitle(await routeLocale(params), "features") };
}

export default async function Features({ params }: PageProps<"/[locale]/features">) {
  await connection();
  return <Marketing locale={await routeLocale(params)} section="features" />;
}
