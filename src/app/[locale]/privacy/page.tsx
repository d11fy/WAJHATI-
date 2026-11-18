import { connection } from "next/server";
import { LegalPage } from "@/components/legal-page";
import { legalApproved, legalDocs } from "@/lib/legal";
import { marketingMetadata } from "@/lib/seo";
import { routeLocale } from "@/server/locale";

export async function generateMetadata({ params }: PageProps<"/[locale]/privacy">) {
  const locale = await routeLocale(params);
  const doc = legalDocs.privacy[locale];
  return marketingMetadata(locale, "/privacy", doc.title, doc.summary, legalApproved());
}

export default async function Privacy({ params }: PageProps<"/[locale]/privacy">) {
  await connection();
  return <LegalPage locale={await routeLocale(params)} kind="privacy" />;
}
