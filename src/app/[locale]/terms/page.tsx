import { connection } from "next/server";
import { LegalPage } from "@/components/legal-page";
import { legalApproved, legalDocs } from "@/lib/legal";
import { marketingMetadata } from "@/lib/seo";
import { routeLocale } from "@/server/locale";

export async function generateMetadata({ params }: PageProps<"/[locale]/terms">) {
  const locale = await routeLocale(params);
  const doc = legalDocs.terms[locale];
  return marketingMetadata(locale, "/terms", doc.title, doc.summary, legalApproved());
}

export default async function Terms({ params }: PageProps<"/[locale]/terms">) {
  await connection();
  return <LegalPage locale={await routeLocale(params)} kind="terms" />;
}
