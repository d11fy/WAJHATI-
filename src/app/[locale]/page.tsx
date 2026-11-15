import { connection } from "next/server";
import { Marketing } from "@/components/marketing";
import { routeLocale } from "@/server/locale";

export default async function Home({ params }: PageProps<"/[locale]">) {
  await connection();
  return <Marketing locale={await routeLocale(params)} section="home" />;
}
